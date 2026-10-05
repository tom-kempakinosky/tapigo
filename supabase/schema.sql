-- ==========================================================================
-- Tapigo — Base de données Supabase (multi-restaurants)
--
-- À coller tel quel dans Supabase → SQL Editor → New query → Run.
-- Le script peut être relancé sans risque. S'il trouve l'ancienne version
-- « un seul restaurant », il la convertit automatiquement : la carte, les
-- commandes et les comptes sont conservés, et les comptes existants
-- deviennent administrateurs Tapigo + gérants de ce restaurant.
-- ==========================================================================

-- ---------- Tables ----------

create table if not exists public.restaurants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
              check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 40),
  info        jsonb not null default '{}'::jsonb,
  menu        jsonb,
  active      boolean not null default true,
  next_number int not null default 1001,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Équipe Tapigo : crée les restaurants et gère les accès.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- Accès d'un compte à un restaurant. owner = gérant (commandes + carte),
-- equipe = commandes uniquement.
create table if not exists public.restaurant_members (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          text not null default 'owner' check (role in ('owner', 'equipe')),
  created_at    timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);

create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  number        bigint not null,
  table_label   text not null,
  lines         jsonb not null,
  note          text not null default '',
  payment       jsonb not null default '{"method": "onsite", "status": "pending"}'::jsonb,
  total         numeric(10, 2) not null,
  status        text not null default 'nouvelle'
                check (status in ('nouvelle', 'preparation', 'prete', 'servie', 'terminee')),
  history       jsonb not null default jsonb_build_array(jsonb_build_object('status', 'nouvelle', 'at', now())),
  seen          boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Ancienne version : la colonne restaurant_id n'existait pas, et le numéro
-- était un compteur global.
alter table public.orders add column if not exists restaurant_id uuid references public.restaurants (id) on delete cascade;
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'orders'
               and column_name = 'number' and is_identity = 'YES') then
    alter table public.orders alter column number drop identity;
  end if;
end $$;

-- ---------- Conversion de l'ancienne version (un seul restaurant) ----------
do $$
declare
  v_old  record;
  v_id   uuid;
  v_slug text;
