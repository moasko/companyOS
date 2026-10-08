// Ouvrir les Paramètres sur une rubrique précise, depuis n'importe quelle
// application — même idiome que explorerRequest.js : la demande est
// déposée, puis consommée par les Paramètres quand ils s'affichent.
//
//   ouvrirParametres("entreprise");

import { ouvrirFenetre } from "./windows";

let enAttente = null;
const abonnes = new Set();

export const ouvrirParametres = (rubrique) => {
  enAttente = rubrique;
  ouvrirFenetre("settings");
  abonnes.forEach((f) => f());
};

/// Côté Paramètres : la rubrique demandée, ou null, et la demande est vidée.
export const consommerRubrique = () => {
  const r = enAttente;
  enAttente = null;
  return r;
};

/// Côté Paramètres : être prévenu d'une demande alors que la fenêtre est ouverte.
export const surRubrique = (f) => {
  abonnes.add(f);
  return () => abonnes.delete(f);
};
