// Ouverture de l'Explorateur sur une vue précise.
//
// Même idiome que `saveRequest`, `modalRequest` et `openRequest` : un petit
// magasin hors Redux. La vue courante de l'Explorateur (dossier ou
// corbeille) est un état local du composant, pas une donnée d'application —
// elle n'a rien à faire dans le store.
//
// La demande est **déposée puis consommée**, plutôt que poussée à un
// auditeur. Un abonnement suppose que le destinataire écoute au moment
// exact où l'on parle : si l'Explorateur se réabonne (navigation) ou n'est
// pas encore monté, la demande se perd. Ici elle attend qu'on vienne la
// chercher, ce que l'Explorateur fait à chaque fois qu'il s'affiche.

import { ouvrirFenetre } from "./windows";

let enAttente = null;

const demander = (vue) => {
  enAttente = vue;
  ouvrirFenetre("explorer");
};

/// L'Explorateur appelle ceci quand il devient visible. Renvoie la vue
/// demandée, ou null, et vide la demande au passage.
export const consommerDemande = () => {
  const vue = enAttente;
  enAttente = null;
  return vue;
};

/// Ouvre l'Explorateur sur la corbeille — c'est ce que fait l'icône
/// Corbeille du bureau.
export const ouvrirCorbeille = () => demander("corbeille");

/// Ouvre l'Explorateur sur la racine du cloud.
export const ouvrirCloud = () => demander("cloud");

/// Ouvre l'Explorateur sur un dossier précis. `null` = racine du cloud —
/// c'est ce que renvoie `parentId` pour un élément posé à la racine.
export const ouvrirDossier = (id) =>
  demander(id ? { vue: "dossier", id } : "cloud");
