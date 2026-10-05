-- ==========================================================================
-- Tapigo — Base de données Supabase
-- À coller tel quel dans Supabase → SQL Editor → New query → Run.
-- Le script peut être relancé sans risque (il ne supprime aucune commande).
-- ==========================================================================

-- ---------- Tables ----------

-- Une seule ligne : infos de l'établissement + carte complète (JSON).
create table if not exists public.restaurant (
  id          int primary key default 1 check (id = 1),
  info        jsonb not null default '{}'::jsonb,
  menu        jsonb,
  updated_at  timestamptz not null default now()
);

insert into public.restaurant (id, info)
values (1, '{"name": "Mon restaurant", "tagline": "", "tables": 12}'::jsonb)
on conflict (id) do nothing;

-- Comptes autorisés à ouvrir le dashboard (restaurateur, équipe).
create table if not exists public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  number      bigint generated always as identity (start with 1001),
  table_label text not null,
  lines       jsonb not null,
  note        text not null default '',
  payment     jsonb not null default '{"method": "onsite", "status": "pending"}'::jsonb,
  total       numeric(10, 2) not null,
  status      text not null default 'nouvelle'
              check (status in ('nouvelle', 'preparation', 'prete', 'servie', 'terminee')),
  history     jsonb not null default jsonb_build_array(jsonb_build_object('status', 'nouvelle', 'at', now())),
  seen        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- ---------- Droits ----------

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.staff where user_id = auth.uid());
$$;

alter table public.restaurant enable row level security;
alter table public.staff      enable row level security;
alter table public.orders     enable row level security;

drop policy if exists "Carte visible par tous" on public.restaurant;
create policy "Carte visible par tous" on public.restaurant
  for select using (true);

drop policy if exists "Carte modifiable par l'équipe" on public.restaurant;
create policy "Carte modifiable par l'équipe" on public.restaurant
  for update using (public.is_staff()) with check (public.is_staff());

drop policy if exists "Chacun voit son propre accès" on public.staff;
create policy "Chacun voit son propre accès" on public.staff
  for select using (user_id = auth.uid());

-- Les clients ne lisent ni n'écrivent jamais la table directement :
-- ils passent par place_order() et get_order() ci-dessous.
drop policy if exists "Commandes réservées à l'équipe" on public.orders;
create policy "Commandes réservées à l'équipe" on public.orders
  for all using (public.is_staff()) with check (public.is_staff());

