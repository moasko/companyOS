// Gestionnaire de fenêtres de CompanyOS.
//
// Une fenêtre se pilote par l'**identifiant de son application**, pas par
// une chaîne d'action inventée pour l'occasion. Avant, chaque app devait
// se choisir une action Redux unique dans tout l'OS (`WORDAPP`,
// `PROJETSAPP`…) et le réducteur balayait toutes les apps pour retrouver
// laquelle répondait. C'était un aiguillage, pas un gestionnaire.
//
//   import { ouvrirFenetre, fermerFenetre } from "../apps/windows";
//   ouvrirFenetre("explorer");
//
// Les anciennes actions par app continuent de fonctionner : le réducteur
// les accepte toujours, le temps que tout le code migre.

import store from "../reducers";

/// Modes reconnus par le gestionnaire.
///   full   — ouvre et met au premier plan, sans toucher à la taille
///   togg   — bascule (barre des tâches)
///   close  — ferme
///   mnmz   — réduit
///   mxmz   — bascule plein écran / fenêtré
///   front  — remonte au premier plan sans rien changer d'autre
///   resize — taille libre, avec `dim`
export const MODES = ["full", "togg", "close", "mnmz", "mxmz", "front", "resize"];

/// Agit sur la fenêtre d'une application.
export const fenetre = (id, mode = "full", extra = {}) =>
  store.dispatch({ type: "WINDOW", payload: { id, mode }, ...extra });

export const ouvrirFenetre = (id) => fenetre(id, "full");
export const fermerFenetre = (id) => fenetre(id, "close");
export const basculerFenetre = (id) => fenetre(id, "togg");
export const reduireFenetre = (id) => fenetre(id, "mnmz");
export const premierPlan = (id) => fenetre(id, "front");

/// État de la fenêtre d'une application, ou null si l'app n'est pas montée.
export const etatFenetre = (id) => store.getState().apps[id] || null;
