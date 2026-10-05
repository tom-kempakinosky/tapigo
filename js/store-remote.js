/* ==========================================================================
   Tapigo — Store en ligne (Supabase, multi-restaurants)

   Actif uniquement si js/config.js contient l'URL et la clé du projet.
   Remplace les fonctions du store de démo par des appels à Supabase, en
   gardant la même API synchrone grâce à un cache local :
     - lectures (getMenu, getOrders…) : servies depuis le cache ;
     - écritures : appliquées au cache immédiatement, puis envoyées au serveur ;
     - temps réel : la cuisine reçoit les commandes via Supabase Realtime,
       le client suit sa commande via get_order() (toutes les 4 s).

   Chaque page ouvre un restaurant :
     - client     : T.openRestaurant(slug)          (slug lu dans ?r=…)
     - dashboard  : T.startStaff({ id, slug, role }) (après connexion)
   Le schéma de la base est dans supabase/schema.sql.
   ========================================================================== */
(function () {
  'use strict';

  var cfg = window.TAPIGO_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;

  var SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var EMPTY_MENU = { categories: [], tags: {}, items: [] };
  var DEFAULT_INFO = { name: 'Mon restaurant', tagline: '', tables: 12 };

  var T = window.Tapigo;
  var emit = T._emit;
  var sb = null;
  var current = null; // { id, slug, role }
  var cache = { info: clone(DEFAULT_INFO), menu: null, orders: [] };
  var pendingMenuWrites = 0;

  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  function fail(err) {
    var msg = (err && err.message) || String(err || 'Erreur inconnue');
    console.error('[Tapigo]', err);
    emit('error', { message: msg });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Connexion impossible. Vérifiez votre accès à Internet.')); };
      document.head.appendChild(s);
    });
  }

  // reason : 'old-link' (plaque sans ?r= alors qu'il y a plusieurs restaurants),
  //          'unknown' (identifiant inexistant) ou 'closed' (restaurant désactivé).
  function notFound(reason, slug) {
    var msg = reason === 'old-link'
      ? 'Ce lien ne précise pas le restaurant (ancien format, sans « ?r= »). Reprogrammez la plaque NFC avec le lien copié depuis l’espace admin.'
      : reason === 'closed'
        ? 'Le restaurant « ' + slug + ' » est momentanément fermé aux commandes en ligne.'
        : 'Aucun restaurant ne correspond à l’identifiant « ' + slug + ' ». Vérifiez le lien de la plaque NFC.';
    var e = new Error(msg);
    e.code = 'NOT_FOUND';
    e.reason = reason;
    return e;
  }

  /* ---------------- Conversions base <-> app ---------------- */
  function ts(v) { return typeof v === 'number' ? v : (Date.parse(v) || Date.now()); }

  function fromRow(r) {
    return {
      id: r.id,
      number: Number(r.number),
      table: String(r.table_label),
      lines: r.lines || [],
      note: r.note || '',
      payment: r.payment || { method: 'onsite', status: 'pending' },
      total: Number(r.total) || 0,
      status: r.status,
      createdAt: ts(r.created_at),
      history: (r.history || []).map(function (h) { return { status: h.status, at: ts(h.at) }; }),
      seen: !!r.seen
    };
  }

  function findOrder(id) {
    return cache.orders.filter(function (o) { return o.id === id; })[0] || null;
  }

  function upsert(o) {
    var i = cache.orders.findIndex(function (x) { return x.id === o.id; });
    if (i >= 0) cache.orders[i] = o; else cache.orders.push(o);
    return o;
  }

  function applyRestaurant(row, skipMenu) {
    cache.info = Object.assign(clone(DEFAULT_INFO), row.info || {});
    if (!skipMenu) cache.menu = row.menu || null;
  }

  function subscribeRestaurant() {
    // La carte se met à jour en direct quand le restaurateur la modifie.
    sb.channel('tapigo-restaurant-' + current.id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'restaurants', filter: 'id=eq.' + current.id }, function (p) {
        applyRestaurant(p.new, pendingMenuWrites > 0);
        emit('menu:updated', null);
        emit('restaurant:updated', clone(cache.info));
      })
      .subscribe();
  }

  /* ---------------- Écritures carte / établissement ---------------- */
  function persist(fields) {
    fields.updated_at = new Date().toISOString();
    var isMenu = 'menu' in fields;
    if (isMenu) pendingMenuWrites++;
    var done = function () { if (isMenu) pendingMenuWrites = Math.max(0, pendingMenuWrites - 1); };
    return sb.from('restaurants').update(fields).eq('id', current.id).select('id').then(function (r) {
      done();
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) throw new Error('Modification refusée : seul le gérant peut modifier la carte.');
    }, function (e) { done(); throw e; }).catch(function (e) {
      fail(e);
      return refreshRestaurant().catch(function () {});
    });
  }

  function refreshRestaurant() {
    return sb.from('restaurants').select('info, menu').eq('id', current.id).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      if (r.data) applyRestaurant(r.data);
      emit('menu:updated', null);
      emit('restaurant:updated', clone(cache.info));
    });
  }

  // Une carte neuve reçoit les catégories et étiquettes standard.
  function menuForWrite() {
    var m = cache.menu || clone(EMPTY_MENU);
    var d = window.TAPIGO_DEMO;
    if (d && (!m.categories || !m.categories.length)) m.categories = clone(d.categories);
    if (d && (!m.tags || !Object.keys(m.tags).length)) m.tags = clone(d.tags);
    return m;
  }

  T.mode = 'live';
  T.currentRestaurant = function () { return clone(current); };
  T.hasMenu = function () { return !!(cache.menu && cache.menu.items && cache.menu.items.length); };
  T.getRestaurant = function () { return clone(cache.info); };
  T.getMenu = function () { return clone(cache.menu || EMPTY_MENU); };

  T.saveRestaurant = function (info) {
    cache.info = Object.assign(clone(DEFAULT_INFO), info);
    emit('restaurant:updated', clone(cache.info));
    persist({ info: cache.info });
  };

  T.replaceMenu = function (menu) {
    cache.menu = clone(menu);
    emit('menu:updated', null);
    return persist({ menu: cache.menu });
  };

  T.saveItem = function (item) {
    var menu = menuForWrite();
    item = clone(item);
    if (!item.id) {
      var base = T._slug(item.name), id = base, n = 2;
      while (menu.items.some(function (i) { return i.id === id; })) id = base + '-' + n++;
      item.id = id;
    }
    var idx = menu.items.findIndex(function (i) { return i.id === item.id; });
    if (idx >= 0) menu.items[idx] = item; else menu.items.push(item);
    cache.menu = menu;
    emit('menu:updated', { id: item.id });
    persist({ menu: cache.menu });
    return clone(item);
  };

  T.deleteItem = function (id) {
    var menu = menuForWrite();
    menu.items = menu.items.filter(function (i) { return i.id !== id; });
    cache.menu = menu;
    emit('menu:updated', { id: id });
    persist({ menu: cache.menu });
  };

  T.setAvailable = function (id, available) {
    var item = T.getItem(id);
    if (!item) return;
    item.available = !!available;
    T.saveItem(item);
  };

  T.resetDemo = function () { /* sans objet en ligne */ };

  /* ---------------- Commandes ---------------- */
  T.getOrders = function () { return clone(cache.orders); };
  T.getOrder = function (id) { return clone(findOrder(id)); };

  // Client : envoie le panier, le serveur recalcule les prix et crée la commande.
  T.createOrder = function (payload) {
    var items = (payload.lines || []).filter(Boolean).map(function (l) {
      return { itemId: l.itemId, qty: l.qty, selections: l.selections || {}, note: l.note || '' };
    });
    return sb.rpc('place_order', {
      p_restaurant: current.slug,
      p_table: String(payload.table || ''),
      p_items: items,
      p_note: payload.note || ''
    }).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var o = upsert(fromRow(r.data));
      tracked[o.id] = o.status;
      ensurePolling();
      return clone(o);
    });
  };

  // Équipe : changement de statut (optimiste, puis confirmé par le serveur).
  T.updateOrderStatus = function (id, status) {
    var o = findOrder(id);
    if (!o || o.status === status) return clone(o);
    o.status = status;
    o.seen = true;
    o.history.push({ status: status, at: Date.now() });
    if (status === 'terminee' && o.payment.status === 'pending') o.payment.status = 'paid';
    emit('order:updated', clone(o));
    sb.rpc('set_order_status', { p_id: id, p_status: status }).then(function (r) {
      if (r.error) throw r.error;
      if (r.data) upsert(fromRow(r.data));
    }).catch(function (e) { fail(e); loadOrders(); });
    return clone(o);
  };

  T.markSeen = function (id) {
    var o = findOrder(id);
    if (!o || o.seen) return;
    o.seen = true;
    emit('order:updated', clone(o));
    sb.from('orders').update({ seen: true }).eq('id', id).then(function (r) { if (r.error) fail(r.error); });
  };

  /* ---------------- Côté client ---------------- */
  // slug absent (ancienne plaque sans ?r=) : accepté s'il n'existe qu'un restaurant.
  T.openRestaurant = function (slug) {
    var q = sb.from('restaurants').select('id, slug, info, menu, active');
    q = slug ? q.eq('slug', slug).limit(1) : q.eq('active', true).limit(2);
    return q.then(function (r) {
      if (r.error) throw new Error('Base de données inaccessible : ' + r.error.message);
      var rows = r.data || [];
      if (!slug && rows.length !== 1) throw notFound(rows.length ? 'old-link' : 'closed', '');
      if (!rows.length) throw notFound('unknown', slug);
      if (!rows[0].active) throw notFound('closed', slug);
      current = { id: rows[0].id, slug: rows[0].slug, role: null };
      applyRestaurant(rows[0]);
      subscribeRestaurant();
      return clone(current);
    });
  };

  var tracked = {};
  var pollTimer = null;

  function pollOnce(announce) {
    var ids = Object.keys(tracked).filter(function (id) { return tracked[id] !== 'terminee'; });
    if (!ids.length) return Promise.resolve();
    return Promise.all(ids.map(function (id) {
      return sb.rpc('get_order', { p_id: id }).then(function (r) {
        if (r.error) return;
        if (!r.data) { delete tracked[id]; return; }
        var o = upsert(fromRow(r.data));
        var prev = tracked[id];
        tracked[id] = o.status;
        if (prev && prev !== o.status) emit('order:updated', clone(o));
      });
    })).then(function () { if (announce) emit('orders:sync', null); });
  }

  function ensurePolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () { if (!document.hidden) pollOnce(false); }, 4000);
  }

  T.track = function (ids) {
    [].concat(ids || []).filter(function (id) { return UUID.test(id); }).forEach(function (id) {
      if (!(id in tracked)) tracked[id] = null;
    });
    ensurePolling();
    return pollOnce(true);
  };

  /* ---------------- Comptes ---------------- */
  T.auth = {
    session: function () {
      return sb.auth.getSession().then(function (r) { return r.data.session; });
    },
    signIn: function (email, password) {
      return sb.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
        if (r.error) {
          throw new Error(/invalid login/i.test(r.error.message) ? 'E-mail ou mot de passe incorrect.' : r.error.message);
        }
        return r.data.session;
      });
    },
    signOut: function () { return sb.auth.signOut(); },
    changePassword: function (password) {
      return sb.auth.updateUser({ password: password }).then(function (r) {
        if (r.error) {
          throw new Error(/different from the old/i.test(r.error.message)
            ? 'Le nouveau mot de passe doit être différent de l’ancien.'
            : /at least/i.test(r.error.message) ? 'Mot de passe trop court (6 caractères minimum).' : r.error.message);
        }
      });
    },
    // [{ id, slug, name, active, role: 'admin' | 'owner' | 'equipe' }]
    myRestaurants: function () {
      return sb.rpc('my_restaurants').then(function (r) {
        if (r.error) throw r.error;
        return r.data || [];
      });
    },
    isAdmin: function () {
      return sb.rpc('is_admin').then(function (r) { return !r.error && r.data === true; });
    }
  };

  /* ---------------- Espace équipe ---------------- */
  var staffStarted = false;

  function loadOrders() {
    var since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    return sb.from('orders').select('*')
      .eq('restaurant_id', current.id)
      .or('status.neq.terminee,created_at.gte."' + since + '"')
      .order('created_at', { ascending: true })
      .limit(500)
      .then(function (r) {
        if (r.error) throw r.error;
        cache.orders = r.data.map(fromRow);
        emit('orders:sync', null);
      });
  }

  T.startStaff = function (restaurant) {
    if (staffStarted) return Promise.resolve();
    staffStarted = true;
    current = { id: restaurant.id, slug: restaurant.slug, role: restaurant.role };

    return sb.from('restaurants').select('info, menu').eq('id', current.id).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      if (!r.data) throw new Error('Restaurant introuvable.');
      applyRestaurant(r.data);
      subscribeRestaurant();
      return loadOrders();
    }).then(function () {
      sb.channel('tapigo-orders-' + current.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: 'restaurant_id=eq.' + current.id }, function (p) {
          if (p.eventType === 'DELETE') {
            cache.orders = cache.orders.filter(function (o) { return !p.old || o.id !== p.old.id; });
            emit('orders:sync', null);
            return;
          }
          var isNew = !findOrder(p.new.id);
          var o = upsert(fromRow(p.new));
          emit(isNew ? 'order:created' : 'order:updated', clone(o));
        })
        .subscribe(function (status) {
          // Après une coupure réseau : on recharge pour ne rien manquer.
          if (status === 'SUBSCRIBED') loadOrders().catch(fail);
        });

      // Filet de sécurité si l'écran s'est mis en veille.
      document.addEventListener('visibilitychange', function () { if (!document.hidden) loadOrders().catch(fail); });
      setInterval(function () { loadOrders().catch(fail); }, 60000);
    });
  };

  /* ---------------- Administration Tapigo ---------------- */
  function rpc(name, args) {
    return sb.rpc(name, args || {}).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return r.data;
    });
  }

  T.admin = {
    listRestaurants: function () {
      return sb.from('restaurants').select('id, slug, info, active, created_at, menu')
        .order('created_at', { ascending: true })
        .then(function (r) {
          if (r.error) throw r.error;
          return r.data.map(function (x) {
            return {
              id: x.id, slug: x.slug, active: x.active,
              info: Object.assign(clone(DEFAULT_INFO), x.info || {}),
              items: (x.menu && x.menu.items) ? x.menu.items.length : 0
            };
          });
        });
    },
    createRestaurant: function (name, slug, tables, menu) {
      return rpc('admin_create_restaurant', { p_name: name, p_slug: slug, p_tables: tables, p_menu: menu || null });
    },
    setActive: function (id, active) { return rpc('admin_set_active', { p_restaurant: id, p_active: active }); },
    listMembers: function (id) { return rpc('admin_list_members', { p_restaurant: id }); },
    addMember: function (id, email, role) { return rpc('admin_add_member', { p_restaurant: id, p_email: email, p_role: role }); },
    removeMember: function (id, userId) { return rpc('admin_remove_member', { p_restaurant: id, p_user: userId }); }
  };

  /* ---------------- Démarrage ---------------- */
  T.ready = loadScript(SUPABASE_JS).then(function () {
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  });
})();
