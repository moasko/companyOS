// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "projets",
  slug: "projets",
  version: "1.1.0",
  /// Annoncé dans la Boutique quand une mise à jour est disponible.
  /// Seules les entrées postérieures à la version installée sont montrées.
  nouveautes: [
    { version: "1.1.0", texte: "Notification à l'attribution d'une tâche." },
  ],
  name: "Projets",
  icon: "todo",
  action: "PROJETSAPP",
  // Ce que l'application va chercher hors de chez elle. Déclaré ici, montré
  // à l'utilisateur avant l'installation, et vérifié en développement par
  // `accesDonnees`. Voir src/apps/donnees.js pour ce que cela garantit —
  // et surtout pour ce que cela ne garantit pas.
  capacites: {
    lit: ["crm:clients", "facturation:factures"],
    ecrit: ["facturation:factures"],
  },
};
