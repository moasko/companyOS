// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "navigateur",
  slug: "browser",
  name: "Navigateur",
  icon: "navigateur",
  // L'icône du bureau ouvre encore la fenêtre par une action Redux : sans
  // ce champ, l'application apparaît sur le bureau et le double-clic ne
  // fait rien.
  action: "NAVIGATEURAPP",
};
