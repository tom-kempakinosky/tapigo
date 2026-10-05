/* ==========================================================================
   Tapigo — Configuration

   Laissez vide pour le MODE DÉMO (données dans le navigateur uniquement).
   Renseignez votre projet Supabase pour le MODE EN LIGNE :
   commandes partagées entre les téléphones des clients et le dashboard,
   dashboard protégé par identifiant / mot de passe.

   Ces deux valeurs sont publiques par conception (Supabase → Project Settings
   → API). Ne mettez JAMAIS ici la clé « service_role » / « secret ».
   ========================================================================== */
window.TAPIGO_CONFIG = {
  supabaseUrl: '',      // ex : 'https://abcdefghijkl.supabase.co'
  supabaseAnonKey: ''   // clé « anon » ou « publishable » (sb_publishable_…)
};
