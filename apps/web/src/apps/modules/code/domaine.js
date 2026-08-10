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

// ---------------------------------------------------------------------------
// Ouverture rapide par le nom
// ---------------------------------------------------------------------------
//
// Le geste le plus fréquent d'un développeur n'est pas de parcourir un
// arbre, c'est de sauter à un fichier dont il connaît le nom. Ctrl+P, trois
// lettres, Entrée. Descendre trois dossiers à la souris pour la vingtième
// fois de la journée est exactement ce qu'on vient éviter.

/// Reconstitue le chemin de chaque fichier à partir des nœuds à plat.
///
/// Les dossiers ne sont pas indexés : on ouvre des fichiers, pas des
/// répertoires. Un cycle dans les parents — impossible en théorie, déjà vu
/// en pratique après une restauration ratée — est arrêté par la profondeur
/// maximale plutôt que de faire tourner la boucle indéfiniment.
const PROFONDEUR_MAX = 32;

export const indexerChemins = (noeuds = []) => {
  const parId = new Map(noeuds.map((n) => [n.id, n]));

  const cheminDe = (noeud) => {
    const parties = [noeud.name];
    let parent = noeud.parentId ? parId.get(noeud.parentId) : null;
    let garde = 0;
    while (parent && garde < PROFONDEUR_MAX) {
      parties.unshift(parent.name);
      parent = parent.parentId ? parId.get(parent.parentId) : null;
      garde += 1;
    }
    return parties.join("/");
  };

  return noeuds
    .filter((n) => n.type === "FILE")
    .map((n) => ({
      id: n.id,
      nom: n.name,
      size: n.size,
      mimeType: n.mimeType,
      chemin: cheminDe(n),
      langage: langageDe(n.name),
    }));
};

/// Correspondance approximative : les lettres de la requête doivent
/// apparaître dans l'ordre, pas forcément côte à côte. « aptx » trouve
/// « apps/web/index.tsx ».
///
/// Rend `null` si ça ne correspond pas, sinon un score — plus il est haut,
/// meilleure est la correspondance. Trois choses le font monter :
///
///   • les lettres consécutives, qui signalent qu'on a tapé un vrai bout
///     du nom plutôt que des initiales éparpillées ;
///   • le début d'un mot (après /, -, _, .), là où l'œil et la mémoire
///     s'accrochent ;
///   • une correspondance dans le **nom** plutôt que dans le chemin.
///
/// Sans le second point, « web » remonterait n'importe quel fichier
/// contenant ces trois lettres avant `web.js` lui-même.
const SEPARATEURS = new Set(["/", "-", "_", ".", " "]);

export const score = (texte, requete) => {
  if (!requete) return 0;
  const t = texte.toLowerCase();
  const q = requete.toLowerCase();

  let points = 0;
  let curseur = 0;
  let precedent = -2;

  for (const lettre of q) {
    const trouve = t.indexOf(lettre, curseur);
    if (trouve === -1) return null;

    if (trouve === precedent + 1) points += 6;
    if (trouve === 0 || SEPARATEURS.has(t[trouve - 1])) points += 4;
    // Plus la lettre est loin, moins elle vaut : à égalité de lettres,
    // le chemin le plus court et le plus direct gagne.
    points += Math.max(0, 3 - Math.floor((trouve - curseur) / 4));

    precedent = trouve;
    curseur = trouve + 1;
  }
  return points;
};

/// Les meilleurs résultats pour une requête. Sans requête, les fichiers
/// tels quels — l'ouverture rapide doit montrer quelque chose dès qu'elle
/// s'ouvre, pas une liste vide.
export const filtrer = (index = [], requete = "", max = 40) => {
  const q = String(requete).trim();
  if (!q) return index.slice(0, max);

  const notes = [];
  for (const entree of index) {
    const surNom = score(entree.nom, q);
    const surChemin = score(entree.chemin, q);
    if (surNom === null && surChemin === null) continue;
    // Le nom pèse double : c'est lui qu'on a en tête en tapant.
    const note = Math.max((surNom ?? 0) * 2, surChemin ?? 0);
    notes.push({ entree, note });
  }

  notes.sort((a, b) => b.note - a.note || a.entree.chemin.length - b.entree.chemin.length);
  return notes.slice(0, max).map((n) => n.entree);
};

// ---------------------------------------------------------------------------
// Créer, renommer
// ---------------------------------------------------------------------------

/// Les thèmes proposés. `auto` suit le mode clair/sombre de l'OS ; les
/// autres sont ceux que Monaco embarque, c'est-à-dire ceux de VS Code.
///
/// Les deux « contraste élevé » ne sont pas de la décoration : ce sont les
/// thèmes d'accessibilité de VS Code, faits pour qui distingue mal les
/// nuances proches. Les retirer parce qu'ils sont laids serait retirer
/// l'éditeur à ceux qui en ont le plus besoin.
export const THEMES = [
  { id: "auto", libelle: "Suivre l'OS" },
  { id: "vs", libelle: "Clair" },
  { id: "vs-dark", libelle: "Sombre" },
  { id: "hc-light", libelle: "Contraste élevé, clair" },
  { id: "hc-black", libelle: "Contraste élevé, sombre" },
];

