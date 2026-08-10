// Code — la partie qui ne dépend ni de React ni de Monaco.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE CETTE APP EST, ET CE QU'ELLE N'EST PAS
//
// Elle n'encadre pas vscode.dev : ce site répond
// `Content-Security-Policy: frame-ancestors 'none'`, c'est-à-dire qu'il
// refuse d'être affiché dans le cadre de qui que ce soit. Aucune option
// d'iframe ne passe outre, et passer outre serait défaire une protection
// posée volontairement.
//
// Elle embarque **Monaco**, qui est le moteur d'édition de VS Code
// lui-même — le même composant, la même coloration, les mêmes raccourcis,
// la même sélection multiple. Ce qui manque par rapport à l'application de
// bureau, ce sont les extensions et le terminal ; ce qui est gagné, c'est
// que les fichiers sont ceux du cloud de l'espace, ouverts et enregistrés
// sans passer par le disque de personne.
//
// LE MODÈLE : DES ONGLETS, COMME PARTOUT
//
// Un développeur ne travaille pas sur un fichier, il travaille sur cinq :
// il compare, il copie, il revient. L'unité de cette app est donc l'onglet
// ouvert, avec son contenu d'origine à côté du contenu courant — c'est la
// seule façon de savoir si quelque chose a changé, donc d'afficher la
// pastille « non enregistré » et d'empêcher une fermeture distraite.
// ─────────────────────────────────────────────────────────────────────────

/// Langages reconnus, par extension.
///
/// La table est volontairement explicite plutôt que déduite de Monaco :
/// Monaco en connaît une centaine dont l'immense majorité n'a rien à faire
/// dans un OS de gestion, et chaque langage chargé pèse. Celle-ci couvre ce
/// qu'on ouvre réellement ici — le code du projet, la configuration, les
/// exports de données.
export const LANGAGES = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  jsonc: "json",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rb: "ruby",
  php: "php",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  kt: "kotlin",
  swift: "swift",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "powershell",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  env: "ini",
  conf: "ini",
  dockerfile: "dockerfile",
  txt: "plaintext",
  log: "plaintext",
  csv: "plaintext",
};

/// Fichiers sans extension qu'on reconnaît quand même, parce qu'ils sont
/// trop courants pour s'ouvrir en texte brut.
const NOMS_CONNUS = {
  dockerfile: "dockerfile",
  makefile: "plaintext",
  ".gitignore": "plaintext",
  ".env": "ini",
  ".npmrc": "ini",
  ".editorconfig": "ini",
};

export const extensionDe = (nom = "") => {
  const point = String(nom).lastIndexOf(".");
  return point > 0 ? String(nom).slice(point + 1).toLowerCase() : "";
};

/// Le langage Monaco d'un fichier, d'après son nom.
export const langageDe = (nom = "") => {
  const propre = String(nom || "").trim();
  const parNom = NOMS_CONNUS[propre.toLowerCase()];
  if (parNom) return parNom;
  return LANGAGES[extensionDe(propre)] || "plaintext";
};

/// Les extensions que l'app revendique — servent à l'association de
/// fichiers de l'Explorateur (src/apps/fileTypes.js).
export const EXTENSIONS = Object.keys(LANGAGES);

/// Un fichier est-il du texte qu'on peut raisonnablement éditer ?
///
/// Deux garde-fous, et le second compte autant que le premier : un binaire
/// ouvert dans un éditeur de texte s'affiche en charabia, et l'enregistrer
/// le détruit silencieusement. Mieux vaut refuser.
export const OCTETS_MAX = 4 * 1024 * 1024;

export const estTexteLisible = (octets) => {
  // Un octet nul dans les premiers kilo-octets : c'est du binaire. C'est
  // l'heuristique de `git diff`, et elle se trompe rarement.
  const debut = octets.subarray(0, Math.min(octets.length, 8192));
  return !debut.includes(0);
};

// ---------------------------------------------------------------------------
// Le jeu d'onglets
// ---------------------------------------------------------------------------

/// Un onglet neuf. `origine` est le contenu tel qu'il a été lu : c'est lui
/// qui sert de référence pour savoir s'il reste des modifications.
export const ongletDe = (node, contenu) => ({
  id: node.id,
  nom: node.name,
  langage: langageDe(node.name),
  contenu,
  origine: contenu,
  // Monaco garde la position du curseur et le pli du code par modèle : on
  // ne conserve ici que ce qui doit survivre à la fermeture de l'onglet.
  lectureSeule: false,
});

export const modifie = (onglet) => !!onglet && onglet.contenu !== onglet.origine;

export const ouvrir = (onglets, node, contenu) => {
  const existant = onglets.findIndex((o) => o.id === node.id);
  // Rouvrir un fichier déjà ouvert ne le recharge pas : ce serait perdre
  // les modifications en cours d'un simple double-clic dans l'Explorateur.
  if (existant >= 0) return { onglets, actif: onglets[existant].id };
  const neuf = ongletDe(node, contenu);
  return { onglets: [...onglets, neuf], actif: neuf.id };
};

/// Ferme un onglet et désigne le suivant à activer.
///
/// On active le voisin de **gauche**, comme les éditeurs et les
/// navigateurs : après avoir fermé, le regard est déjà à gauche.
export const fermer = (onglets, id, actif) => {
  const index = onglets.findIndex((o) => o.id === id);
  if (index < 0) return { onglets, actif };
  const restants = onglets.filter((o) => o.id !== id);
  if (actif !== id) return { onglets: restants, actif };
  const voisin = restants[Math.max(0, index - 1)];
  return { onglets: restants, actif: voisin ? voisin.id : null };
};

export const majContenu = (onglets, id, contenu) =>
  onglets.map((o) => (o.id === id ? { ...o, contenu } : o));

/// Après enregistrement : le contenu courant devient la nouvelle origine.
export const marquerEnregistre = (onglets, id) =>
  onglets.map((o) => (o.id === id ? { ...o, origine: o.contenu } : o));

// ---------------------------------------------------------------------------
// Statistiques de la barre d'état
// ---------------------------------------------------------------------------

/// Ce qu'un éditeur affiche en bas à droite. Peu de chose, mais c'est ce
/// qu'on regarde vingt fois par jour.
export const statistiques = (contenu = "") => {
  const texte = String(contenu);
  const lignes = texte.length === 0 ? 1 : texte.split("\n").length;
  return {
    lignes,
    caracteres: texte.length,
    // Les fins de ligne : un fichier venu de Windows et réenregistré en
    // LF fait un diff de mille lignes pour une virgule changée. Le dire
    // évite la surprise.
    finDeLigne: texte.includes("\r\n") ? "CRLF" : "LF",
  };
};
