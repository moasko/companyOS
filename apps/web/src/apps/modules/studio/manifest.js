// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "studio",
  slug: "studio",
  name: "Studio",
  // Sur localhost, le builder doit rester testable même lorsque le
  // catalogue distant est indisponible. En production il demeure un module
  // installable depuis la Boutique.
  systeme: import.meta.env.DEV,
  // L'icône est un fichier, pas une clé : le générateur QR utilise aussi
  // « code », et c'est sans conséquence depuis que l'identité d'une
  // application est son `id`.
  icon: "studio",
  action: "STUDIOAPP",
};
