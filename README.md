# Tapigo : commande à table par NFC

Web app de démonstration pour les restaurants Tapigo : menu interactif, prise de commande à table et dashboard cuisine.
HTML, CSS et JavaScript vanilla : aucune dépendance et aucune étape de build. Le dépôt se déploie tel quel (GitHub Pages, Netlify, Vercel…).

## Lancer la démo

```bash
python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

Ouvrez un **menu de table** et le **dashboard cuisine** dans deux onglets du même navigateur : les commandes, les changements de statut et les modifications du menu se synchronisent instantanément.

| Page | Rôle |
| --- | --- |
| `index.html` | Accueil de démo : simulateur des tags NFC (tables 1 à N) et accès au dashboard |
| `menu.html?table=12` | Interface client ouverte par le tag NFC |
| `kitchen.html` | Dashboard restaurateur (cuisine / bar et édition du menu) |
| `admin.html` | Administration Tapigo : restaurants et accès (mode en ligne) |

## Mode en ligne : plusieurs restaurants

Sans configuration, le site tourne en **mode démo** (données dans le navigateur uniquement).
Le **mode en ligne** s'appuie sur [Supabase](https://supabase.com) et gère plusieurs restaurants :

| Qui | Page | Accès |
| --- | --- | --- |
| Clients | `menu.html?r=<restaurant>&table=N` (plaque NFC) | Libre : voient la carte et commandent, paiement à table |
| Restaurateurs | `kitchen.html` | E-mail et mot de passe. Chacun ne voit **que son restaurant** |
| Équipe Tapigo | `admin.html` | Crée les restaurants et donne les accès |

- **Rôles** : *Gérant* gère les commandes et la carte. *Équipe* gère les commandes uniquement. *Admin Tapigo* a accès à tous les restaurants.
- **Sécurité** : les prix sont recalculés par la base de données. Un client ne peut ni lire les commandes, ni modifier une carte. Un restaurateur ne voit jamais les données d'un autre restaurant.
- **Numéros de commande** : chaque restaurant a sa propre numérotation.

### Installation
1. Créez un projet Supabase.
2. Dans **SQL Editor**, collez et exécutez `supabase/schema.sql`. Le script peut être relancé sans risque, et il convertit automatiquement l'ancienne version « un seul restaurant ».
3. Dans **Authentication → Users → Add user**, créez votre compte (cochez « Auto Confirm User »), puis devenez administrateur :
   `insert into public.admins (user_id) select id from auth.users where email = 'vous@exemple.fr';`
4. Dans **Authentication → Sign In / Providers**, désactivez « Allow new users to sign up ».
5. Dans `js/config.js`, renseignez l'URL du projet et la clé `anon` / `publishable` (**jamais** la clé `service_role`).

### Ajouter un restaurant
1. Ouvrez `admin.html` et cliquez sur **Créer un restaurant** (nom, identifiant, nombre de tables, carte de départ).
2. Créez le compte du restaurateur dans Supabase (**Authentication → Users → Add user**, « Auto Confirm User »).
3. Dans `admin.html`, saisissez son e-mail, cliquez sur **Donner l’accès**, puis **Copier le lien NFC** : ce lien unique (`menu.html?r=<restaurant>`) s’écrit sur toutes les plaques du restaurant, et le client indique lui-même son numéro de table.
4. Envoyez-lui le lien `kitchen.html`, son e-mail et son mot de passe provisoire. Il le change ensuite dans **Mon compte**.

## Fonctionnalités

**Client** (plaque NFC → `menu.html?r=<restaurant>`)
- Numéro de table saisi à l'arrivée et vérifié, modifiable via le badge.
- Carte par catégories personnalisables, filtres rapides, recherche, photos.
- Fiche produit : options et suppléments, **14 allergènes réglementaires**, suggestions « Parfait avec ».
- Panier avec notes pour la cuisine, commande payée à table ; paiement en ligne prévu en option.
- **Bouton Service** : « Appeler un serveur » ou « Demander l'addition ».
- Suivi en temps réel (Envoyée → En préparation → Prête → Servie), puis invitation à laisser un **avis Google**.
- Bandeau « Commandes en pause » quand le restaurant suspend les commandes.

**Restaurateur** (`kitchen.html`)
- Commandes en temps réel, par statut ou par table, filtre Cuisine / Bar.
- Appels des tables mis en évidence (« Table 4 demande l'addition »), avec sonnerie.
- **Encaisser et clôturer une table** en un clic, **impression du ticket** (80 mm).
- Fiabilité de la tablette : écran maintenu allumé, rappel sonore tant qu'une commande ou un appel n'est pas traité, bandeau « connexion perdue ».
- Bouton **Pause** pour suspendre les commandes en ligne lors d'un coup de feu.
- Carte : catégories (ajout, renommage, ordre), photos envoyées depuis le téléphone, allergènes, suggestions, prix et ruptures en direct.
- **Statistiques** : chiffre d'affaires par jour, affluence par heure, plats les plus vendus, panier moyen, temps de préparation, part cuisine / bar, export CSV.
- **Stocks** (toute l'équipe, gérant ou non) : quantités restantes décomptées à chaque commande, plat retiré de la carte à 0, « Plus que N » côté client, mise en rupture / remise en vente, alerte « épuisé » en cuisine.
- Rôles : Gérant (tout) / Équipe (commandes et stocks ; ni prix, ni carte, ni statistiques).

**Tapigo** (`admin.html`)
- Création des restaurants, gestion des accès, lien NFC unique par restaurant.
- **Abonnements** : formule, prix mensuel, statut (essai, à jour, en retard, résilié), échéance, revenu mensuel total. Aucune commission sur les ventes.
- Génération de **30 jours de données de démonstration** pour présenter les statistiques (marquées « démo », supprimables).

**Sécurité** : prix recalculés par la base, anti-abus (6 commandes maximum par table toutes les 10 minutes), table inexistante refusée, isolation complète entre restaurants (RLS).

## Architecture

```
.
├── index.html          Accueil démo / simulateur NFC
├── menu.html           Interface client
├── kitchen.html        Dashboard cuisine & bar
├── admin.html          Administration Tapigo (restaurants, accès)
├── supabase/schema.sql  Base de données, droits et fonctions (mode en ligne)
├── css/tapigo.css      Charte « Chic & Élégant » (tokens, composants, responsive)
└── js/
    ├── data.js         Données de démonstration (restaurant, catégories, plats, options)
    ├── config.js       URL et clé Supabase (vide = mode démo)
    ├── store.js        Backend simulé : persistance et temps réel (mode démo)
    ├── store-remote.js Connecteur Supabase (mode en ligne)
    ├── ui.js           Bottom sheets, toasts, icônes, son, repli d’image
    ├── menu.js         Logique client
    ├── kitchen.js      Logique restaurateur
    ├── stats.js        Statistiques (graphiques SVG, export CSV)
    └── admin.js        Logique administration
