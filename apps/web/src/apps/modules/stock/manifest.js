// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "stock",
  slug: "stock",
  version: "3.0.0",
  /// Annoncé dans la Boutique quand une mise à jour est disponible.
  nouveautes: [
    { version: "3.0.0", texte: "Entrepôts et transferts, lots et péremption, réapprovisionnement vers les Achats, inventaire tournant, mode scan, étiquettes code-barres, français et anglais." },
    { version: "2.0.0", texte: "Catégories et sous-catégories, images de produits, fournisseurs, inventaire, valorisation au prix moyen pondéré." },
    { version: "1.1.0", texte: "Alerte au franchissement du seuil de stock." },
  ],
  name: "Stock",
  icon: "excel",
  action: "STOCKAPP",
};
