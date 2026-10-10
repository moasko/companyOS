// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "analyse",
  slug: "analyse",
  name: "Analyse",
  icon: "analyse",
  // Sans cette action, l'icône du bureau et la tuile du menu Démarrer
  // n'ouvrent rien : toutes deux dispatchent `app.action`, et le réducteur
  // retrouve la fenêtre en cherchant celle dont l'action correspond.
  action: "ANALYSEAPP",
};
