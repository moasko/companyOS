// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "campagnes",
  slug: "campagnes",
  name: "Campagnes",
  icon: "campagnes",
  action: "CAMPAGNESAPP",
  version: "2.0.0",
  nouveautes: [
    { version: "2.0.0", texte: "Éditeur par blocs, test A/B de l'objet, suivi de chaque lien, ventes attribuées, automatisations (bienvenue, devis non signé, après achat, livraison, client endormi, anniversaire), import CSV vers le CRM, formulaire d'inscription avec double opt-in, rebonds, français et anglais." },
  ],
};
