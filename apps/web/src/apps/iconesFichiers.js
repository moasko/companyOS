// L'icône d'un fichier du cloud.
//
// Un dossier ressemble à un dossier, un PDF à un PDF : l'œil trie avant
// de lire. Le jeu d'icônes vit dans public/img/icon/cos/fichiers/ — même
// motif de page pour tous les fichiers, teinté et symbolisé par type.
//
// La détection s'appuie d'abord sur les familles **ouvrables** (voir
// fileTypes.js : elles savent quelle app lance le fichier), puis sur
// l'extension pour les types qu'on reconnaît sans savoir les ouvrir —
// un .zip a droit à son icône même si aucune app ne le décompresse.

import { familleDe } from "./fileTypes";

const PAR_GENRE = {
  image: "image",
  audio: "audio",
  video: "video",
  pdf: "pdf",
  document: "document",
  presentation: "presentation",
  objet3d: "objet3d",
};

const PAR_EXTENSION = {
  // Tableur — reconnu même sans app dédiée pour l'instant.
  xlsx: "tableur", xls: "tableur", csv: "tableur", ods: "tableur",
  // Archives.
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive",
  // Code et données structurées.
  js: "code", jsx: "code", ts: "code", tsx: "code", json: "code", html: "code",
  css: "code", scss: "code", py: "code", sh: "code", sql: "code", xml: "code",
  yml: "code", yaml: "code",
  // Texte simple.
  txt: "texte", md: "texte", log: "texte", rtf: "texte",
  // Anciens formats Office : l'icône dit ce que c'est, même si l'éditeur
  // ne les ouvre pas.
  doc: "document", ppt: "presentation",
};

const extension = (nom = "") => {
  const point = nom.lastIndexOf(".");
  return point > 0 ? nom.slice(point + 1).toLowerCase() : "";
};

/// Nom d'icône d'un nœud du cloud, au format du composant Icon (résolu par
/// cheminIcone vers img/icon/cos/fichiers/*.svg).
export const iconeDeFichier = (node) => {
  if (node.type === "FOLDER") return "fichiers/dossier";
  const genre = familleDe(node)?.genre;
  const nom =
    PAR_GENRE[genre] || PAR_EXTENSION[extension(node.name)] || "inconnu";
  return `fichiers/${nom}`;
};