/// Ce qu'un nom de fichier ou de dossier n'a pas le droit d'être.
///
/// Le serveur nettoie déjà les séparateurs à l'écriture (voir
/// `nomSansChemin` dans api/src/storage.js) ; ici on refuse **avant**, pour
/// dire pourquoi plutôt que de laisser passer un nom silencieusement
/// transformé en autre chose.
export const problemeDeNom = (nom, existants = []) => {
  const propre = String(nom || "").trim();
  if (!propre) return "vide";
  if (propre === "." || propre === "..") return "reserve";
  if (/[/\\]/.test(propre)) return "separateur";
  // Interdits par Windows, et sources de fichiers inouvrables ailleurs.
  if (/[<>:"|?*\u0000-\u001f]/.test(propre)) return "caractere";
  if (propre.length > 255) return "long";
  if (existants.some((e) => e.toLowerCase() === propre.toLowerCase())) return "existe";
  return null;
};

/// Un nom libre dans le dossier : « script.js » devient « script (2).js ».
/// Sert de proposition par défaut, pas de correction forcée.
export const nomLibre = (nom, existants = []) => {
  const pris = new Set(existants.map((e) => e.toLowerCase()));
  if (!pris.has(nom.toLowerCase())) return nom;
  const point = nom.lastIndexOf(".");
  const base = point > 0 ? nom.slice(0, point) : nom;
  const ext = point > 0 ? nom.slice(point) : "";
  for (let i = 2; i < 1000; i += 1) {
    const essai = `${base} (${i})${ext}`;
    if (!pris.has(essai.toLowerCase())) return essai;
  }
  return `${base} (${Date.now()})${ext}`;
};

// ---------------------------------------------------------------------------
// L'arborescence repliable
// ---------------------------------------------------------------------------
//
// Un éditeur montre le projet entier, replié : on déplie ce qu'on regarde et
// on garde le reste sous la main. Naviguer dossier par dossier — ce que
// faisait cette app — oblige à remonter puis redescendre à chaque
// va-et-vient entre deux fichiers voisins, ce qui est le geste le plus
// fréquent qui soit.

/// Construit l'arbre à partir des nœuds à plat.
///
/// Les dossiers d'abord, puis l'ordre alphabétique — c'est le classement de
/// tous les explorateurs de fichiers, et l'œil le cherche.
///
/// Un nœud dont le parent est introuvable remonte à la racine plutôt que de
/// disparaître : mieux vaut un fichier mal rangé qu'un fichier invisible.
export const construireArbre = (noeuds = []) => {
  const parId = new Map(noeuds.map((n) => [n.id, { ...n, enfants: [] }]));
  const racine = [];

  for (const n of parId.values()) {
    const parent = n.parentId ? parId.get(n.parentId) : null;
    (parent ? parent.enfants : racine).push(n);
  }

  const trier = (liste) => {
    liste.sort((a, b) => {
      if ((a.type === "FOLDER") !== (b.type === "FOLDER")) return a.type === "FOLDER" ? -1 : 1;
      return a.name.localeCompare(b.name, "fr", { numeric: true });
    });
    for (const n of liste) if (n.enfants.length) trier(n.enfants);
    return liste;
  };

  return trier(racine);
};

/// Aplatit l'arbre en lignes affichables, en ne descendant que dans les
/// dossiers ouverts. C'est ce qui permet de rendre une liste simple plutôt
/// qu'une récursion de composants, et de garder l'affichage rapide même
/// avec quelques milliers de fichiers.
export const lignesVisibles = (arbre = [], ouverts = new Set(), profondeur = 0) => {
  const out = [];
  for (const n of arbre) {
    out.push({ ...n, profondeur, ouvert: ouverts.has(n.id) });
    if (n.type === "FOLDER" && ouverts.has(n.id) && n.enfants.length) {
      out.push(...lignesVisibles(n.enfants, ouverts, profondeur + 1));
    }
  }
  return out;
};

/// Les identifiants de tous les dossiers menant à un nœud, lui exclu.
/// Sert à déplier le chemin quand on ouvre un fichier par Ctrl+P : sinon il
/// s'ouvre dans l'éditeur sans qu'on voie où il se trouve.
export const cheminOuvert = (noeuds = [], id) => {
  const parId = new Map(noeuds.map((n) => [n.id, n]));
  const out = [];
  let courant = parId.get(id);
  let garde = 0;
  while (courant?.parentId && garde < 32) {
    out.push(courant.parentId);
    courant = parId.get(courant.parentId);
    garde += 1;
  }
  return out;
};
