/* ==========================================================================
   Tapigo — Store (backend simulé)

   Toute la persistance passe par ce module : le menu client et le dashboard
   cuisine ne lisent / n'écrivent jamais localStorage directement.
   Pour passer en production, il suffit de réimplémenter cette API
   (mêmes noms de fonctions) au-dessus de Supabase, Firebase ou d'une API
   REST + WebSocket :

     getRestaurant()            -> GET  /api/restaurant
     getMenu()                  -> GET  /api/menu
     saveItem(item)             -> PUT  /api/menu/items/:id
     deleteItem(id)             -> DELETE /api/menu/items/:id
     getOrders()                -> GET  /api/orders?open=true
     createOrder(payload)       -> POST /api/orders   (après paiement Stripe)
     updateOrderStatus(id, s)   -> PATCH /api/orders/:id
     subscribe(fn)              -> WebSocket / Realtime channel

   En démo, la synchronisation temps réel entre onglets utilise
   BroadcastChannel (repli sur l'événement "storage").
   ========================================================================== */
(function () {
  'use strict';

  var DEMO = window.TAPIGO_DEMO;
  var NS = 'tapigo.v1.';
  var K = {
    restaurant: NS + 'restaurant',
    menu: NS + 'menu',
    orders: NS + 'orders',
    seq: NS + 'seq'
  };

  var memory = {};
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw != null) return JSON.parse(raw);
    } catch (e) { /* stockage indisponible : mémoire */ }
    return key in memory ? clone(memory[key]) : clone(fallback);
  }

  function write(key, value) {
    memory[key] = clone(value);
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  function remove(key) {
    delete memory[key];
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  /* ---------------- Temps réel ---------------- */
  var listeners = [];
  var bc = null;
  try { bc = new BroadcastChannel('tapigo'); } catch (e) { bc = null; }

  function notify(msg, remote) {
    listeners.slice().forEach(function (fn) {
      try { fn(msg, remote); } catch (e) { console.error(e); }
    });
  }

  function emit(type, payload) {
    var msg = { type: type, payload: payload, at: Date.now() };
    notify(msg, false);
    if (bc) bc.postMessage(msg);
  }

  if (bc) {
    bc.onmessage = function (e) { notify(e.data, true); };
  } else {
    window.addEventListener('storage', function (e) {
      if (e.key === K.orders) notify({ type: 'orders:sync' }, true);
      if (e.key === K.menu) notify({ type: 'menu:updated' }, true);
      if (e.key === K.restaurant) notify({ type: 'restaurant:updated' }, true);
    });
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  /* ---------------- Statuts ---------------- */
  var STATUSES = [
    { id: 'nouvelle', label: 'Nouvelle', client: 'Commande envoyée en cuisine', hint: 'Le chef a bien reçu votre commande.' },
    { id: 'preparation', label: 'En préparation', client: 'En préparation', hint: 'Vos plats sont en cours de préparation.' },
    { id: 'prete', label: 'Prête', client: 'Prête à être servie', hint: 'Votre commande arrive à votre table.' },
    { id: 'servie', label: 'Servie', client: 'Servie', hint: 'Bon appétit !' },
    { id: 'terminee', label: 'Terminée', client: 'Terminée', hint: 'Merci de votre visite, à très bientôt.' }
  ];
  function statusInfo(id) {
    return STATUSES.filter(function (s) { return s.id === id; })[0] || STATUSES[0];
  }

  /* ---------------- Seed ---------------- */
  function seed() {
    write(K.restaurant, DEMO.restaurant);
    write(K.menu, { categories: DEMO.categories, tags: DEMO.tags, items: DEMO.items });
    write(K.seq, 1040);
    write(K.orders, []);

    // Quelques commandes pour que le dashboard ne soit pas vide.
    var now = Date.now();
    var demoOrders = [
      { table: 4, ago: 14, status: 'preparation', pay: 'card', lines: [
        ['entrecote', 2, { cuisson: ['Saignante'], accompagnement: ['Frites maison'], sauce: ['Béarnaise'] }, ''],
        ['bordeaux', 2, { contenance: ['Verre 12 cl'] }, '']
      ], note: '' },
      { table: 9, ago: 6, status: 'nouvelle', pay: 'onsite', lines: [
        ['burger', 1, { cuisson: ['À point'], accompagnement: ['Salade verte'], supplements: ['Bacon fumé'] }, 'Sans oignon'],
        ['citronnade', 1, {}, '']
      ], note: 'Allergie aux fruits à coque' },
      { table: 2, ago: 22, status: 'prete', pay: 'applepay', lines: [
        ['burrata', 1, {}, ''],
        ['risotto', 1, { truffe: ['Truffe noire râpée'] }, '']
      ], note: '' }
    ];
    demoOrders.forEach(function (d) {
      var o = createOrder({
        table: d.table,
        note: d.note,
        payment: { method: d.pay, status: d.pay === 'onsite' ? 'pending' : 'paid' },
        lines: d.lines.map(function (l) { return buildLine(l[0], l[1], l[2], l[3]); })
      }, { silent: true });
      var created = now - d.ago * 60000;
      patchOrder(o.id, function (ord) {
        ord.createdAt = created;
        ord.history = [{ status: 'nouvelle', at: created }];
        if (d.status !== 'nouvelle') ord.history.push({ status: d.status, at: created + 4 * 60000 });
        ord.status = d.status;
        ord.seen = true;
      });
    });
  }

  /* ---------------- Restaurant & Menu ---------------- */
  function getRestaurant() { return read(K.restaurant, DEMO.restaurant); }

  function saveRestaurant(r) {
    write(K.restaurant, r);
    emit('restaurant:updated', r);
  }

  function getMenu() {
    return read(K.menu, { categories: DEMO.categories, tags: DEMO.tags, items: DEMO.items });
  }

  function getItem(id) {
    return window.Tapigo.getMenu().items.filter(function (i) { return i.id === id; })[0] || null;
  }

  function slug(s) {
    return String(s || 'plat').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'plat';
  }

  function saveItem(item) {
    var menu = getMenu();
    if (!item.id) {
      var base = slug(item.name), id = base, n = 2;
      while (menu.items.some(function (i) { return i.id === id; })) id = base + '-' + n++;
      item.id = id;
    }
    var idx = menu.items.findIndex(function (i) { return i.id === item.id; });
    if (idx >= 0) menu.items[idx] = item; else menu.items.push(item);
    write(K.menu, menu);
    emit('menu:updated', { id: item.id });
    return item;
  }

  function deleteItem(id) {
    var menu = getMenu();
    menu.items = menu.items.filter(function (i) { return i.id !== id; });
    write(K.menu, menu);
    emit('menu:updated', { id: id });
  }

  function setAvailable(id, available) {
    var item = getItem(id);
    if (!item) return;
    item.available = !!available;
    saveItem(item);
  }

  /* ---------------- Commandes ---------------- */
  // selections : { groupId: [label, ...] }
  function buildLine(itemId, qty, selections, note) {
    var item = window.Tapigo.getItem(itemId);
    if (!item) return null;
    var unit = item.price;
    var options = [];
    (item.options || []).forEach(function (g) {
      var picked = (selections && selections[g.id]) || [];
      if (!picked.length) return;
      picked.forEach(function (label) {
        var c = g.choices.filter(function (ch) { return ch.label === label; })[0];
        if (c) unit += Number(c.price) || 0;
      });
      options.push({ group: g.name, values: picked.slice() });
    });
    return {
      itemId: item.id,
      name: item.name,
      station: item.station || 'cuisine',
      qty: qty,
      unitPrice: Math.round(unit * 100) / 100,
      options: options,
      selections: selections || {},
      note: note || ''
    };
  }

  function getOrders() { return read(K.orders, []); }

  function getOrder(id) {
    return getOrders().filter(function (o) { return o.id === id; })[0] || null;
  }

  function patchOrder(id, mutate) {
    var orders = getOrders();
    var o = orders.filter(function (x) { return x.id === id; })[0];
    if (!o) return null;
    mutate(o);
    write(K.orders, orders);
    return o;
  }

  function createOrder(payload, opts) {
    var lines = (payload.lines || []).filter(Boolean);
    var total = lines.reduce(function (s, l) { return s + l.unitPrice * l.qty; }, 0);
    var seq = read(K.seq, 1040) + 1;
    write(K.seq, seq);
    var now = Date.now();
    var order = {
      id: 'o_' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      number: seq,
      table: String(payload.table || '?'),
      lines: lines,
      note: payload.note || '',
      payment: payload.payment || { method: 'onsite', status: 'pending' },
      total: Math.round(total * 100) / 100,
      status: 'nouvelle',
      createdAt: now,
      history: [{ status: 'nouvelle', at: now }],
      seen: false
    };
    var orders = getOrders();
    orders.push(order);
    write(K.orders, orders);
    if (!(opts && opts.silent)) emit('order:created', order);
    return order;
  }

  function updateOrderStatus(id, status) {
    var o = patchOrder(id, function (ord) {
      if (ord.status === status) return;
      ord.status = status;
      ord.seen = true;
      ord.history.push({ status: status, at: Date.now() });
      if (status === 'terminee' && ord.payment.status === 'pending') ord.payment.status = 'paid';
    });
    if (o) emit('order:updated', o);
    return o;
  }

  function markSeen(id) {
    var o = patchOrder(id, function (ord) { ord.seen = true; });
    if (o) emit('order:updated', o);
  }

  function resetDemo() {
    Object.keys(K).forEach(function (k) { remove(K[k]); });
    seed();
    emit('demo:reset', null);
  }

  /* ---------------- Helpers partagés ---------------- */
  var money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
  function fmt(n) { return money.format(Number(n) || 0); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clock(ts) {
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function minutesSince(ts) { return Math.max(0, Math.floor((Date.now() - ts) / 60000)); }

  window.Tapigo = {
    mode: 'demo',
    ready: Promise.resolve(),
    track: function () { return Promise.resolve(); },
    _emit: emit,
    _slug: slug,
    STATUSES: STATUSES,
    statusInfo: statusInfo,
    subscribe: subscribe,
    getRestaurant: getRestaurant,
    saveRestaurant: saveRestaurant,
    getMenu: getMenu,
    getItem: getItem,
    saveItem: saveItem,
    deleteItem: deleteItem,
    setAvailable: setAvailable,
    buildLine: buildLine,
    getOrders: getOrders,
    getOrder: getOrder,
    createOrder: createOrder,
    updateOrderStatus: updateOrderStatus,
    markSeen: markSeen,
    resetDemo: resetDemo,
    read: read,
    write: write,
    fmt: fmt,
    esc: esc,
    clock: clock,
    minutesSince: minutesSince
  };

  if (!read(K.menu, null)) seed();
})();
