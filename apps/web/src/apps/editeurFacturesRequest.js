// Ouvrir une facture dans l'Éditeur de factures, depuis n'importe quelle
// application — sur le modèle de courrielRequest.js.
//
//   import { ouvrirDansEditeur } from "../../editeurFacturesRequest";
//   ouvrirDansEditeur({ id: fiche.id });          // une facture existante
//   ouvrirDansEditeur({ client: ficheClient });   // une nouvelle, client choisi
//
// L'éditeur, s'il est déjà ouvert, est prévenu ; sinon il prend la demande
// à son ouverture.

import { ouvrirFenetre } from "./windows";

let demandeEnAttente = null;
const abonnes = new Set();

export const ID_EDITEUR = "editeurFactures";

export const ouvrirDansEditeur = (demande = {}) => {
  demandeEnAttente = demande;
  ouvrirFenetre(ID_EDITEUR);
  abonnes.forEach((f) => f(demande));
};

/// Côté éditeur : récupère (et consomme) la demande en attente.
export const prendreDemande = () => {
  const d = demandeEnAttente;
  demandeEnAttente = null;
  return d;
};

/// Côté éditeur : être prévenu d'une demande alors que la fenêtre est ouverte.
export const surDemande = (f) => {
  abonnes.add(f);
  return () => abonnes.delete(f);
};
