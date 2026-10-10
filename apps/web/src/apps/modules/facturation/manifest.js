// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "facturation",
  slug: "facturation",
  version: "2.0.0",
  /// Annoncé dans la Boutique quand une mise à jour est disponible.
  /// Seules les entrées postérieures à la version installée sont montrées.
  nouveautes: [
    { version: "2.0.0", texte: "Devis, avoirs et règlements. L'état de paiement se déduit désormais des encaissements." },
    { version: "1.1.0", texte: "Choix des produits dans le catalogue partagé." },
  ],
  name: "Facturation",
  icon: "msoffice",
  action: "FACTURATIONAPP",
};
