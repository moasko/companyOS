// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

import { ID_EDITEUR } from "../../editeurFacturesRequest";

export const manifest = {
  id: ID_EDITEUR,
  slug: "editeur-factures",
  name: "Éditeur de factures",
  icon: "editeur-factures",
  version: "1.1.0",
  nouveautes: [
    { version: "1.1.0", texte: "Fiche de l'entreprise partagée, signature et cachet sur le PDF, pièces jointes du Cloud, vérifications en direct et raccourcis clavier." },
    { version: "1.0.0", texte: "Six modèles, aperçu en direct, paiement fractionné, factures récurrentes et envoi au client en PDF." },
  ],
  capacites: {
    lit: [
      "crm:clients",
      "stock:articles",
      "facturation:factures",
      "facturation:reglements",
      "entreprise:profil",
      "signature:signatures",
    ],
    ecrit: ["facturation:factures"],
  },
  action: "EDITEURFACTURESAPP",
};
