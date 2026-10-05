/* ==========================================================================
   Tapigo — Administration (équipe Tapigo)
   Créer un restaurant · donner / retirer les accès · liens NFC
   ========================================================================== */
(function () {
  'use strict';

  var T = Tapigo, UI = TapigoUI, esc = T.esc;
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var ROLE_LABEL = { owner: 'Gérant', equipe: 'Équipe' };
  var restaurants = [];

  function baseUrl(page) { return location.href.replace(/admin\.html.*$/, page); }

  // Un seul lien par restaurant : le client saisit son numéro de table.
  function nfcLink(r) { return baseUrl('menu.html') + '?r=' + r.slug; }

  function toSlug(name) { return T._slug(name).replace(/-+$/, ''); }

  /* ---------------- Rendu ---------------- */
  function createFormHTML() {
    return '<section class="hub-card">' +
      '<p class="eyebrow">Nouveau client</p><h2>Créer un restaurant</h2>' +
      '<form id="createForm" class="form-grid" novalidate>' +
        '<label class="field"><span>Nom du restaurant</span><input name="name" maxlength="50" required placeholder="Chez Marco"></label>' +
        '<label class="field"><span>Identifiant (dans le lien NFC)</span><input name="slug" maxlength="40" required placeholder="chez-marco" pattern="[a-z0-9-]+"></label>' +
        '<label class="field"><span>Nombre de tables</span><input name="tables" inputmode="numeric" value="12"></label>' +
        '<label class="switch" style="align-self:end;padding-bottom:12px"><input type="checkbox" name="demo" checked><span class="switch__track"></span><span>Partir de la carte de démonstration</span></label>' +
        '<p class="help span-2">Lien NFC : <code id="slugPreview">' + esc(baseUrl('menu.html')) + '?r=…</code></p>' +
        '<button class="btn btn--primary span-2" type="submit">Créer le restaurant</button>' +
      '</form></section>';
  }

  function restaurantHTML(r) {
    return '<section class="hub-card" data-rid="' + esc(r.id) + '">' +
      '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">' +
        '<div><h2>' + esc(r.info.name) + '</h2>' +
          '<p style="margin-top:4px"><span class="badge">' + esc(r.slug) + '</span> ' +
          '<span class="badge ' + (r.active ? 'badge--ok' : 'badge--danger') + '">' + (r.active ? 'Actif' : 'Désactivé') + '</span></p>' +
          '<p style="margin-top:6px">' + (r.info.tables || 12) + ' tables · ' + r.items + ' plat' + (r.items > 1 ? 's' : '') + ' à la carte</p></div>' +
        '<label class="switch" title="Un restaurant désactivé ne peut plus recevoir de commandes"><input type="checkbox" data-active' + (r.active ? ' checked' : '') + '><span class="switch__track"></span><span>Actif</span></label>' +
      '</div>' +
      '<div class="check-row">' +
        '<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="menu.html?r=' + esc(r.slug) + '">Menu client</a>' +
        '<a class="btn btn--ghost btn--sm" href="kitchen.html?r=' + esc(r.slug) + '">Dashboard</a>' +
        '<button class="btn btn--soft btn--sm" type="button" data-copy-links>Copier le lien NFC</button>' +
      '</div>' +
      '<p class="help">Lien à écrire sur <strong>toutes</strong> les plaques NFC du restaurant (le client indique sa table) :<br>' +
        '<code style="word-break:break-all">' + esc(nfcLink(r)) + '</code></p>' +
      '<div><p class="eyebrow" style="margin-bottom:8px">Accès</p><div class="order-list" data-members><p class="help">Chargement…</p></div></div>' +
      '<form class="form-grid member-form" data-add-member novalidate>' +
        '<label class="field"><span>E-mail du compte</span><input type="email" name="email" required placeholder="gerant@restaurant.fr"></label>' +
        '<label class="field"><span>Rôle</span><select name="role"><option value="owner">Gérant</option><option value="equipe">Équipe</option></select></label>' +
        '<button class="btn btn--primary" type="submit">Donner l’accès</button>' +
      '</form>' +
      '<p class="help">Le compte doit d’abord exister : Supabase → Authentication → Users → Add user (cochez « Auto Confirm User »). ' +
        'Gérant : commandes + carte. Équipe : commandes uniquement.</p>' +
    '</section>';
  }

  function membersHTML(list) {
    if (!list.length) return '<p class="help">Aucun accès pour l’instant.</p>';
    return list.map(function (m) {
      return '<div class="order-link"><span><strong>' + esc(m.email) + '</strong></span>' +
        '<span style="display:flex;gap:10px;align-items:center"><span class="badge">' + esc(ROLE_LABEL[m.role] || m.role) + '</span>' +
        '<button class="link-btn link-btn--danger" type="button" data-remove="' + esc(m.user_id) + '" data-email="' + esc(m.email) + '">Retirer</button></span></div>';
    }).join('');
  }

  function loadMembers(card) {
    var box = card.querySelector('[data-members]');
    return T.admin.listMembers(card.dataset.rid).then(function (list) {
      box.innerHTML = membersHTML(list || []);
    }).catch(function (err) {
      box.innerHTML = '<p class="login__error">' + esc(err.message) + '</p>';
    });
  }

  function render() {
    return T.admin.listRestaurants().then(function (list) {
      restaurants = list;
      $('#adminView').innerHTML = createFormHTML() +
        '<p class="eyebrow">' + list.length + ' restaurant' + (list.length > 1 ? 's' : '') + '</p>' +
        list.slice().reverse().map(restaurantHTML).join('');
      document.querySelectorAll('[data-rid]').forEach(loadMembers);
    }).catch(function (err) { UI.toast(esc(err.message), 5000); });
  }

  /* ---------------- Actions ---------------- */
  function bind() {
    var view = $('#adminView');
    var slugTouched = false;

    view.addEventListener('input', function (e) {
      var form = e.target.closest('#createForm');
      if (!form) return;
      if (e.target.name === 'slug') {
        slugTouched = !!e.target.value;
        e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-');
      }
      if (e.target.name === 'name' && !slugTouched) form.elements.slug.value = toSlug(e.target.value);
      $('#slugPreview').textContent = baseUrl('menu.html') + '?r=' + (form.elements.slug.value || '…');
    });

    view.addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;

      if (form.id === 'createForm') {
        var f = form.elements;
        var slug = f.slug.value.replace(/^-+|-+$/g, '');
        if (!f.name.value.trim()) return UI.toast('Indiquez le nom du restaurant');
        if (slug.length < 2) return UI.toast('Identifiant trop court');
        var d = window.TAPIGO_DEMO;
        var menu = f.demo.checked ? { categories: d.categories, tags: d.tags, items: d.items } : null;
        var btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        T.admin.createRestaurant(f.name.value.trim(), slug, parseInt(f.tables.value, 10) || 12, menu).then(function () {
          UI.toast('<strong>' + esc(f.name.value.trim()) + '</strong> créé. Donnez maintenant l’accès au gérant.', 4500);
          slugTouched = false;
          return render();
        }).catch(function (err) {
          btn.disabled = false;
          UI.toast(esc(err.message), 5000);
        });
        return;
      }

      if (form.matches('[data-add-member]')) {
        var card = form.closest('[data-rid]');
        var email = form.elements.email.value.trim();
        if (!email) return UI.toast('Indiquez l’e-mail du compte');
        T.admin.addMember(card.dataset.rid, email, form.elements.role.value).then(function () {
          form.reset();
          UI.toast('Accès donné à <strong>' + esc(email) + '</strong>');
          return loadMembers(card);
        }).catch(function (err) { UI.toast(esc(err.message), 6000); });
      }
    });

    view.addEventListener('click', function (e) {
      var card = e.target.closest('[data-rid]');
      if (!card) return;
      var r = restaurants.filter(function (x) { return x.id === card.dataset.rid; })[0];

      if (e.target.closest('[data-copy-links]')) {
        var text = nfcLink(r);
        var ok = function () { UI.toast('Lien NFC de <strong>' + esc(r.info.name) + '</strong> copié'); };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(ok, function () { window.prompt('Lien NFC', text); });
        else window.prompt('Lien NFC', text);
      }

      var rm = e.target.closest('[data-remove]');
      if (rm && confirm('Retirer l’accès de ' + rm.dataset.email + ' à ' + r.info.name + ' ?')) {
        T.admin.removeMember(r.id, rm.dataset.remove).then(function () {
          UI.toast('Accès retiré');
          return loadMembers(card);
        }).catch(function (err) { UI.toast(esc(err.message), 5000); });
      }
    });

    view.addEventListener('change', function (e) {
      if (!e.target.matches('[data-active]')) return;
      var card = e.target.closest('[data-rid]');
      var on = e.target.checked;
      if (!on && !confirm('Désactiver ce restaurant ? Ses clients ne pourront plus commander.')) { e.target.checked = true; return; }
      T.admin.setActive(card.dataset.rid, on).then(function () {
        UI.toast(on ? 'Restaurant réactivé' : 'Restaurant désactivé');
        return render();
      }).catch(function (err) { e.target.checked = !on; UI.toast(esc(err.message), 5000); });
    });

    $('#accountBtn').addEventListener('click', function () { UI.openAccount({}); });
  }

  /* ---------------- Connexion ---------------- */
  function showLogin(message) {
    $('#login').hidden = false;
    $('#app').hidden = true;
    var err = $('#loginError');
    err.hidden = !message;
    err.textContent = message || '';
    var btn = $('#loginBtn');
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  }

  function enter() {
    return T.auth.isAdmin().then(function (ok) {
      if (!ok) {
        return T.auth.signOut().then(function () {
          showLogin('Cet espace est réservé à l’équipe Tapigo. Les restaurateurs se connectent sur le dashboard.');
        });
      }
      $('#login').hidden = true;
      $('#app').hidden = false;
      bind();
      return render();
    });
  }

  function fatal(err) {
    $('#login').hidden = false;
    $('#loginForm').innerHTML = '<div class="logo" aria-hidden="true">T</div><h1>Administration indisponible</h1><p class="login__error">' + esc(err.message) + '</p>';
  }

  T.ready.then(function () {
    if (T.mode !== 'live') {
      return fatal(new Error('L’administration nécessite le mode en ligne (renseignez js/config.js).'));
    }
    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target.elements;
      var btn = $('#loginBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Connexion…';
      T.auth.signIn(f.email.value.trim(), f.password.value).then(enter).catch(function (err) { showLogin(err.message); });
    });
    return T.auth.session().then(function (s) { if (s) return enter(); showLogin(); });
  }).catch(fatal);
})();
