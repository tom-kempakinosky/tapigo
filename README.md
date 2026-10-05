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

## Passer en mode en ligne (vrais clients)

Sans configuration, le site tourne en **mode démo** (données dans le navigateur uniquement).
Le **mode en ligne** s'appuie sur [Supabase](https://supabase.com) (offre gratuite) :

- Les clients commandent depuis leur téléphone via la plaque NFC (`menu.html?table=N`), et le paiement se fait à table.
- Le **dashboard** (`kitchen.html`) est **protégé par e-mail et mot de passe** et reçoit les commandes en temps réel.
- Les **prix sont recalculés par la base de données**, donc un client ne peut pas modifier le montant de sa commande.
- Les clients ne peuvent lire ni les commandes des autres, ni modifier la carte.

Mise en place :
1. Créez un projet Supabase.
2. Dans **SQL Editor**, collez et exécutez `supabase/schema.sql`.
3. Dans **Authentication → Users → Add user**, créez votre compte (e-mail et mot de passe, avec « Auto Confirm User »).
4. Dans **SQL Editor**, exécutez `insert into public.staff (user_id) select id from auth.users where email = 'vous@exemple.fr';`
5. Dans **Authentication → Sign In / Providers**, désactivez « Allow new users to sign up ».
6. Dans `js/config.js`, renseignez l'URL du projet et la clé `anon` / `publishable` (**jamais** la clé `service_role`).

À la première connexion au dashboard, la carte de démonstration est copiée dans la base. Modifiez-la ensuite depuis l'onglet **Menu**. Les liens à programmer sur chaque plaque NFC se trouvent dans **Menu → Établissement**.

## Fonctionnalités

**Client** (`menu.html?table=X`)
- En-tête avec le nom et le logo du restaurant, et un badge « Table X » lu dans l’URL. Si aucune table n’est détectée, le numéro est demandé au paiement.
- Carte par catégories (Entrées, Plats, Desserts, Boissons), filtres rapides (Végétarien, Sans gluten, Signature) et recherche sans tenir compte des accents.
- Fiche produit en bottom sheet : photo, description, allergènes et options (cuisson, accompagnement, suppléments payants). Les groupes obligatoires sont vérifiés avant l’ajout.
- Panier : quantités, note par plat (« Sans oignon »), message global pour la cuisine, total recalculé en direct.
- Paiement : Apple Pay / Google Pay, carte bancaire (Stripe) ou paiement sur place.
- Suivi en temps réel : *Commande envoyée en cuisine → En préparation → Prête → Servie*, avec vibration et toast à chaque étape.

**Restaurateur** (`kitchen.html`)
- Tickets en temps réel en vue Kanban par statut ou regroupés par numéro de table.
- Alerte sonore (Web Audio, aucun fichier requis), toast, ticket qui clignote et compteur dans l’onglet du navigateur à chaque nouvelle commande.
- Boutons d’état « En préparation », « Prête », « Servie » et « Terminée », avec chronomètre (orange au-delà de 10 min, rouge au-delà de 20 min).
- Filtre par poste (Cuisine / Bar), badge payé / à encaisser, historique avec réouverture d’une commande.
- Éditeur de menu : prix modifiable en ligne, interrupteur de rupture de stock (le produit est masqué côté client), ajout ou modification d’un plat avec ses options, paramètres de l’établissement.
- Bouton « Simuler une commande » pour les démos.

## Architecture

```
.
├── index.html          Accueil démo / simulateur NFC
├── menu.html           Interface client
├── kitchen.html        Dashboard cuisine & bar
├── supabase/schema.sql  Base de données, droits et fonctions (mode en ligne)
├── css/tapigo.css      Charte « Chic & Élégant » (tokens, composants, responsive)
└── js/
    ├── data.js         Données de démonstration (restaurant, catégories, plats, options)
    ├── config.js       URL et clé Supabase (vide = mode démo)
    ├── store.js        Backend simulé : persistance et temps réel (mode démo)
    ├── store-remote.js Connecteur Supabase (mode en ligne)
    ├── ui.js           Bottom sheets, toasts, icônes, son, repli d’image
    ├── menu.js         Logique client
    └── kitchen.js      Logique restaurateur
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
