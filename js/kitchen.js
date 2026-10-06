/* ==========================================================================
   Tapigo — Dashboard restaurateur (Cuisine / Bar)
   Commandes temps réel · alertes sonores · statuts · édition du menu
   ========================================================================== */
(function () {
  'use strict';

  var T = Tapigo, UI = TapigoUI, I = UI.ICONS, esc = T.esc, fmt = T.fmt;
  var LIVE = T.mode === 'live';
  var $ = function (s, root) { return (root || document).querySelector(s); };

  var SOUND_KEY = 'tapigo.v1.kitchen.sound';
  var PREFS_KEY = 'tapigo.v1.kitchen.prefs';
  var prefs = T.read(PREFS_KEY, { layout: 'status', station: 'all' });

  var state = {
    view: 'orders',
    layout: prefs.layout,
    station: prefs.station,
    sound: T.read(SOUND_KEY, false),
    q: ''
  };

  var FLOW = ['nouvelle', 'preparation', 'prete', 'servie', 'terminee'];
  var COLUMNS = [
    { id: 'nouvelle', label: 'Nouvelles', color: 'var(--danger)' },
    { id: 'preparation', label: 'En préparation', color: 'var(--warn)' },
    { id: 'prete', label: 'Prêtes', color: 'var(--ok)' },
    { id: 'servie', label: 'Servies', color: 'var(--info)' }
  ];
  var ACTIONS = [
    { id: 'preparation', label: 'En préparation' },
    { id: 'prete', label: 'Prête' },
    { id: 'servie', label: 'Servie' },
    { id: 'terminee', label: 'Terminée' }
  ];
  var PAY = { applepay: 'Apple Pay', card: 'Carte', onsite: 'Sur place' };

  function savePrefs() { T.write(PREFS_KEY, { layout: state.layout, station: state.station }); }

  /* ======================================================================
     Commandes
     ====================================================================== */
  function activeOrders() {
    return T.getOrders().filter(function (o) { return o.status !== 'terminee'; })
      .sort(function (a, b) { return a.createdAt - b.createdAt; });
  }

  function forStation(o) {
    return state.station === 'all' || o.lines.some(function (l) { return l.station === state.station; });
  }

  function timerHTML(o) {
    var m = T.minutesSince(o.createdAt);
    var cls = o.status === 'servie' ? '' : m >= 20 ? ' timer--late' : m >= 10 ? ' timer--warn' : '';
    return '<span class="timer' + cls + '" data-since="' + o.createdAt + '" data-status="' + o.status + '">' + m + ' min</span>';
  }

  function ticketHTML(o) {
    var cur = FLOW.indexOf(o.status);
    var col = COLUMNS.filter(function (c) { return c.id === o.status; })[0];
    var paid = o.payment.status === 'paid';
    var items = o.lines.reduce(function (s, l) { return s + l.qty; }, 0);

    return '<article class="ticket' + (o.seen ? '' : ' is-new') + '" data-order="' + esc(o.id) + '" style="--st:' + (col ? col.color : 'var(--line)') + '">' +
      '<header class="ticket__head">' +
        '<div class="ticket__table"><div><small>Table</small><b>' + esc(o.table) + '</b></div></div>' +
        '<div class="ticket__meta"><strong>N° ' + o.number + (o.seen ? '' : ' · <span style="color:var(--danger)">Nouvelle</span>') + '</strong>' +
          '<span>' + T.clock(o.createdAt) + ' · ' + items + ' article' + (items > 1 ? 's' : '') + '</span></div>' +
        timerHTML(o) +
      '</header>' +
      '<ul class="ticket__lines">' + o.lines.map(function (l) {
        var other = state.station !== 'all' && l.station !== state.station;
        return '<li class="ticket__line' + (other ? ' is-other' : '') + '"><span class="q">' + l.qty + '×</span><div>' +
          '<div class="n">' + esc(l.name) + (l.station === 'bar' ? ' <span class="badge badge--info">Bar</span>' : '') + '</div>' +
          l.options.map(function (op) { return '<div class="o">' + esc(op.group) + ' : ' + esc(op.values.join(', ')) + '</div>'; }).join('') +
          (l.note ? '<div class="note">⚠ ' + esc(l.note) + '</div>' : '') +
        '</div></li>';
      }).join('') + '</ul>' +
      (o.note ? '<p class="ticket__note">📝 ' + esc(o.note) + '</p>' : '') +
      '<div class="ticket__foot"><span class="badge ' + (paid ? 'badge--ok' : 'badge--warn') + '">' +
        (paid ? 'Payé · ' + PAY[o.payment.method] : 'À encaisser') + '</span>' +
        '<button class="link-btn" type="button" data-print title="Imprimer le ticket">🖨 Imprimer</button>' +
        '<strong>' + fmt(o.total) + '</strong></div>' +
      '<div class="ticket__actions">' + ACTIONS.map(function (a) {
        var i = FLOW.indexOf(a.id);
        var cls = i === cur ? ' is-active' : i === cur + 1 ? ' is-next' : i < cur ? ' is-past' : '';
        return '<button class="st-btn' + cls + '" type="button" data-status="' + a.id + '"' + (i === cur ? ' aria-current="true"' : '') + '>' + a.label + '</button>';
      }).join('') + '</div>' +
    '</article>';
  }

  function statsHTML(all) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var todays = T.getOrders().filter(function (o) { return o.createdAt >= today.getTime(); });
    var count = function (s) { return all.filter(function (o) { return o.status === s; }).length; };
    return '<div class="k-stats">' +
      '<div class="k-stat"><span>À traiter</span><b>' + count('nouvelle') + '</b></div>' +
      '<div class="k-stat"><span>En préparation</span><b>' + count('preparation') + '</b></div>' +
      '<div class="k-stat"><span>Prêtes à servir</span><b>' + count('prete') + '</b></div>' +
      '<div class="k-stat"><span>Chiffre du service</span><b>' + fmt(todays.reduce(function (s, o) { return s + o.total; }, 0)) + '</b></div>' +
    '</div>';
  }

  function seg(name, current, options) {
    return '<div class="seg" role="group">' + options.map(function (o) {
      return '<button type="button" data-' + name + '="' + o[0] + '" aria-pressed="' + (current === o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function requestsHTML() {
    var list = T.getServiceRequests();
    if (!list.length) return '';
    return '<div class="requests" role="region" aria-label="Appels des tables">' + list.map(function (q) {
      var m = T.minutesSince(Date.parse(q.created_at));
      return '<div class="request request--' + esc(q.kind) + '">' +
        '<span class="request__icon" aria-hidden="true">' + (q.kind === 'addition' ? '🧾' : '🙋') + '</span>' +
        '<span class="request__text"><strong>Table ' + esc(q.table_label) + '</strong> ' +
          (q.kind === 'addition' ? 'demande l’addition' : 'appelle un serveur') +
          '<small>il y a ' + m + ' min</small></span>' +
        '<button class="btn btn--primary btn--sm" type="button" data-request-done="' + esc(q.id) + '">C’est fait</button>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderOrders() {
    var all = activeOrders();
    var shown = all.filter(forStation);
    var html = requestsHTML() + statsHTML(all) +
      '<div class="k-filters">' +
        seg('layout', state.layout, [['status', 'Par statut'], ['table', 'Par table']]) +
        seg('station', state.station, [['all', 'Tout'], ['cuisine', 'Cuisine'], ['bar', 'Bar']]) +
        (state.sound ? '' : '<button class="btn btn--soft btn--sm" type="button" data-enable-sound>' + I.bell.replace('<svg ', '<svg width="16" height="16" ') + ' Activer les alertes sonores</button>') +
      '</div>';

    if (state.layout === 'status') {
      html += '<div class="board">' + COLUMNS.map(function (c) {
        var list = shown.filter(function (o) { return o.status === c.id; });
        return '<section class="col" aria-label="' + c.label + '"><div class="col__head"><h2><span class="col__dot" style="background:' + c.color + '"></span>' + c.label + '</h2>' +
          '<span class="badge">' + list.length + '</span></div><div class="col__list">' +
          (list.length ? list.map(ticketHTML).join('') : '<div class="col__empty">Aucune commande</div>') +
          '</div></section>';
      }).join('') + '</div>';
    } else {
      var tables = {};
      shown.forEach(function (o) { (tables[o.table] = tables[o.table] || []).push(o); });
      var keys = Object.keys(tables).sort(function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || a.localeCompare(b); });
      html += keys.length
        ? '<div class="tables-grid">' + keys.map(function (k) {
            var list = tables[k];
            var due = list.filter(function (o) { return o.payment.status !== 'paid'; }).reduce(function (s, o) { return s + o.total; }, 0);
            var total = list.reduce(function (s, o) { return s + o.total; }, 0);
            return '<section class="table-group"><div class="table-group__head"><h2>Table ' + esc(k) + '</h2>' +
              (due ? '<span class="badge badge--warn">À encaisser ' + fmt(due) + '</span>' : '<span class="badge badge--ok">Réglée</span>') + '</div>' +
              list.map(ticketHTML).join('') +
              '<div class="table-group__foot"><span>Total de la table <strong>' + fmt(total) + '</strong></span>' +
              '<button class="btn btn--primary btn--sm" type="button" data-close-table="' + esc(k) + '">Encaisser &amp; clôturer</button></div>' +
              '</section>';
          }).join('') + '</div>'
        : '<div class="empty"><h3>Service calme</h3><p>Aucune commande en cours. Les nouvelles commandes apparaîtront ici instantanément.</p></div>';
    }

    var done = T.getOrders().filter(function (o) { return o.status === 'terminee'; }).sort(function (a, b) { return b.createdAt - a.createdAt; });
    if (done.length) {
      html += '<details class="k-history"><summary>Historique · ' + done.length + ' commande' + (done.length > 1 ? 's' : '') + ' terminée' + (done.length > 1 ? 's' : '') + '</summary>' +
        '<div style="overflow-x:auto"><table><thead><tr><th>N°</th><th>Table</th><th>Heure</th><th>Articles</th><th>Paiement</th><th>Total</th><th></th></tr></thead><tbody>' +
        done.slice(0, 30).map(function (o) {
          return '<tr><td>' + o.number + '</td><td>' + esc(o.table) + '</td><td>' + T.clock(o.createdAt) + '</td>' +
            '<td>' + esc(o.lines.map(function (l) { return l.qty + '× ' + l.name; }).join(', ')) + '</td>' +
            '<td>' + PAY[o.payment.method] + '</td><td>' + fmt(o.total) + '</td>' +
            '<td><button class="link-btn" type="button" data-reopen="' + esc(o.id) + '">Rouvrir</button></td></tr>';
        }).join('') + '</tbody></table></div></details>';
    }

    var view = $('#ordersView');
    var openHistory = view.querySelector('.k-history[open]');
    var boardScroll = view.querySelector('.board') ? view.querySelector('.board').scrollLeft : 0;
    view.innerHTML = html;
    if (openHistory && view.querySelector('.k-history')) view.querySelector('.k-history').open = true;
    if (view.querySelector('.board')) view.querySelector('.board').scrollLeft = boardScroll;
    updateBadges();
  }

  function updateBadges() {
    var unseen = T.getOrders().filter(function (o) { return !o.seen && o.status !== 'terminee'; }).length;
    var c = $('#newCount');
    c.hidden = !unseen;
    c.textContent = unseen;
    document.title = (unseen ? '(' + unseen + ') ' : '') + 'Cuisine · ' + T.getRestaurant().name;
  }

  function tickTimers() {
    document.querySelectorAll('.timer[data-since]').forEach(function (el) {
      var m = T.minutesSince(+el.dataset.since);
      el.textContent = m + ' min';
      el.classList.toggle('timer--warn', el.dataset.status !== 'servie' && m >= 10 && m < 20);
      el.classList.toggle('timer--late', el.dataset.status !== 'servie' && m >= 20);
    });
    $('#kClock').textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------------- Nouvelle commande : son + visuel ---------------- */
  function announce(order) {
    if (state.sound) UI.chime();
    UI.vibrate([80, 60, 80]);
    UI.toast('🔔 <strong>Nouvelle commande · Table ' + esc(order.table) + '</strong><br>' +
      order.lines.map(function (l) { return l.qty + '× ' + esc(l.name); }).join(', '), 5000);
  }

  /* Simule un client qui commande depuis sa table (démo). */
  function simulateOrder() {
    var r = T.getRestaurant();
    var items = T.getMenu().items.filter(function (i) { return i.available !== false; });
    if (!items.length) return UI.toast('Aucun produit disponible au menu');
    var pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
    var n = 1 + Math.floor(Math.random() * 3);
    var lines = [];
    for (var k = 0; k < n; k++) {
      var item = pick(items), sel = {};
      (item.options || []).forEach(function (g) {
        if (g.required || Math.random() < .3) sel[g.id] = [pick(g.choices).label];
      });
      lines.push(T.buildLine(item.id, 1 + (Math.random() < .3 ? 1 : 0), sel, Math.random() < .2 ? pick(['Sans oignon', 'Sauce à part', 'Bien chaud svp', 'Sans gluten si possible']) : ''));
    }
    T.createOrder({
      table: 1 + Math.floor(Math.random() * (r.tables || 12)),
      lines: lines,
      note: Math.random() < .15 ? 'Anniversaire : une bougie au dessert 🎂' : '',
      payment: pick([{ method: 'applepay', status: 'paid' }, { method: 'card', status: 'paid' }, { method: 'onsite', status: 'pending' }])
    });
  }

  /* ======================================================================
     Éditeur de menu
     ====================================================================== */
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function renderMenuEditor() {
    var menu = T.getMenu();
    var q = norm(state.q);
    var off = menu.items.filter(function (i) { return i.available === false; }).length;

    if (LIVE && !menu.items.length) {
      $('#menuView').innerHTML = '<div class="editor"><div class="empty"><h3>La carte est vide</h3>' +
        '<p>Partez de la carte de démonstration et adaptez-la, ou ajoutez vos plats un par un.</p>' +
        '<p style="margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
          '<button class="btn btn--primary" type="button" data-import-demo>Importer la carte de démonstration</button>' +
          '<button class="btn btn--ghost" type="button" data-new>Ajouter un plat</button>' +
          '<button class="btn btn--ghost" type="button" data-settings>Établissement</button></p></div></div>';
      return;
    }
    if (!menu.categories.length) menu.categories = window.TAPIGO_DEMO.categories;

    var html = '<div class="editor">' +
      '<div class="editor__bar">' +
        '<label class="search">' + I.search + '<input id="menuSearch" type="search" placeholder="Rechercher un produit…" value="' + esc(state.q) + '" aria-label="Rechercher un produit"></label>' +
        '<button class="btn btn--primary" type="button" data-new>' + I.plus.replace('<svg ', '<svg width="16" height="16" ') + ' Ajouter un plat</button>' +
        '<button class="btn btn--ghost" type="button" data-categories>Catégories</button>' +
        '<button class="btn btn--ghost" type="button" data-settings>Établissement</button>' +
      '</div>' +
      '<p class="eyebrow">' + menu.items.length + ' produits · ' + off + ' en rupture (masqué' + (off > 1 ? 's' : '') + ' côté client)</p>' +
      menu.categories.map(function (c) {
        var list = menu.items.filter(function (i) { return i.category === c.id && (!q || norm(i.name + ' ' + i.description).indexOf(q) >= 0); });
        if (!list.length) {
          return q ? '' : '<section class="editor-cat"><h2>' + esc(c.label) + '</h2><p class="help">Aucun plat dans cette catégorie. ' +
            '<button class="link-btn" type="button" data-new="' + esc(c.id) + '">Ajouter un plat</button></p></section>';
        }
        return '<section class="editor-cat"><h2>' + esc(c.label) + '</h2><div class="editor-list">' + list.map(function (i) {
          var on = i.available !== false;
          return '<div class="editor-row' + (on ? '' : ' is-off') + '" data-item="' + esc(i.id) + '">' +
            UI.media(i, 'editor-row__thumb') +
            '<div class="editor-row__name"><strong>' + esc(i.name) + '</strong><span>' +
              (i.station === 'bar' ? 'Bar' : 'Cuisine') + ((i.options || []).length ? ' · ' + i.options.length + ' option' + (i.options.length > 1 ? 's' : '') : '') + '</span></div>' +
            '<div class="price-input"><input type="text" inputmode="decimal" value="' + String(i.price).replace('.', ',') + '" data-price aria-label="Prix de ' + esc(i.name) + '"></div>' +
            '<label class="switch editor-row__toggle"><input type="checkbox" data-avail' + (on ? ' checked' : '') + '><span class="switch__track"></span><span>' + (on ? 'En stock' : 'Rupture') + '</span></label>' +
            '<div class="editor-row__actions">' +
              '<button class="icon-btn" type="button" data-edit aria-label="Modifier ' + esc(i.name) + '">' + I.edit + '</button>' +
              '<button class="icon-btn" type="button" data-delete aria-label="Supprimer ' + esc(i.name) + '">' + I.trash + '</button>' +
            '</div>' +
          '</div>';
        }).join('') + '</div></section>';
      }).join('') +
      (LIVE ? '' : '<div style="text-align:center;padding-top:12px"><button class="btn btn--danger btn--sm" type="button" data-reset>' + I.reset.replace('<svg ', '<svg width="14" height="14" ') + ' Réinitialiser les données de démo</button></div>') +
    '</div>';

    var view = $('#menuView');
    var focusSearch = document.activeElement && document.activeElement.id === 'menuSearch';
    var caret = focusSearch ? document.activeElement.selectionStart : 0;
    view.innerHTML = html;
    if (focusSearch) { var s = $('#menuSearch'); s.focus(); s.setSelectionRange(caret, caret); }
  }

  function parsePrice(v) {
    var n = parseFloat(String(v).replace(/\s|€/g, '').replace(',', '.'));
    return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  }

  function choicesToText(choices) {
    return (choices || []).map(function (c) { return c.label + (Number(c.price) ? ' +' + String(c.price).replace('.', ',') : ''); }).join(', ');
  }

  function textToChoices(text) {
    return String(text || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      var m = /^(.*?)\s*\+\s*(\d+(?:[.,]\d+)?)\s*€?$/.exec(s);
      return m ? { label: m[1].trim(), price: parsePrice(m[2]) || 0 } : { label: s, price: 0 };
    });
  }

  function groupEditHTML(g) {
    return '<div class="optgroup-edit" data-gid="' + esc(g.id || '') + '">' +
      '<label class="field"><span>Nom du groupe</span><input data-g="name" value="' + esc(g.name || '') + '" placeholder="Ex : Cuisson"></label>' +
      '<label class="field"><span>Type</span><select data-g="type">' +
        '<option value="single"' + (g.type !== 'multi' ? ' selected' : '') + '>Choix unique</option>' +
        '<option value="multi"' + (g.type === 'multi' ? ' selected' : '') + '>Choix multiple</option></select></label>' +
      '<label class="switch"><input type="checkbox" data-g="required"' + (g.required ? ' checked' : '') + '><span class="switch__track"></span><span>Obligatoire</span></label>' +
      '<button class="icon-btn" type="button" data-remove-group aria-label="Supprimer le groupe">' + I.trash + '</button>' +
      '<label class="field span-all"><span>Choix (séparés par des virgules, « +2 » pour un supplément)</span>' +
        '<input data-g="choices" value="' + esc(choicesToText(g.choices)) + '" placeholder="Saignante, À point, Purée truffée +3"></label>' +
    '</div>';
  }

  function openItemForm(id, categoryId) {
    var menu = T.getMenu();
    if (!menu.categories.length) { menu.categories = window.TAPIGO_DEMO.categories; menu.tags = window.TAPIGO_DEMO.tags; }
    var item = id ? T.getItem(id) : { name: '', description: '', price: '', category: categoryId || menu.categories[0].id, station: 'cuisine', image: '', emoji: '🍽️', tags: [], allergens: '', available: true, options: [] };
    if (!item) return;
    var tags = menu.tags || {};
    var hasAllergen = T.itemAllergens(item).map(function (a) { return a.id; });
    var others = menu.items.filter(function (i) { return i.id !== item.id; });

    UI.openSheet({
      label: id ? 'Modifier un produit' : 'Nouveau produit',
      head: '<p class="eyebrow">' + (id ? 'Modifier' : 'Nouveau produit') + '</p><h2>' + (id ? esc(item.name) : 'Ajouter un plat') + '</h2>',
      body:
        '<form id="itemForm" class="form-grid" novalidate>' +
          '<label class="field span-2"><span>Nom</span><input name="name" required maxlength="60" value="' + esc(item.name) + '" autofocus></label>' +
          '<label class="field span-2"><span>Description</span><textarea name="description" maxlength="200">' + esc(item.description) + '</textarea></label>' +
          '<label class="field"><span>Prix (€)</span><input name="price" inputmode="decimal" required value="' + esc(String(item.price).replace('.', ',')) + '" placeholder="18,50"></label>' +
          '<label class="field"><span>Catégorie</span><select name="category">' + menu.categories.map(function (c) {
            return '<option value="' + esc(c.id) + '"' + (c.id === item.category ? ' selected' : '') + '>' + esc(c.label) + '</option>';
          }).join('') + '</select></label>' +
          '<label class="field"><span>Poste</span><select name="station">' +
            '<option value="cuisine"' + (item.station !== 'bar' ? ' selected' : '') + '>Cuisine</option>' +
            '<option value="bar"' + (item.station === 'bar' ? ' selected' : '') + '>Bar</option></select></label>' +
          '<label class="field"><span>Emoji (si pas de photo)</span><input name="emoji" maxlength="4" value="' + esc(item.emoji || '') + '"></label>' +
          '<div class="field span-2"><span>Photo</span><div class="photo-field">' +
            '<div class="media photo-field__preview" id="photoPreview" data-emoji="' + esc(item.emoji || '🍽️') + '">' + (item.image ? '<img src="' + esc(item.image) + '" alt="">' : '') + '</div>' +
            '<div class="photo-field__actions">' +
              '<label class="btn btn--soft btn--sm">📷 ' + (item.image ? 'Changer la photo' : 'Ajouter une photo') + '<input type="file" accept="image/*" id="photoInput" hidden></label>' +
              '<button class="link-btn link-btn--danger" type="button" data-remove-photo' + (item.image ? '' : ' hidden') + '>Retirer la photo</button>' +
              '<small class="help" id="photoHelp">Prise depuis le téléphone ou la galerie, réduite automatiquement.</small>' +
            '</div></div>' +
            '<input name="image" type="url" value="' + esc(item.image || '') + '" placeholder="ou collez l’adresse d’une image (https://…)" style="margin-top:8px"></div>' +
          '<div class="field span-2"><span>Allergènes (14 allergènes réglementaires)</span><div class="check-row check-row--sm">' +
            window.TAPIGO_DEMO.allergens.map(function (a) {
              return '<label><input type="checkbox" name="allergen" value="' + a.id + '"' + (hasAllergen.indexOf(a.id) >= 0 ? ' checked' : '') + '> ' + esc(a.label) + '</label>';
            }).join('') + '</div></div>' +
          (others.length ? '<div class="field span-2"><span>Suggérer avec (« Parfait avec », 3 maximum)</span><div class="check-row check-row--sm">' +
            others.map(function (o) {
              return '<label><input type="checkbox" name="pairing" value="' + esc(o.id) + '"' + ((item.pairings || []).indexOf(o.id) >= 0 ? ' checked' : '') + '> ' + esc(o.name) + '</label>';
            }).join('') + '</div></div>' : '') +
          '<div class="field span-2"><span>Étiquettes</span><div class="check-row">' + Object.keys(tags).map(function (k) {
            return '<label><input type="checkbox" name="tags" value="' + esc(k) + '"' + ((item.tags || []).indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(tags[k]) + '</label>';
          }).join('') + '</div></div>' +
          '<div class="field span-2"><span>Options &amp; variantes</span><div id="groups" style="display:grid;gap:10px">' +
            (item.options || []).map(groupEditHTML).join('') +
          '</div><button class="btn btn--soft btn--sm" type="button" data-add-group style="justify-self:start;margin-top:4px">+ Ajouter un groupe d’options</button></div>' +
          '<label class="switch span-2"><input type="checkbox" name="available"' + (item.available !== false ? ' checked' : '') + '><span class="switch__track"></span><span>Disponible à la commande</span></label>' +
        '</form>',
      footer:
        (id ? '<button class="btn btn--ghost" type="button" data-cancel>Annuler</button>' : '') +
        '<button class="btn btn--primary" type="submit" form="itemForm">' + (id ? 'Enregistrer' : 'Ajouter au menu') + '</button>',
      onMount: function (sheet) {
        var form = $('#itemForm', sheet);
        var preview = $('#photoPreview', sheet);
        var setPhoto = function (url) {
          form.elements.image.value = url || '';
          preview.classList.remove('is-broken');
          preview.innerHTML = url ? '<img src="' + esc(url) + '" alt="">' : '';
          sheet.querySelector('[data-remove-photo]').hidden = !url;
        };
        $('#photoInput', sheet).addEventListener('change', function (e) {
          var file = e.target.files && e.target.files[0];
          if (!file) return;
          var help = $('#photoHelp', sheet);
          help.textContent = 'Envoi de la photo…';
          T.uploadPhoto(file).then(function (url) {
            setPhoto(url);
            help.textContent = 'Photo ajoutée ✓';
          }).catch(function (err) {
            help.textContent = err.message;
            UI.toast(esc(err.message), 5000);
          });
          e.target.value = '';
        });
        form.elements.image.addEventListener('change', function () { setPhoto(form.elements.image.value.trim()); });
        form.addEventListener('change', function (e) {
          if (e.target.name === 'pairing' && form.querySelectorAll('[name="pairing"]:checked').length > 3) {
            e.target.checked = false;
            UI.toast('3 suggestions maximum');
          }
        });
        sheet.addEventListener('click', function (e) {
          if (e.target.closest('[data-remove-photo]')) setPhoto('');
          if (e.target.closest('[data-add-group]')) {
            $('#groups', sheet).insertAdjacentHTML('beforeend', groupEditHTML({ type: 'single', required: false, choices: [] }));
            $('#groups .optgroup-edit:last-child input', sheet).focus();
          }
          var rm = e.target.closest('[data-remove-group]');
          if (rm) rm.closest('.optgroup-edit').remove();
          if (e.target.closest('[data-cancel]')) UI.closeSheet();
        });
        var checkedValues = function (name) {
          return [].slice.call(form.querySelectorAll('[name="' + name + '"]:checked')).map(function (i) { return i.value; });
        };
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var f = form.elements;
          var price = parsePrice(f.price.value);
          if (!f.name.value.trim()) { f.name.style.borderColor = 'var(--danger)'; f.name.focus(); return UI.toast('Le nom est obligatoire'); }
          if (price == null) { f.price.style.borderColor = 'var(--danger)'; f.price.focus(); return UI.toast('Prix invalide'); }

          var options = [].slice.call(sheet.querySelectorAll('.optgroup-edit')).map(function (el) {
            var name = el.querySelector('[data-g="name"]').value.trim();
            var choices = textToChoices(el.querySelector('[data-g="choices"]').value);
            if (!name || !choices.length) return null;
            return {
              id: el.dataset.gid || 'g-' + Math.random().toString(36).slice(2, 8),
              name: name,
              type: el.querySelector('[data-g="type"]').value,
              required: el.querySelector('[data-g="required"]').checked,
              choices: choices
            };
          }).filter(Boolean);

          var saved = T.saveItem({
            id: item.id,
            name: f.name.value.trim(),
            description: f.description.value.trim(),
            price: price,
            category: f.category.value,
            station: f.station.value,
            emoji: f.emoji.value.trim() || '🍽️',
            image: f.image.value.trim(),
            allergenList: checkedValues('allergen'),
            allergens: window.TAPIGO_DEMO.allergens.filter(function (a) { return checkedValues('allergen').indexOf(a.id) >= 0; })
              .map(function (a) { return a.label; }).join(', '),
            pairings: checkedValues('pairing'),
            tags: checkedValues('tags'),
            available: f.available.checked,
            options: options
          });
          UI.closeSheet();
          UI.toast('<strong>' + esc(saved.name) + '</strong> ' + (id ? 'mis à jour' : 'ajouté au menu'));
        });
      }
    });
  }

  // Un seul lien pour toutes les plaques : le client saisit son numéro de table.
  function nfcLink() {
    var base = location.href.replace(/kitchen\.html.*$/, 'menu.html');
    var cur = LIVE && T.currentRestaurant();
    return base + (cur ? '?r=' + cur.slug : '');
  }

  function openSettings() {
    var r = T.getRestaurant();
    UI.openSheet({
      label: 'Établissement',
      head: '<p class="eyebrow">Paramètres</p><h2>Établissement</h2>',
      body:
        '<form id="settingsForm" class="form-grid" novalidate>' +
          '<label class="field span-2"><span>Nom du restaurant</span><input name="name" maxlength="50" value="' + esc(r.name) + '" autofocus></label>' +
          '<label class="field span-2"><span>Accroche</span><input name="tagline" maxlength="80" value="' + esc(r.tagline || '') + '"></label>' +
          '<label class="field"><span>Nombre de tables</span><input name="tables" inputmode="numeric" value="' + (r.tables || 12) + '"></label>' +
          '<label class="field"><span>Lettre du logo</span><input name="logoLetter" maxlength="1" value="' + esc(r.logoLetter || r.name.charAt(0)) + '"></label>' +
          '<label class="field span-2"><span>Lien d’avis Google (proposé au client après son repas)</span>' +
            '<input name="reviewUrl" type="url" value="' + esc(r.reviewUrl || '') + '" placeholder="https://g.page/r/…/review">' +
            '<small class="help">Google Business Profile → « Demander des avis » → copier le lien.</small></label>' +
          '<label class="field span-2"><span>Lien à écrire sur toutes les plaques NFC (le client indique sa table)</span>' +
            '<input id="nfcLinks" readonly value="' + esc(nfcLink()) + '" style="font-size:13px;font-family:ui-monospace,Menlo,monospace">' +
            '<button class="btn btn--soft btn--sm" type="button" id="copyLinks" style="justify-self:start">Copier le lien</button></label>' +
        '</form>',
      footer: '<button class="btn btn--primary" type="submit" form="settingsForm">Enregistrer</button>',
      onMount: function (sheet) {
        $('#copyLinks', sheet).addEventListener('click', function () {
          var ta = $('#nfcLinks', sheet);
          var ok = function () { UI.toast('Lien copié'); };
          if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(ok, function () { ta.select(); });
          else { ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { /* ignore */ } }
        });
        $('#settingsForm', sheet).addEventListener('submit', function (e) {
          e.preventDefault();
          var f = e.target.elements;
          var review = f.reviewUrl.value.trim();
          if (review && !/^https:\/\//i.test(review)) return UI.toast('Le lien d’avis doit commencer par https://');
          var info = Object.assign({}, r, {
            name: f.name.value.trim() || r.name,
            tagline: f.tagline.value.trim(),
            tables: Math.max(1, Math.min(200, parseInt(f.tables.value, 10) || r.tables || 12)),
            logoLetter: f.logoLetter.value.trim(),
            reviewUrl: review
          });
          T.saveRestaurant(info);
          UI.closeSheet();
          UI.toast('Établissement mis à jour');
        });
      }
    });
  }

  /* ======================================================================
     Impression du ticket (imprimante thermique 80 mm ou classique)
     ====================================================================== */
  function printTicket(id) {
    var o = T.getOrder(id);
    if (!o) return;
    var r = T.getRestaurant();
    $('#printArea').innerHTML = '<div class="print-ticket">' +
      '<p class="pt-center"><strong>' + esc(r.name) + '</strong></p>' +
      '<p class="pt-big">TABLE ' + esc(o.table) + '</p>' +
      '<p class="pt-center">Commande n° ' + o.number + ' · ' + T.clock(o.createdAt) + '</p><hr>' +
      o.lines.map(function (l) {
        return '<div class="pt-line"><strong>' + l.qty + ' × ' + esc(l.name) + '</strong>' +
          l.options.map(function (op) { return '<div>  ' + esc(op.group) + ' : ' + esc(op.values.join(', ')) + '</div>'; }).join('') +
          (l.note ? '<div>  ⚠ ' + esc(l.note) + '</div>' : '') + '</div>';
      }).join('') +
      (o.note ? '<hr><p><strong>Note :</strong> ' + esc(o.note) + '</p>' : '') +
      '<hr><p class="pt-total"><span>Total</span><span>' + fmt(o.total) + '</span></p>' +
      '<p class="pt-center">' + (o.payment.status === 'paid' ? 'Payé' : 'À encaisser') + '</p></div>';
    window.print();
  }

  /* ======================================================================
     Appels des tables, pause, fiabilité de la tablette
     ====================================================================== */
  function announceService(q) {
    if (state.sound) UI.chime();
    UI.vibrate([80, 60, 80]);
    UI.toast((q.kind === 'addition' ? '🧾' : '🙋') + ' <strong>Table ' + esc(q.table_label) + '</strong> ' +
      (q.kind === 'addition' ? 'demande l’addition' : 'appelle un serveur'), 6000);
  }

  function canManage() {
    if (!LIVE) return true;
    var cur = T.currentRestaurant();
    return cur && cur.role !== 'equipe';
  }

  function renderPause() {
    var b = $('#pauseBtn');
    var paused = !!T.getRestaurant().ordersPaused;
    b.hidden = !canManage();
    b.setAttribute('aria-pressed', String(paused));
    b.classList.toggle('is-paused', paused);
    b.textContent = paused ? '⏸ Commandes en pause' : 'Pause';
    b.title = paused ? 'Reprendre les commandes en ligne' : 'Suspendre les commandes en ligne (coup de feu, fermeture)';
  }

  // Rappel sonore tant qu'une commande ou un appel n'a pas été traité.
  function remind() {
    if (!state.sound || document.hidden) return;
    var unseen = T.getOrders().some(function (o) { return !o.seen && o.status !== 'terminee'; });
    if (unseen || T.getServiceRequests().length) UI.chime();
  }

  // Empêche la tablette de se mettre en veille pendant le service.
  var wakeLock = null;
  function keepAwake() {
    if (!('wakeLock' in navigator) || document.hidden) return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () { /* refusé */ });
  }

  function renderOnline() { $('#offlineBanner').hidden = navigator.onLine !== false; }

  /* ======================================================================
     Catégories de la carte
     ====================================================================== */
  function openCategories() {
    var menu = T.getMenu();
    if (!menu.categories.length) menu.categories = window.TAPIGO_DEMO.categories.slice();
    var cats = menu.categories.map(function (c) { return { id: c.id, label: c.label }; });
    var count = function (id) { return menu.items.filter(function (i) { return i.category === id; }).length; };

    var rowsHTML = function () {
      return cats.map(function (c, i) {
        return '<div class="cat-row" data-i="' + i + '">' +
          '<input class="input" value="' + esc(c.label) + '" data-label aria-label="Nom de la catégorie" maxlength="30">' +
          '<span class="help">' + count(c.id) + ' plat' + (count(c.id) > 1 ? 's' : '') + '</span>' +
          '<button class="icon-btn" type="button" data-move="-1" aria-label="Monter"' + (i ? '' : ' disabled') + '>↑</button>' +
          '<button class="icon-btn" type="button" data-move="1" aria-label="Descendre"' + (i < cats.length - 1 ? '' : ' disabled') + '>↓</button>' +
          '<button class="icon-btn" type="button" data-del aria-label="Supprimer">' + I.trash + '</button>' +
        '</div>';
      }).join('');
    };

    UI.openSheet({
      label: 'Catégories',
      head: '<p class="eyebrow">Carte</p><h2>Catégories</h2>',
      body:
        '<p class="product-desc">L’ordre ici est celui de la carte côté client (ex. Apéritifs, Pizzas, Vins…).</p>' +
        '<div id="catRows" style="display:grid;gap:8px"></div>' +
        '<form id="catAdd" style="display:flex;gap:8px"><input class="input" name="label" placeholder="Nouvelle catégorie" maxlength="30">' +
        '<button class="btn btn--soft" type="submit">Ajouter</button></form>',
      footer: '<button class="btn btn--primary" type="button" id="catSave">Enregistrer</button>',
      onMount: function (sheet) {
        var box = $('#catRows', sheet);
        var paint = function () { box.innerHTML = rowsHTML(); };
        var syncLabels = function () {
          box.querySelectorAll('.cat-row').forEach(function (row) { cats[+row.dataset.i].label = row.querySelector('[data-label]').value; });
        };
        paint();
        box.addEventListener('click', function (e) {
          var row = e.target.closest('.cat-row');
          if (!row) return;
          syncLabels();
          var i = +row.dataset.i;
          var mv = e.target.closest('[data-move]');
          if (mv) {
            var j = i + Number(mv.dataset.move);
            var tmp = cats[i]; cats[i] = cats[j]; cats[j] = tmp;
            return paint();
          }
          if (e.target.closest('[data-del]')) {
            if (count(cats[i].id)) return UI.toast('Déplacez ou supprimez d’abord les plats de « ' + esc(cats[i].label) + ' »', 4000);
            if (cats.length === 1) return UI.toast('La carte doit garder au moins une catégorie');
            cats.splice(i, 1);
            paint();
          }
        });
        $('#catAdd', sheet).addEventListener('submit', function (e) {
          e.preventDefault();
          syncLabels();
          var label = e.target.elements.label.value.trim();
          if (!label) return;
          var base = T._slug(label), id = base, n = 2;
          while (cats.some(function (c) { return c.id === id; })) id = base + '-' + n++;
          cats.push({ id: id, label: label });
          e.target.reset();
          paint();
        });
        $('#catSave', sheet).addEventListener('click', function () {
          syncLabels();
          if (cats.some(function (c) { return !c.label.trim(); })) return UI.toast('Chaque catégorie doit avoir un nom');
          menu.categories = cats.map(function (c) { return { id: c.id, label: c.label.trim() }; });
          T.replaceMenu(menu);
          UI.closeSheet();
          UI.toast('Catégories enregistrées');
        });
      }
    });
  }

  /* ======================================================================
     Stocks — gérés par toute l'équipe (gérant ou non)
     ====================================================================== */
  var stockQ = '';
  var LOW = 5;

  function stockState(item) {
    var st = T.getStock(item.id);
    if (item.available === false) return 'off';
    if (st === 0) return 'out';
    if (st != null && st <= LOW) return 'low';
    return 'ok';
  }

  function updateStockBadge() {
    var n = T.getMenu().items.filter(function (i) { var s = stockState(i); return s === 'out' || s === 'low'; }).length;
    var c = $('#stockCount');
    c.hidden = !n;
    c.textContent = n;
  }

  function stockRowHTML(i) {
    var st = T.getStock(i.id), state = stockState(i), on = i.available !== false;
    var label = { off: 'En rupture', out: 'Épuisé', low: 'Stock bas', ok: st == null ? 'Illimité' : 'En stock' }[state];
    var badge = { off: 'badge--danger', out: 'badge--danger', low: 'badge--warn', ok: st == null ? '' : 'badge--ok' }[state];
    return '<div class="stock-row stock-row--' + state + '" data-stock="' + esc(i.id) + '">' +
      UI.media(i, 'editor-row__thumb') +
      '<div class="editor-row__name"><strong>' + esc(i.name) + '</strong><span class="badge ' + badge + '">' + label + '</span></div>' +
      '<div class="qty-ctrl" role="group" aria-label="Quantité restante de ' + esc(i.name) + '">' +
        '<button class="icon-btn" type="button" data-qty="-1" aria-label="Retirer un"' + (st ? '' : ' disabled') + '>−</button>' +
        '<input type="number" min="0" max="100000" inputmode="numeric" data-qty-input value="' + (st == null ? '' : st) + '" placeholder="∞" aria-label="Quantité restante">' +
        '<button class="icon-btn" type="button" data-qty="1" aria-label="Ajouter un">+</button>' +
      '</div>' +
      '<div class="stock-row__quick">' +
        '<button class="btn btn--ghost btn--sm" type="button" data-qty-set="0">Épuisé</button>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-qty-set="">Illimité</button>' +
      '</div>' +
      '<label class="switch"><input type="checkbox" data-stock-avail' + (on ? ' checked' : '') + '><span class="switch__track"></span><span>' + (on ? 'En vente' : 'Rupture') + '</span></label>' +
    '</div>';
  }

  function renderStock() {
    var menu = T.getMenu();
    var q = norm(stockQ);
    var items = menu.items.filter(function (i) { return !q || norm(i.name).indexOf(q) >= 0; });
    var count = function (k) { return menu.items.filter(function (i) { return stockState(i) === k; }).length; };
    var alerts = menu.items.filter(function (i) { var s = stockState(i); return s === 'out' || s === 'low' || s === 'off'; });

    var html = '<div class="editor">' +
      '<div class="stat-tiles">' +
        '<div class="stat-tile"><span>Épuisés ou en rupture</span><b>' + (count('out') + count('off')) + '</b><small>invisibles côté client</small></div>' +
        '<div class="stat-tile"><span>Stock bas</span><b>' + count('low') + '</b><small>' + LOW + ' restants ou moins</small></div>' +
        '<div class="stat-tile"><span>Suivis en quantité</span><b>' + Object.keys(T.getStocks()).length + '</b><small>les autres sont illimités</small></div>' +
      '</div>' +
      '<p class="help">Indiquez combien de portions il reste : chaque commande les décompte automatiquement et, à 0, le plat disparaît de la carte client. ' +
        'Laissez vide pour un stock illimité. Toute l’équipe peut gérer les stocks ; les prix et la carte restent réservés au gérant.</p>' +
      '<label class="search">' + I.search + '<input id="stockSearch" type="search" placeholder="Rechercher un produit…" value="' + esc(stockQ) + '" aria-label="Rechercher un produit"></label>' +
      (alerts.length && !q ? '<section class="editor-cat"><h2>À surveiller</h2><div class="editor-list">' + alerts.map(stockRowHTML).join('') + '</div></section>' : '') +
      menu.categories.map(function (c) {
        var list = items.filter(function (i) { return i.category === c.id && (q || alerts.indexOf(i) < 0); });
        if (!list.length) return '';
        return '<section class="editor-cat"><h2>' + esc(c.label) + '</h2><div class="editor-list">' + list.map(stockRowHTML).join('') + '</div></section>';
      }).join('') +
    '</div>';

    var view = $('#stockView');
    var focus = document.activeElement && document.activeElement.id === 'stockSearch';
    var caret = focus ? document.activeElement.selectionStart : 0;
    view.innerHTML = html;
    if (focus) { var s = $('#stockSearch'); s.focus(); s.setSelectionRange(caret, caret); }
    updateStockBadge();
  }

  function applyQty(id, value) {
    var item = T.getItem(id);
    if (!item) return;
    var q = value === '' || value == null ? null : Math.max(0, Math.min(100000, parseInt(value, 10) || 0));
    T.setStock(id, q);
    if (q === 0) UI.toast('<strong>' + esc(item.name) + '</strong> épuisé · retiré de la carte client');
  }

  /* ======================================================================
     Statistiques
     ====================================================================== */
  var statsDays = 30;
  function renderStats() {
    var cur = LIVE ? T.currentRestaurant() : null;
    window.TapigoStats.render($('#statsView'), {
      days: statsDays,
      load: function (days) { statsDays = days; return T.loadStats(days); },
      // Données fictives : réservé à l'équipe Tapigo (ou au mode démo) pour présenter l'outil.
      demoTools: !LIVE || (cur && cur.role === 'admin'),
      seed: function () {
        return LIVE ? T.admin.seedDemo(cur.id, 30) : Promise.resolve(T.seedDemoOrders(30));
      },
      clear: function () {
        return LIVE ? T.admin.clearDemo(cur.id) : Promise.resolve(T.clearDemoOrders());
      },
      restaurantName: T.getRestaurant().name
    });
  }

  /* ======================================================================
     Navigation & événements
     ====================================================================== */
  function renderBrand() {
    var r = T.getRestaurant();
    $('#kName').textContent = r.name;
    $('#kLogo').textContent = (r.logoLetter || r.name || 'T').charAt(0).toUpperCase();
    updateBadges();
  }

  function renderSound() {
    var b = $('#soundBtn');
    b.setAttribute('aria-pressed', String(state.sound));
    b.setAttribute('aria-label', state.sound ? 'Couper les alertes sonores' : 'Activer les alertes sonores');
    b.innerHTML = state.sound ? I.sound : I.mute;
  }

  function setSound(on) {
    state.sound = on;
    T.write(SOUND_KEY, on);
    if (on) { UI.unlockAudio(); UI.chime(); UI.toast('Alertes sonores activées'); }
    renderSound();
    if (state.view === 'orders') renderOrders();
  }

  function setView(v) {
    state.view = v;
    document.querySelectorAll('.k-tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.view === v)); });
    $('#ordersView').hidden = v !== 'orders';
    $('#menuView').hidden = v !== 'menu';
    $('#statsView').hidden = v !== 'stats';
    $('#stockView').hidden = v !== 'stock';
    if (v === 'orders') renderOrders();
    else if (v === 'menu') renderMenuEditor();
    else if (v === 'stock') renderStock();
    else renderStats();
  }

  function bind() {
    $('#boltIcon').outerHTML = I.bolt.replace('<svg ', '<svg width="16" height="16" ');

    document.querySelector('.k-tabs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-view]');
      if (t) setView(t.dataset.view);
    });
    $('#soundBtn').addEventListener('click', function () { setSound(!state.sound); });
    $('#simulateBtn').addEventListener('click', simulateOrder);
    $('#pauseBtn').addEventListener('click', function () {
      var paused = !T.getRestaurant().ordersPaused;
      if (paused && !confirm('Suspendre les commandes en ligne ? Les clients verront « Commandes en pause » jusqu’à la reprise.')) return;
      T.setOrdersPaused(paused);
      renderPause();
      UI.toast(paused ? '⏸ Commandes en ligne suspendues' : '▶ Commandes en ligne reprises');
    });

    setInterval(remind, 30000);
    keepAwake();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) keepAwake(); });
    window.addEventListener('online', function () { renderOnline(); UI.toast('Connexion rétablie'); });
    window.addEventListener('offline', renderOnline);
    renderOnline();

    // Les navigateurs exigent un geste utilisateur avant de jouer un son.
    document.addEventListener('pointerdown', function unlock() {
      if (state.sound) UI.unlockAudio();
      document.removeEventListener('pointerdown', unlock);
    });

    $('#ordersView').addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-layout]'))) { state.layout = t.dataset.layout; savePrefs(); return renderOrders(); }
      if ((t = e.target.closest('[data-station]'))) { state.station = t.dataset.station; savePrefs(); return renderOrders(); }
      if (e.target.closest('[data-enable-sound]')) return setSound(true);
      if ((t = e.target.closest('[data-reopen]'))) return T.updateOrderStatus(t.dataset.reopen, 'servie');
      if ((t = e.target.closest('[data-request-done]'))) { T.completeServiceRequest(t.dataset.requestDone); return renderOrders(); }
      if ((t = e.target.closest('[data-close-table]'))) {
        var tb = t.dataset.closeTable;
        if (confirm('Toute la table ' + tb + ' est encaissée ? Ses commandes passent en « Terminée ».')) {
          T.closeTable(tb);
          UI.toast('Table <strong>' + esc(tb) + '</strong> clôturée');
        }
        return;
      }

      var ticket = e.target.closest('[data-order]');
      if (!ticket) return;
      if (e.target.closest('[data-print]')) return printTicket(ticket.dataset.order);
      var btn = e.target.closest('.st-btn');
      if (btn && !btn.classList.contains('is-active')) {
        var o = T.updateOrderStatus(ticket.dataset.order, btn.dataset.status);
        if (o && o.status === 'terminee') UI.toast('Table ' + esc(o.table) + ' · commande n° ' + o.number + ' terminée');
      } else if (ticket.classList.contains('is-new')) {
        T.markSeen(ticket.dataset.order);
      }
    });

    var stockView = $('#stockView');
    stockView.addEventListener('input', function (e) {
      if (e.target.id === 'stockSearch') { stockQ = e.target.value; renderStock(); }
    });
    stockView.addEventListener('click', function (e) {
      var row = e.target.closest('[data-stock]');
      if (!row) return;
      var id = row.dataset.stock;
      var b = e.target.closest('[data-qty]');
      if (b) {
        var cur = T.getStock(id);
        return applyQty(id, Math.max(0, (cur || 0) + Number(b.dataset.qty)));
      }
      var set = e.target.closest('[data-qty-set]');
      if (set) return applyQty(id, set.dataset.qtySet);
    });
    stockView.addEventListener('change', function (e) {
      var row = e.target.closest('[data-stock]');
      if (!row) return;
      if (e.target.matches('[data-qty-input]')) applyQty(row.dataset.stock, e.target.value.trim());
      if (e.target.matches('[data-stock-avail]')) {
        var item = T.getItem(row.dataset.stock);
        T.setAvailable(row.dataset.stock, e.target.checked);
        UI.toast(e.target.checked
          ? '<strong>' + esc(item.name) + '</strong> de nouveau en vente'
          : '<strong>' + esc(item.name) + '</strong> en rupture · masqué du menu client');
      }
    });
    stockView.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.matches('[data-qty-input]')) e.target.blur();
    });

    var menuView = $('#menuView');
    menuView.addEventListener('input', function (e) {
      if (e.target.id === 'menuSearch') { state.q = e.target.value; renderMenuEditor(); }
    });
    menuView.addEventListener('change', function (e) {
      var row = e.target.closest('[data-item]');
      if (!row) return;
      var item = T.getItem(row.dataset.item);
      if (!item) return;
      if (e.target.matches('[data-price]')) {
        var p = parsePrice(e.target.value);
        if (p == null) { UI.toast('Prix invalide'); e.target.value = String(item.price).replace('.', ','); return; }
        item.price = p;
        T.saveItem(item);
        UI.toast('<strong>' + esc(item.name) + '</strong> · nouveau prix ' + fmt(p));
      }
      if (e.target.matches('[data-avail]')) {
        T.setAvailable(item.id, e.target.checked);
        UI.toast(e.target.checked
          ? '<strong>' + esc(item.name) + '</strong> de nouveau disponible'
          : '<strong>' + esc(item.name) + '</strong> en rupture · masqué du menu client');
      }
    });
    menuView.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.matches('[data-price]')) e.target.blur();
    });
    menuView.addEventListener('click', function (e) {
      if (e.target.closest('[data-import-demo]')) {
        var d = window.TAPIGO_DEMO;
        T.replaceMenu({ categories: d.categories, tags: d.tags, items: d.items });
        return UI.toast('Carte de démonstration importée : adaptez-la à votre restaurant');
      }
      var nb = e.target.closest('[data-new]');
      if (nb) return openItemForm(null, nb.dataset.new || null);
      if (e.target.closest('[data-categories]')) return openCategories();
      if (e.target.closest('[data-settings]')) return openSettings();
      if (e.target.closest('[data-reset]')) {
        if (confirm('Réinitialiser le menu et les commandes de démonstration ?')) { T.resetDemo(); UI.toast('Données de démo restaurées'); }
        return;
      }
      var row = e.target.closest('[data-item]');
      if (!row) return;
      if (e.target.closest('[data-edit]')) openItemForm(row.dataset.item);
      if (e.target.closest('[data-delete]')) {
        var item = T.getItem(row.dataset.item);
        if (item && confirm('Supprimer « ' + item.name + ' » du menu ?')) {
          T.deleteItem(item.id);
          UI.toast('<strong>' + esc(item.name) + '</strong> supprimé');
        }
      }
    });

    /* Temps réel */
    T.subscribe(function (msg) {
      if (msg.type === 'order:created') announce(msg.payload);
      if (/^order:|^orders:|^demo:/.test(msg.type) && state.view === 'orders') renderOrders();
      if (/^order:|^orders:/.test(msg.type)) updateBadges();
      if ((msg.type === 'menu:updated' || msg.type === 'demo:reset') && state.view === 'menu') renderMenuEditor();
      if (msg.type === 'restaurant:updated' || msg.type === 'demo:reset') { renderBrand(); renderPause(); }
      if (msg.type === 'service:created') announceService(msg.payload);
      if (msg.type === 'stock:updated' || msg.type === 'menu:updated' || msg.type === 'demo:reset') {
        updateStockBadge();
        if (state.view === 'stock' && !(document.activeElement && document.activeElement.matches('[data-qty-input]'))) renderStock();
        var p = msg.payload;
        if (msg.type === 'stock:updated' && p && !p.local && p.quantity === 0) {
          var it = T.getItem(p.id);
          if (it) UI.toast('⚠ <strong>' + esc(it.name) + '</strong> est épuisé', 5000);
        }
      }
      if (/^service:/.test(msg.type) && state.view === 'orders') renderOrders();
      if (msg.type === 'error') UI.toast('⚠ ' + esc(msg.payload.message), 5000);
    });

    setInterval(tickTimers, 15000);
  }

  /* ======================================================================
     Démarrage & connexion (mode en ligne)
     ====================================================================== */
  var ROLE_LABEL = { admin: 'Admin Tapigo', owner: 'Gérant', equipe: 'Équipe' };
  var CHOICE_KEY = 'tapigo.v1.kitchen.restaurant';
  var myRestaurants = [];

  function start() {
    $('#simulateBtn').hidden = LIVE;
    $('#logoutBtn').hidden = !LIVE;
    if (LIVE) {
      var cur = T.currentRestaurant();
      // L'équipe ne gère que les commandes.
      document.querySelector('.k-tab[data-view="menu"]').hidden = cur.role === 'equipe';
      document.querySelector('.k-tab[data-view="stats"]').hidden = cur.role === 'equipe';
      var sub = document.querySelector('.k-brand p');
      sub.textContent = ROLE_LABEL[cur.role] + ' · Cuisine & Bar';
      if (myRestaurants.length > 1) {
        sub.innerHTML = '<a href="#" id="switchRestaurant" style="color:inherit">' + esc(ROLE_LABEL[cur.role]) + ' · Changer de restaurant</a>';
        $('#switchRestaurant').addEventListener('click', function (e) {
          e.preventDefault();
          try { localStorage.removeItem(CHOICE_KEY); } catch (err) { /* ignore */ }
          location.href = location.pathname;
        });
      }
    }
    renderBrand();
    renderSound();
    renderPause();
    bind();
    updateStockBadge();
    setView('orders');
    tickTimers();
  }

  function showLogin(message) {
    var el = $('#login');
    el.hidden = false;
    var err = $('#loginError');
    err.hidden = !message;
    err.textContent = message || '';
    var btn = $('#loginBtn');
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  }

  function enter(restaurant) {
    try { localStorage.setItem(CHOICE_KEY, restaurant.slug); } catch (e) { /* ignore */ }
    return T.startStaff(restaurant).then(function () {
      $('#login').hidden = true;
      $('.kds').hidden = false;
      start();
    });
  }

  function showPicker(list) {
    var form = $('#loginForm');
    $('#login').hidden = false;
    form.innerHTML = '<div class="logo" aria-hidden="true">T</div><p class="eyebrow">Espace restaurateur</p><h1>Quel restaurant ?</h1>' +
      '<div class="order-list">' + list.map(function (r) {
        return '<button class="order-link" type="button" data-pick="' + esc(r.id) + '"><span><strong>' + esc(r.name) + '</strong><br>' +
          '<small style="color:var(--muted)">' + esc(r.slug) + (r.active ? '' : ' · désactivé') + '</small></span>' +
          '<span class="badge">' + esc(ROLE_LABEL[r.role] || r.role) + '</span></button>';
      }).join('') + '</div>' +
      '<button class="link-btn" type="button" id="pickerLogout">Se déconnecter</button>';
    form.onsubmit = function (e) { e.preventDefault(); };
    form.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]');
      if (b) enter(list.filter(function (r) { return r.id === b.dataset.pick; })[0]).catch(fatal);
      if (e.target.closest('#pickerLogout')) T.auth.signOut().then(function () { location.reload(); });
    });
  }

  function checkAccess() {
    return T.auth.myRestaurants().then(function (list) {
      myRestaurants = list;
      if (!list.length) {
        return T.auth.signOut().then(function () {
          showLogin('Ce compte n’est rattaché à aucun restaurant. Demandez l’accès à l’équipe Tapigo.');
        });
      }
      var wanted = new URLSearchParams(location.search).get('r');
      var saved = null;
      try { saved = localStorage.getItem(CHOICE_KEY); } catch (e) { /* ignore */ }
      var pick = function (slug) { return list.filter(function (r) { return r.slug === slug; })[0]; };
      var choice = (wanted && pick(wanted)) || (list.length === 1 ? list[0] : (saved && pick(saved)));
      if (choice) return enter(choice);
      showPicker(list);
    });
  }

  function fatal(err) {
    $('#login').hidden = false;
    $('#loginForm').innerHTML = '<div class="logo" aria-hidden="true">T</div><h1>Connexion impossible</h1><p class="login__error">' + esc(err.message) + '</p>' +
      '<button class="btn btn--primary btn--block" type="button" onclick="location.reload()">Réessayer</button>';
  }

  function openAccount() {
    UI.openAccount({
      onSwitch: myRestaurants.length > 1 ? function () {
        try { localStorage.removeItem(CHOICE_KEY); } catch (err) { /* ignore */ }
        location.href = location.pathname;
      } : null,
      onLogout: function () {
        try { localStorage.removeItem(CHOICE_KEY); } catch (err) { /* ignore */ }
      }
    });
  }

  function boot() {
    if (!LIVE) { $('#login').hidden = true; $('.kds').hidden = false; return start(); }

    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target.elements;
      var btn = $('#loginBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Connexion…';
      T.auth.signIn(f.email.value.trim(), f.password.value)
        .then(checkAccess)
        .catch(function (err) { showLogin(err.message); });
    });
    $('#logoutBtn').addEventListener('click', openAccount);

    return T.auth.session().then(function (session) {
      if (session) return checkAccess();
      showLogin();
    });
  }

  T.ready.then(boot).catch(fatal);
})();
