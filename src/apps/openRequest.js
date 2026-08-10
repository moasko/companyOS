// Ouverture d'un fichier du cloud dans l'application qui sait le lire.
//
// Même principe que `saveRequest` et `modalRequest` : un petit magasin hors
// Redux. Un nœud de fichier n'a rien à faire dans le store — il est
// transitoire, et la visionneuse est la seule à s'y intéresser.

import { familleDe } from "./fileTypes";
import { etatFenetre, ouvrirFenetre } from "./windows";

const abonnes = new Map(); // action Redux → fonction de rendu
const courant = new Map(); // action Redux → { node, voisins }

/// Une visionneuse s'abonne à son action et reçoit le fichier à afficher.
export const subscribeVisionneuse = (action, fn) => {
  abonnes.set(action, fn);
  fn(courant.get(action) || null);
  return () => abonnes.delete(action);
};

/// Ouvre un fichier dans l'application associée à son type.
///
/// `voisins` est le contenu du dossier : la visionneuse s'en sert pour
/// passer à l'image suivante ou enchaîner les morceaux, sans rien
/// redemander au serveur.
///
/// Renvoie `false` si le fichier ne peut pas être ouvert — à l'appelant de
/// réagir (proposer l'installation, ou retomber sur le téléchargement).
///
/// Deux cas d'échec bien distincts, et c'est `applicationManquante` qui les
/// sépare :
///
///   • aucun type ne correspond — personne ne sait lire ce fichier ;
///   • le type est connu mais **son application n'est pas installée** dans
///     cet espace de travail, donc sa fenêtre n'est pas montée.
///
/// Le second cas rendait `true` autrefois : on annonçait une ouverture, on
/// demandait une fenêtre qui n'existait pas, et il ne se passait
/// strictement rien — ni ouverture, ni téléchargement, ni message. Un clic
/// sans effet est la pire des réponses.
export const ouvrirFichier = (node, voisins = []) => {
  const famille = familleDe(node);
  if (!famille || !etatFenetre(famille.app)) return false;

  const charge = { node, voisins, famille };
  courant.set(famille.action, charge);
  abonnes.get(famille.action)?.(charge);

  ouvrirFenetre(famille.app);
  return true;
};

/// L'application qui saurait lire ce fichier mais qui n'est pas installée,
/// ou `null`. Permet de proposer l'installation plutôt que de télécharger
/// un fichier que l'OS sait pourtant ouvrir.
export const applicationManquante = (node) => {
  const famille = familleDe(node);
  return famille && !etatFenetre(famille.app) ? famille : null;
};

/// Ce que la visionneuse affiche en ce moment — utile au rendu initial.
export const fichierCourant = (action) => courant.get(action) || null;

/// Vide une visionneuse (fermeture de sa fenêtre).
export const oublierFichier = (action) => {
  courant.delete(action);
  abonnes.get(action)?.(null);
};
