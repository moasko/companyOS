// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "automatisations",
  slug: "automatisations",
  name: "Automatisations",
  icon: "automatisations",
  version: "1.0.0",
  nouveautes: [
    { version: "1.0.0", texte: "Quand une fiche change dans une app, agir dans une autre : prévenir, créer une tâche, une fiche, un courriel ou appeler un webhook. Recettes prêtes à l'emploi et essai à blanc." },
  ],
  action: "AUTOMATISATIONSAPP",
  // Outil d'administration de l'espace : toujours présent, sans
  // installation (l'écran se ferme aux non-administrateurs).
  systeme: true,
  // Proposé aux administrateurs sur l'écran d'accueil du téléphone.
  admin: true,
};
