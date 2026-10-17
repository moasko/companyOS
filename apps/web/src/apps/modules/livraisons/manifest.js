// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "livraisons",
  slug: "livraisons",
  name: "Livraisons",
  icon: "livraison",
  version: "1.0.0",
  nouveautes: [
    { version: "1.0.0", texte: "Répartition des livraisons du jour, tournées optimisées, application livreur avec preuve de livraison (signature, photo), encaissement Orange Money / Wave / MTN, messages WhatsApp, flotte et échéances." },
  ],
  capacites: {
    lit: [
      "crm:clients",
      "facturation:factures",
      "facturation:reglements",
      "stock:articles",
      "stock:mouvements",
      "rh:salaries",
      "entreprise:profil",
    ],
    ecrit: ["facturation:reglements", "stock:mouvements"],
  },
  action: "LIVRAISONSAPP",
};