-- ---------- Prise de commande (client) ----------
-- Les prix sont recalculés ici, à partir de la carte en base :
-- un client ne peut pas modifier le montant de sa commande.
create or replace function public.place_order(p_table text, p_items jsonb, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_menu    jsonb;
  v_req     jsonb;
  v_item    jsonb;
  v_group   jsonb;
  v_choice  jsonb;
  v_label   text;
  v_picked  jsonb;
  v_values  jsonb;
  v_options jsonb;
  v_lines   jsonb := '[]'::jsonb;
  v_unit    numeric;
  v_qty     int;
  v_total   numeric := 0;
  v_order   public.orders;
begin
  select menu into v_menu from public.restaurant where id = 1;
  if v_menu is null then
    raise exception 'La carte n''est pas encore disponible';
  end if;

  p_table := left(regexp_replace(coalesce(p_table, ''), '[^0-9A-Za-z-]', '', 'g'), 6);
  if p_table = '' then
    raise exception 'Numéro de table manquant';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 40 then
    raise exception 'Panier invalide';
  end if;

  for v_req in select value from jsonb_array_elements(p_items) loop
    select x.value into v_item
    from jsonb_array_elements(coalesce(v_menu -> 'items', '[]'::jsonb)) as x
    where x.value ->> 'id' = v_req ->> 'itemId'
      and coalesce((x.value ->> 'available')::boolean, true)
    limit 1;

    if v_item is null then
      raise exception 'Produit indisponible : %', coalesce(v_req ->> 'itemId', '?');
    end if;

    v_qty := least(greatest(coalesce((v_req ->> 'qty')::int, 1), 1), 20);
    v_unit := coalesce((v_item ->> 'price')::numeric, 0);
    v_options := '[]'::jsonb;

    for v_group in select value from jsonb_array_elements(coalesce(v_item -> 'options', '[]'::jsonb)) loop
      v_picked := v_req -> 'selections' -> (v_group ->> 'id');
      if jsonb_typeof(v_picked) is distinct from 'array' then
        v_picked := '[]'::jsonb;
      end if;
      if coalesce(v_group ->> 'type', 'single') <> 'multi' and jsonb_array_length(v_picked) > 1 then
        v_picked := jsonb_build_array(v_picked -> 0);
      end if;

      v_values := '[]'::jsonb;
      for v_label in select value from jsonb_array_elements_text(v_picked) loop
        select c.value into v_choice
        from jsonb_array_elements(coalesce(v_group -> 'choices', '[]'::jsonb)) as c
        where c.value ->> 'label' = v_label
        limit 1;
        if v_choice is not null and not (v_values ? v_label) then
          v_unit := v_unit + coalesce((v_choice ->> 'price')::numeric, 0);
          v_values := v_values || to_jsonb(v_label);
        end if;
      end loop;

      if coalesce((v_group ->> 'required')::boolean, false) and jsonb_array_length(v_values) = 0 then
        raise exception 'Choix obligatoire manquant : % (%)', v_group ->> 'name', v_item ->> 'name';
      end if;
      if jsonb_array_length(v_values) > 0 then
        v_options := v_options || jsonb_build_array(jsonb_build_object('group', v_group ->> 'name', 'values', v_values));
      end if;
    end loop;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'itemId', v_item ->> 'id',
      'name', v_item ->> 'name',
      'station', coalesce(v_item ->> 'station', 'cuisine'),
      'qty', v_qty,
      'unitPrice', round(v_unit, 2),
      'options', v_options,
      'note', left(coalesce(v_req ->> 'note', ''), 140)
    ));
    v_total := v_total + v_unit * v_qty;
  end loop;

  insert into public.orders (table_label, lines, note, total)
  values (p_table, v_lines, left(coalesce(p_note, ''), 200), round(v_total, 2))
  returning * into v_order;

  return to_jsonb(v_order);
end;
$$;

-- Suivi d'une commande par le client (l'identifiant est impossible à deviner).
create or replace function public.get_order(p_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select to_jsonb(o) from public.orders o where o.id = p_id;
$$;

-- ---------- Changement de statut (équipe) ----------
create or replace function public.set_order_status(p_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_staff() then
    raise exception 'Accès refusé';
  end if;
  if p_status not in ('nouvelle', 'preparation', 'prete', 'servie', 'terminee') then
    raise exception 'Statut invalide';
  end if;

  update public.orders
  set status  = p_status,
      seen    = true,
      history = history || jsonb_build_array(jsonb_build_object('status', p_status, 'at', now())),
      payment = case when p_status = 'terminee' then jsonb_set(payment, '{status}', '"paid"') else payment end
  where id = p_id and status <> p_status
  returning * into v_order;

  return to_jsonb(v_order);
end;
$$;

revoke all on function public.place_order(text, jsonb, text) from public;
revoke all on function public.get_order(uuid) from public;
revoke all on function public.set_order_status(uuid, text) from public;
grant execute on function public.place_order(text, jsonb, text) to anon, authenticated;
grant execute on function public.get_order(uuid) to anon, authenticated;
grant execute on function public.set_order_status(uuid, text) to authenticated;
grant execute on function public.is_staff() to anon, authenticated;

-- ---------- Temps réel ----------
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.restaurant;
exception when duplicate_object then null;
end $$;

-- ==========================================================================
-- DERNIÈRE ÉTAPE (à faire après avoir créé votre compte dans
-- Authentication → Users → Add user) : remplacez l'e-mail puis exécutez
-- uniquement la ligne ci-dessous.
--
--   insert into public.staff (user_id) select id from auth.users where email = 'vous@exemple.fr';
-- ==========================================================================