```

`store.js` est le **seul** module qui touche aux données. En démo, il s’appuie sur `localStorage` et `BroadcastChannel`. Pour passer en production, il suffit de réimplémenter son API (`getMenu`, `saveItem`, `createOrder`, `updateOrderStatus`, `subscribe`…) au-dessus de Supabase, de Firebase ou d’une API REST + WebSocket. Les correspondances sont détaillées en tête du fichier.

### Brancher Stripe

La fonction `simulatePayment()` de `js/menu.js` est le point d’intégration (voir le commentaire au-dessus) :
1. Le serveur crée un `PaymentIntent` en **recalculant le montant depuis la base de données**.
2. Pour la carte, appeler `stripe.confirmCardPayment(clientSecret, …)` avec un Card Element. Pour Apple Pay / Google Pay, utiliser `stripe.paymentRequest(…)` puis `canMakePayment()`.
3. Le webhook `payment_intent.succeeded` crée la commande et notifie la cuisine.

### Programmer les tags NFC

Écrivez sur chaque tag (NTAG213/215) un enregistrement URL du type
`https://votre-domaine.fr/menu.html?table=12`.

## Charte

- Fond sable `#FBF9F5`, cartes blanches, filets `#E6DFD2`.
- Titres en *Cormorant Garamond* et texte en *Manrope*.
- Boutons noirs mats `#1D1C1A` en forme de pilule, accent doré `#A6895A`.
- Pensé mobile d’abord : bottom sheets à faire glisser, barre panier flottante, zones `safe-area`. Les animations respectent `prefers-reduced-motion`.
