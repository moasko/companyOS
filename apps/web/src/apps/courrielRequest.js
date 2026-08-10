// Composer un courriel depuis n'importe quelle application.
//
// Le même principe que modalRequest et saveRequest : un petit magasin hors
// Redux. Une app appelle `composerCourriel({...})`, l'application Courrier
// s'ouvre avec le brouillon prérempli, et l'utilisateur relit avant
// d'envoyer — une app ne poste jamais un mail dans le dos de quelqu'un.
//
//   import { composerCourriel } from "../../courrielRequest";
//   composerCourriel({
//     a: client.email,
//     sujet: `Facture ${numero}`,
//     texte: "Bonjour, veuillez trouver...",
//     pieces: [{ id: node.id, nom: node.name }],   // fichiers du cloud (5 max)
//     // `pieceJointeId` / `pieceJointeNom` (singulier) restent acceptés.
//   });
//
// Pour un envoi silencieux et assumé (relances automatiques d'un module),
// c'est `api.courrierEnvoyer(...)` directement — l'historique et le
// journal tracent tout dans les deux cas.

import { ouvrirFenetre } from "./windows";

let brouillonEnAttente = null;
const abonnes = new Set();

/// Ouvre l'app Courrier sur un brouillon prérempli.
export const composerCourriel = (brouillon = {}) => {
  brouillonEnAttente = brouillon;
  ouvrirFenetre("courrier");
  abonnes.forEach((f) => f(brouillon));
};

/// Côté app Courrier : récupère (et consomme) le brouillon en attente.
export const prendreBrouillon = () => {
  const b = brouillonEnAttente;
  brouillonEnAttente = null;
  return b;
};

/// Côté app Courrier : être prévenu si un brouillon arrive alors que la
/// fenêtre est déjà ouverte.
export const surBrouillon = (f) => {
  abonnes.add(f);
  return () => abonnes.delete(f);
};
