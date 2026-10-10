// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "rh",
  slug: "rh",
  version: "1.0.0",
  nouveautes: [
    {
      version: "1.0.0",
      texte:
        "Dossiers du personnel, congés et absences avec soldes calculés, alertes de fin de contrat.",
    },
  ],
  name: "Ressources humaines",
  icon: "rh",
  action: "RHAPP",
};
