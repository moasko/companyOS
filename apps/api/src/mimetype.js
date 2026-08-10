// Le type déclaré d'un fichier : à qui on le demande, et ce qu'on en fait.
//
// ─────────────────────────────────────────────────────────────────────────
// LE TYPE D'UN FICHIER N'EST JAMAIS UNE INFORMATION DE CONFIANCE
//
// Il arrive de deux endroits, et les deux appartiennent à quelqu'un
// d'autre : l'en-tête `Content-Type` d'un envoi multipart, écrit par le
// client, et l'en-tête `Content-Type` d'un serveur distant lors d'un
// import web — donc écrit par un serveur que l'utilisateur a choisi.
//
// Ce type est ensuite renvoyé aux navigateurs des collègues. Un fichier
// déposé en déclarant « text/html » devient une page qui s'exécute sur
// l'origine de l'API ; en SVG, pareil, car un SVG est un document XML qui
// porte du script. Le fichier n'a même pas besoin d'être partagé : il
// apparaît dans le cloud de l'espace, visible de toute l'équipe.
//
// Deux fonctions, deux moments :
//   - `typeNeutralise` à **l'entrée**, pour ce qu'on écrit en base ;
//   - `typeDeFlux` à **la sortie**, pour ce qu'on déclare sur la route de
//     lecture en flux, qui est la seule route non authentifiée.
//
// Les deux, et pas l'une ou l'autre : l'entrée protège les fichiers à
// venir, la sortie protège les 71 fichiers déjà en base, dont le type a
// été enregistré avant tout contrôle.
// ─────────────────────────────────────────────────────────────────────────

/// Types qui s'exécutent, ou qui peuvent en contenir.
///
/// Renommer plutôt qu'interdire : refuser l'envoi empêcherait de ranger
/// une maquette HTML ou un logo SVG dans son cloud, ce qui est un usage
/// parfaitement légitime. Le fichier est donc accepté, ses octets sont
/// intacts, seul son étiquetage change — il se télécharge au lieu de
/// s'ouvrir.
const TYPES_ACTIFS = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
  "application/xslt+xml",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "application/mathml+xml",
]);

// SVG n'est **pas** dans cette liste, et c'est un choix, pas un oubli.
//
// Un SVG est bien un document qui peut porter du script. Mais c'est aussi
// un type d'image de plein droit dans l'Explorateur (voir
// src/apps/fileTypes.js) : le neutraliser empêcherait d'afficher un logo
// téléversé, ce qui est l'usage le plus banal qui soit.
//
// Ce qui arrête un SVG piégé n'est de toute façon pas son étiquette, mais
// l'en-tête `Content-Security-Policy: default-src 'none'; sandbox` posé
// sur la route de flux : dans un bac à sable sans `allow-scripts`, aucun
// script ne s'exécute, même si le document est ouvert directement dans un
// onglet. Le téléchargement, lui, force `attachment`.
//
// Autrement dit : on garde la fonctionnalité, et on met la défense là où
// elle agit réellement. Si cet en-tête venait à disparaître de
// `/files/stream`, il faudrait remettre « image/svg+xml » ci-dessus.

/// Normalise « text/html; charset=utf-8 » en « text/html ».
const normaliser = (mime) => String(mime || "").split(";")[0].trim().toLowerCase();

/// Ce qu'on enregistre en base pour un fichier qui entre.
export const typeNeutralise = (mime) => {
  const type = normaliser(mime);
  if (!type) return "application/octet-stream";
  return TYPES_ACTIFS.has(type) ? "application/octet-stream" : type;
};

/// Ce qu'on déclare sur la route de lecture en flux.
///
/// Cette route existe pour les médias que le navigateur lit par plages
/// d'octets — une vidéo qui démarre sans attendre. Tout le reste part en
/// « octet-stream », ce qui ne gêne aucun lecteur du projet : le PDF, le
/// tableur et le classeur récupèrent les octets et les analysent
/// eux-mêmes, sans regarder le type déclaré.
///
const FLUX_AUTORISE = /^(image|video|audio)\//;

export const typeDeFlux = (mime) => {
  const type = normaliser(mime);
  if (!FLUX_AUTORISE.test(type) || TYPES_ACTIFS.has(type)) {
    return "application/octet-stream";
  }
  return type;
};
