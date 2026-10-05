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
        (paid ? 'Payé · ' + PAY[o.payment.method] : 'À encaisser') + '</span><strong>' + fmt(o.total) + '</strong></div>' +
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

  function renderOrders() {
    var all = activeOrders();
    var shown = all.filter(forStation);
    var html = statsHTML(all) +
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
            return '<section class="table-group"><div class="table-group__head"><h2>Table ' + esc(k) + '</h2>' +
              (due ? '<span class="badge badge--warn">À encaisser ' + fmt(due) + '</span>' : '<span class="badge badge--ok">Réglée</span>') + '</div>' +
              list.map(ticketHTML).join('') + '</section>';
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
    UI.toast('🔔 <span><strong>Nouvelle commande · Table ' + esc(order.table) + '</strong><br>' +
      order.lines.map(function (l) { return l.qty + '× ' + esc(l.name); }).join(', ') + '</span>', 5000);
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

    var html = '<div class="editor">' +
      '<div class="editor__bar">' +
        '<label class="search">' + I.search + '<input id="menuSearch" type="search" placeholder="Rechercher un produit…" value="' + esc(state.q) + '" aria-label="Rechercher un produit"></label>' +
        '<button class="btn btn--primary" type="button" data-new>' + I.plus.replace('<svg ', '<svg width="16" height="16" ') + ' Ajouter un plat</button>' +
        '<button class="btn btn--ghost" type="button" data-settings>Établissement</button>' +
      '</div>' +
      '<p class="eyebrow">' + menu.items.length + ' produits · ' + off + ' en rupture (masqué' + (off > 1 ? 's' : '') + ' côté client)</p>' +
      menu.categories.map(function (c) {
        var list = menu.items.filter(function (i) { return i.category === c.id && (!q || norm(i.name + ' ' + i.description).indexOf(q) >= 0); });
        if (!list.length) return '';
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

  function openItemForm(id) {
    var menu = T.getMenu();
    var item = id ? T.getItem(id) : { name: '', description: '', price: '', category: menu.categories[0].id, station: 'cuisine', image: '', emoji: '🍽️', tags: [], allergens: '', available: true, options: [] };
    if (!item) return;
    var tags = menu.tags || {};

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
          '<label class="field span-2"><span>URL de la photo</span><input name="image" type="url" value="' + esc(item.image || '') + '" placeholder="https://…"></label>' +
          '<label class="field span-2"><span>Allergènes</span><input name="allergens" value="' + esc(item.allergens || '') + '" placeholder="Gluten, lait…"></label>' +
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
        sheet.addEventListener('click', function (e) {
          if (e.target.closest('[data-add-group]')) {
            $('#groups', sheet).insertAdjacentHTML('beforeend', groupEditHTML({ type: 'single', required: false, choices: [] }));
            $('#groups .optgroup-edit:last-child input', sheet).focus();
          }
          var rm = e.target.closest('[data-remove-group]');
          if (rm) rm.closest('.optgroup-edit').remove();
          if (e.target.closest('[data-cancel]')) UI.closeSheet();
        });
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
            allergens: f.allergens.value.trim(),
            tags: [].slice.call(form.querySelectorAll('[name="tags"]:checked')).map(function (i) { return i.value; }),
            available: f.available.checked,
            options: options
          });
          UI.closeSheet();
          UI.toast('<strong>' + esc(saved.name) + '</strong> ' + (id ? 'mis à jour' : 'ajouté au menu'));
        });
      }
    });
  }

  function nfcLinks(n) {
    var base = location.href.replace(/kitchen\.html.*$/, 'menu.html');
    var out = [];
    for (var i = 1; i <= n; i++) out.push('Table ' + i + ' : ' + base + '?table=' + i);
    return out.join('\n');
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
          '<label class="field span-2"><span>Liens à programmer sur les plaques NFC (une par table)</span>' +
            '<textarea id="nfcLinks" readonly rows="6" style="font-size:12px;font-family:ui-monospace,Menlo,monospace">' + esc(nfcLinks(r.tables || 12)) + '</textarea>' +
            '<button class="btn btn--soft btn--sm" type="button" id="copyLinks" style="justify-self:start">Copier les liens</button></label>' +
        '</form>',
      footer: '<button class="btn btn--primary" type="submit" form="settingsForm">Enregistrer</button>',
      onMount: function (sheet) {
        $('#copyLinks', sheet).addEventListener('click', function () {
          var ta = $('#nfcLinks', sheet);
          var ok = function () { UI.toast('Liens copiés'); };
          if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(ok, function () { ta.select(); });
          else { ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { /* ignore */ } }
        });
        $('[name="tables"]', sheet).addEventListener('input', function (e) {
          var n = Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 1));
          $('#nfcLinks', sheet).value = nfcLinks(n);
        });
        $('#settingsForm', sheet).addEventListener('submit', function (e) {
          e.preventDefault();
          var f = e.target.elements;
          T.saveRestaurant({
            id: r.id,
            name: f.name.value.trim() || r.name,
            tagline: f.tagline.value.trim(),
            tables: Math.max(1, Math.min(200, parseInt(f.tables.value, 10) || r.tables || 12)),
            logoLetter: f.logoLetter.value.trim()
          });
          UI.closeSheet();
          UI.toast('Établissement mis à jour');
        });
      }
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
    if (v === 'orders') renderOrders(); else renderMenuEditor();
  }

  function bind() {
    $('#boltIcon').outerHTML = I.bolt.replace('<svg ', '<svg width="16" height="16" ');

    document.querySelector('.k-tabs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-view]');
      if (t) setView(t.dataset.view);
    });
    $('#soundBtn').addEventListener('click', function () { setSound(!state.sound); });
    $('#simulateBtn').addEventListener('click', simulateOrder);

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

      var ticket = e.target.closest('[data-order]');
      if (!ticket) return;
      var btn = e.target.closest('.st-btn');
      if (btn && !btn.classList.contains('is-active')) {
        var o = T.updateOrderStatus(ticket.dataset.order, btn.dataset.status);
        if (o && o.status === 'terminee') UI.toast('Table ' + esc(o.table) + ' · commande n° ' + o.number + ' terminée');
      } else if (ticket.classList.contains('is-new')) {
        T.markSeen(ticket.dataset.order);
      }
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
      if (e.target.closest('[data-new]')) return openItemForm(null);
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
      if (msg.type === 'restaurant:updated' || msg.type === 'demo:reset') renderBrand();
      if (msg.type === 'error') UI.toast('⚠ ' + esc(msg.payload.message), 5000);
    });

    setInterval(tickTimers, 15000);
  }

  /* ======================================================================
     Démarrage & connexion (mode en ligne)
     ====================================================================== */
  function start() {
    $('#simulateBtn').hidden = LIVE;
    $('#logoutBtn').hidden = !LIVE;
    renderBrand();
    renderSound();
    bind();
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

  function enter() {
    return T.startStaff().then(function () {
      $('#login').hidden = true;
      $('.kds').hidden = false;
      start();
    });
  }

  function checkAccess() {
    return T.auth.isStaff().then(function (ok) {
      if (ok) return enter();
      return T.auth.signOut().then(function () {
        showLogin('Ce compte n’a pas accès au tableau de bord. Ajoutez-le à l’équipe (table « staff » dans Supabase).');
      });
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
    $('#logoutBtn').addEventListener('click', function () {
      T.auth.signOut().then(function () { location.reload(); });
    });

    return T.auth.session().then(function (session) {
      if (session) return checkAccess();
      showLogin();
    });
  }

  T.ready.then(boot).catch(function (err) {
    $('#login').hidden = false;
    $('#loginForm').innerHTML = '<div class="logo" aria-hidden="true">T</div><h1>Connexion impossible</h1><p class="login__error">' + esc(err.message) + '</p>' +
      '<button class="btn btn--primary btn--block" type="button" onclick="location.reload()">Réessayer</button>';
  });
})();
