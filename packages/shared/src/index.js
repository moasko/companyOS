// Point d'entrée de commodité.
//
// Préférez les sous-chemins (`@companyos/shared/facturation`) : ils disent
// d'où vient chaque fonction et évitent de tirer les trois modules quand on
// n'en utilise qu'un.

export * as automatisations from "./automatisations.js";
export * as campagnes from "./campagnes.js";
export * as courrier from "./courrier.js";
export * as facturation from "./facturation.js";