begin
  if to_regclass('public.restaurant') is not null then
    select * into v_old from public.restaurant where id = 1;
    if found then
      v_slug := regexp_replace(
        lower(translate(coalesce(v_old.info ->> 'name', ''),
          'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ',
          'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy')),
        '[^a-z0-9]+', '-', 'g');
      v_slug := trim(both '-' from left(trim(both '-' from v_slug), 40));
      if length(v_slug) < 2 then v_slug := 'mon-restaurant'; end if;
      if exists (select 1 from public.restaurants where slug = v_slug) then
        v_slug := left(v_slug, 33) || '-' || substr(md5(random()::text), 1, 6);
      end if;

      insert into public.restaurants (slug, info, menu, next_number)
      values (v_slug, v_old.info, v_old.menu,
              coalesce((select max(number) + 1 from public.orders), 1001))
      returning id into v_id;

      update public.orders set restaurant_id = v_id where restaurant_id is null;

      if to_regclass('public.staff') is not null then
        execute format('insert into public.restaurant_members (restaurant_id, user_id, role)
                        select %L, user_id, %L from public.staff on conflict do nothing', v_id, 'owner');
        execute 'insert into public.admins (user_id) select user_id from public.staff on conflict do nothing';
      end if;
    end if;
    drop table public.restaurant cascade;
  end if;

  if to_regclass('public.staff') is not null then
    drop table public.staff cascade;
  end if;
end $$;

drop policy if exists "Commandes réservées à l'équipe" on public.orders;
drop function if exists public.place_order(text, jsonb, text);
drop function if exists public.is_staff();

delete from public.orders where restaurant_id is null;
alter table public.orders alter column restaurant_id set not null;
create index if not exists orders_restaurant_created_idx on public.orders (restaurant_id, created_at desc);
create index if not exists orders_restaurant_number_idx on public.orders (restaurant_id, number desc);
drop index if exists public.orders_created_at_idx;

-- ---------- Droits ----------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- 'admin', 'owner', 'equipe' ou null (aucun accès).
create or replace function public.member_role(p_restaurant uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select case
    when exists (select 1 from public.admins where user_id = auth.uid()) then 'admin'
    else (select role from public.restaurant_members
          where restaurant_id = p_restaurant and user_id = auth.uid())
  end;
$$;

alter table public.restaurants        enable row level security;
alter table public.admins             enable row level security;
alter table public.restaurant_members enable row level security;
alter table public.orders             enable row level security;

drop policy if exists "Restaurants visibles par tous" on public.restaurants;
create policy "Restaurants visibles par tous" on public.restaurants
  for select using (true);

drop policy if exists "Carte modifiable par le gérant" on public.restaurants;
create policy "Carte modifiable par le gérant" on public.restaurants
  for update using (public.member_role(id) in ('admin', 'owner'))
  with check (public.member_role(id) in ('admin', 'owner'));

drop policy if exists "Chacun voit son statut admin" on public.admins;
create policy "Chacun voit son statut admin" on public.admins
  for select using (user_id = auth.uid());

drop policy if exists "Chacun voit ses accès" on public.restaurant_members;
create policy "Chacun voit ses accès" on public.restaurant_members
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Commandes visibles par l'équipe du restaurant" on public.orders;
create policy "Commandes visibles par l'équipe du restaurant" on public.orders
  for select using (public.member_role(restaurant_id) is not null);

drop policy if exists "Commandes modifiables par l'équipe du restaurant" on public.orders;
create policy "Commandes modifiables par l'équipe du restaurant" on public.orders
  for update using (public.member_role(restaurant_id) is not null)
  with check (public.member_role(restaurant_id) is not null);

-- Tout passe par les policies ci-dessus ou par les fonctions ci-dessous.
revoke insert, update, delete on public.restaurants, public.admins, public.restaurant_members, public.orders from anon, authenticated;
-- Le gérant ne peut modifier que la carte et les infos (pas l'identifiant ni le compteur).
grant update (info, menu, updated_at) on public.restaurants to authenticated;
grant update (seen) on public.orders to authenticated;
grant select on public.restaurants, public.admins, public.restaurant_members, public.orders to anon, authenticated;

-- ---------- Prise de commande (client) ----------
-- Les prix sont recalculés ici, à partir de la carte en base :
-- un client ne peut pas modifier le montant de sa commande.
create or replace function public.place_order(p_restaurant text, p_table text, p_items jsonb, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rid     uuid;
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
  v_number  int;
  v_order   public.orders;
begin
  select id, menu into v_rid, v_menu from public.restaurants where slug = p_restaurant and active;
  if v_rid is null then
    raise exception 'Restaurant introuvable';
  end if;
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

  -- Numéro de commande propre à chaque restaurant. On ne modifie PAS la fiche
  -- du restaurant (sinon chaque commande serait diffusée à tous les clients
  -- connectés) : un verrou par restaurant évite les doublons.
  perform pg_advisory_xact_lock(hashtext('tapigo-order-' || v_rid::text));
  select greatest(coalesce(max(o.number) + 1, 0), r.next_number) into v_number
  from public.restaurants r
  left join public.orders o on o.restaurant_id = r.id
  where r.id = v_rid
  group by r.next_number;

  insert into public.orders (restaurant_id, number, table_label, lines, note, total)
  values (v_rid, v_number, p_table, v_lines, left(coalesce(p_note, ''), 200), round(v_total, 2))
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

-- ---------- Équipe du restaurant ----------
create or replace function public.set_order_status(p_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
begin
  if p_status not in ('nouvelle', 'preparation', 'prete', 'servie', 'terminee') then
    raise exception 'Statut invalide';
  end if;
  if public.member_role((select restaurant_id from public.orders where id = p_id)) is null then
    raise exception 'Accès refusé';
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

-- Restaurants accessibles au compte connecté (tous pour un admin).
create or replace function public.my_restaurants()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'slug', r.slug,
           'name', coalesce(nullif(r.info ->> 'name', ''), r.slug),
           'active', r.active,
           'role', case when public.is_admin() then 'admin' else m.role end
         ) order by coalesce(nullif(r.info ->> 'name', ''), r.slug)), '[]'::jsonb)
  from public.restaurants r
  left join public.restaurant_members m on m.restaurant_id = r.id and m.user_id = auth.uid()
  where auth.uid() is not null and (m.user_id is not null or public.is_admin());
$$;

-- ---------- Administration Tapigo ----------
create or replace function public.admin_create_restaurant(p_name text, p_slug text, p_tables int default 12, p_menu jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.restaurants;
begin
  if not public.is_admin() then raise exception 'Accès refusé'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Le nom est obligatoire'; end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug) not between 2 and 40 then
    raise exception 'Identifiant invalide : lettres minuscules, chiffres et tirets uniquement';
  end if;
  if exists (select 1 from public.restaurants where slug = p_slug) then
    raise exception 'Cet identifiant est déjà utilisé';
  end if;

  insert into public.restaurants (slug, info, menu)
  values (p_slug,
          jsonb_build_object('name', trim(p_name), 'tagline', '', 'tables', greatest(1, least(coalesce(p_tables, 12), 200))),
          p_menu)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.admin_set_active(p_restaurant uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé'; end if;
  update public.restaurants set active = p_active, updated_at = now() where id = p_restaurant;
end;
$$;

create or replace function public.admin_list_members(p_restaurant uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role)
                              order by u.email), '[]'::jsonb)
    from public.restaurant_members m
    join auth.users u on u.id = m.user_id
    where m.restaurant_id = p_restaurant
  );
end;
$$;

create or replace function public.admin_add_member(p_restaurant uuid, p_email text, p_role text default 'owner')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then raise exception 'Accès refusé'; end if;
  if p_role not in ('owner', 'equipe') then raise exception 'Rôle invalide'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if v_user is null then
    raise exception 'Aucun compte avec cet e-mail. Créez-le d''abord dans Supabase → Authentication → Users.';
  end if;
  insert into public.restaurant_members (restaurant_id, user_id, role)
  values (p_restaurant, v_user, p_role)
  on conflict (restaurant_id, user_id) do update set role = excluded.role;
end;
$$;

create or replace function public.admin_remove_member(p_restaurant uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé'; end if;
  delete from public.restaurant_members where restaurant_id = p_restaurant and user_id = p_user;
end;
$$;

-- ---------- Droits d'exécution ----------
revoke all on function public.place_order(text, text, jsonb, text) from public;
revoke all on function public.get_order(uuid) from public;
revoke all on function public.set_order_status(uuid, text) from public;
revoke all on function public.my_restaurants() from public;
revoke all on function public.admin_create_restaurant(text, text, int, jsonb) from public;
revoke all on function public.admin_set_active(uuid, boolean) from public;
revoke all on function public.admin_list_members(uuid) from public;
revoke all on function public.admin_add_member(uuid, text, text) from public;
revoke all on function public.admin_remove_member(uuid, uuid) from public;

grant execute on function public.place_order(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.get_order(uuid) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.member_role(uuid) to anon, authenticated;
grant execute on function public.set_order_status(uuid, text) to authenticated;
grant execute on function public.my_restaurants() to authenticated;
grant execute on function public.admin_create_restaurant(text, text, int, jsonb) to authenticated;
grant execute on function public.admin_set_active(uuid, boolean) to authenticated;
grant execute on function public.admin_list_members(uuid) to authenticated;
grant execute on function public.admin_add_member(uuid, text, text) to authenticated;
grant execute on function public.admin_remove_member(uuid, uuid) to authenticated;

-- ---------- Temps réel ----------
do $$
begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.restaurants;
exception when duplicate_object then null;
end $$;

-- ==========================================================================
-- NOUVELLE INSTALLATION UNIQUEMENT : après avoir créé votre compte dans
-- Authentication → Users → Add user, remplacez l'e-mail puis exécutez
-- uniquement la ligne ci-dessous pour devenir administrateur Tapigo.
--
--   insert into public.admins (user_id) select id from auth.users where email = 'vous@exemple.fr';
-- ==========================================================================
