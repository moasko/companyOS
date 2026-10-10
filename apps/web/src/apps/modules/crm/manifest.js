// Descriptif de l'application, chargé au démarrage du shell.
//
// Le code de la fenêtre (index.jsx) n'est téléchargé qu'à la première
// ouverture : ce fichier doit rester léger — aucun import de React ni
// des écrans. Voir src/apps/registry.js.

export const manifest = {
  id: "crm",
  slug: "crm",
  version: "3.0.0",
  nouveautes: [
    { version: "3.0.0", texte: "Ma journée, affaires qui stagnent, fiche 360° reliée à la Facturation, au Courrier, aux Campagnes et aux Projets, leads notés, prévisions et objectifs, version mobile." },
    { version: "2.0.0", texte: "Pipeline commercial, suivi des échanges, relances datées et chiffre d'affaires par client." },
    { version: "1.1.0", texte: "Responsable de compte, prévenu à l'attribution." },
  ],
  name: "CRM",
  icon: "people",
  action: "CRMAPP",
  capacites: {
    lit: ["facturation:factures", "facturation:reglements", "courrier:envois", "campagnes:campagnes", "projets:cartes"],
    ecrit: ["agenda:evenements", "projets:tableaux", "projets:cartes"],
  },
};
