// Tableur CSV — les règles, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// POURQUOI UN VRAI ANALYSEUR
//
// « Découper sur les virgules » marche jusqu'au premier fichier réel. Un
// CSV honnête contient :
//
//   Dupont;"Abidjan, Cocody";"Il a dit ""oui"""
//   Kouassi;"Rue des Jardins
//   Riviera 3";1500
//
// — un séparateur *dans* un champ, un guillemet doublé pour s'échapper, et
// un retour à la ligne au milieu d'un enregistrement. Un `split(",")`
// casse les trois. Cet analyseur suit la RFC 4180, caractère par
// caractère, et rend toujours une grille rectangulaire.
//
// Il devine aussi le séparateur : le point-virgule règne dans les exports
// francophones (Excel en configuration FR l'impose, la virgule y étant le
// séparateur décimal), la virgule ailleurs, la tabulation dans les copies
// depuis un tableur. Se tromper de séparateur donne une seule colonne — la
// panne la plus fréquente et la plus déroutante.
//
// Tout est pur : entrée → sortie, aucun état, aucun DOM.
// ─────────────────────────────────────────────────────────────────────────

export const SEPARATEURS = [
  { car: ";", nom: "Point-virgule" },
  { car: ",", nom: "Virgule" },
  { car: "\t", nom: "Tabulation" },
  { car: "|", nom: "Barre verticale" },
];

export const FINS_DE_LIGNE = [
  { id: "crlf", car: "\r\n", nom: "Windows (CRLF)" },
  { id: "lf", car: "\n", nom: "Unix (LF)" },
];

/// Découpe brute, sans uniformiser les largeurs. C'est le cœur : il suit
/// la RFC 4180 caractère par caractère, et l'état « dans des guillemets »
/// traverse les sauts de ligne — c'est ce qui permet à une cellule de
/// contenir un retour à la ligne.
const decouper = (source, sep) => {
  const grille = [];
  let ligne = [];
  let champ = "";
  let dansGuillemets = false;

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];

    if (dansGuillemets) {
      if (c === '"') {
        if (source[i + 1] === '"') { champ += '"'; i += 1; }  // "" → un guillemet
        else dansGuillemets = false;
      } else champ += c;
      continue;
    }

    if (c === '"' && champ === "") { dansGuillemets = true; continue; }
    if (c === sep) { ligne.push(champ); champ = ""; continue; }
    if (c === "\r") continue;                    // CRLF : le \n suivant tranche
    if (c === "\n") { ligne.push(champ); grille.push(ligne); ligne = []; champ = ""; continue; }
    champ += c;
  }
  // Dernière ligne sans saut final.
  if (champ !== "" || ligne.length) { ligne.push(champ); grille.push(ligne); }
  return grille;
};

/// Le séparateur le plus probable.
///
/// On n'essaie pas de compter les occurrences ligne par ligne : une
/// cellule contenant un saut de ligne casserait ce comptage, et le vrai
/// séparateur s'en trouverait pénalisé — c'est exactement le piège dans
/// lequel une première version est tombée. On **découpe pour de bon** avec
/// chaque séparateur candidat, et on juge le résultat : le bon découpage
/// donne des lignes du même nombre de colonnes.
///
/// Régularité d'abord, richesse ensuite ; un découpage à une seule colonne
/// n'a rien découpé du tout.
export const devinerSeparateur = (texte = "") => {
  const echantillon = texte.replace(/^﻿/, "").slice(0, 65536);
  if (!echantillon.trim()) return ";";

  let meilleur = ";";
  let meilleurScore = -Infinity;

  for (const { car } of SEPARATEURS) {
    const lignes = decouper(echantillon, car)
      .filter((l) => l.some((c) => c.trim() !== ""))
      .slice(0, 50);
    if (!lignes.length) continue;

    const comptes = lignes.map((l) => l.length);
    const moyenne = comptes.reduce((s, n) => s + n, 0) / comptes.length;
    if (moyenne < 2) continue; // ce séparateur n'apparaît pas : une colonne

    const variance =
      comptes.reduce((s, n) => s + (n - moyenne) ** 2, 0) / comptes.length;
    const score = moyenne - variance * 4;
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleur = car;
    }
  }
  return meilleur;
};

/// Analyse un texte CSV en grille de chaînes.
///
/// Rend toujours des lignes de longueur égale : une ligne courte est
/// complétée, une ligne trop longue élargit la grille. Un tableau
/// irrégulier ferait planter tout affichage en colonnes.
export const analyser = (texte = "", separateur = null) => {
  // Le BOM UTF-8 n'est pas une donnée : laissé en place, il colle au
  // premier en-tête et « Nom » devient « ﻿Nom », qui ne correspond
  // plus à rien.
  const source = texte.replace(/^﻿/, "");
  const sep = separateur || devinerSeparateur(source);
  const grille = decouper(source, sep);

  const largeur = grille.reduce((m, l) => Math.max(m, l.length), 0);
  return {
    grille: grille.map((l) => (l.length === largeur ? l : [...l, ...Array(largeur - l.length).fill("")])),
    separateur: sep,
    finDeLigne: source.includes("\r\n") ? "crlf" : "lf",
  };
};

/// La première ligne est-elle un en-tête ?
///
/// Indice retenu : des libellés non vides, non numériques et tous
/// différents, alors que la ligne suivante contient au moins un nombre.
/// C'est faillible — d'où le réglage manuel dans l'écran — mais juste dans
/// l'immense majorité des fichiers.
export const semblEnTete = (grille = []) => {
  if (grille.length < 2) return grille.length === 1;
  const [tete, suivante] = grille;
  const tousTextes = tete.every((c) => c.trim() !== "" && !estNombre(c));
  const tousDistincts = new Set(tete.map((c) => c.trim().toLowerCase())).size === tete.length;
  const suivanteAUnNombre = suivante.some((c) => estNombre(c));
  return tousTextes && tousDistincts && (suivanteAUnNombre || true);
};

export const estNombre = (v) => {
  const s = String(v ?? "").trim();
  if (s === "") return false;
  // Les nombres francophones s'écrivent « 1 234,56 » : espace insécable
  // comme séparateur de milliers, virgule décimale.
  const normalise = s.replace(/[\s  ]/g, "").replace(",", ".");
  return Number.isFinite(Number(normalise));
};

export const versNombre = (v) => {
  const s = String(v ?? "").trim().replace(/[\s  ]/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const EST_DATE = /^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

/// Le type dominant d'une colonne, et de quoi la décrire.
export const profilerColonne = (lignes, index) => {
  let nombres = 0;
  let dates = 0;
  let vides = 0;
  let somme = 0;
  let min = null;
  let max = null;
  const distinctes = new Set();

  for (const l of lignes) {
    const v = String(l[index] ?? "").trim();
    if (v === "") { vides += 1; continue; }
    if (distinctes.size < 500) distinctes.add(v);
    if (estNombre(v)) {
      nombres += 1;
      const n = versNombre(v);
      somme += n;
      min = min === null || n < min ? n : min;
      max = max === null || n > max ? n : max;
    } else if (EST_DATE.test(v)) dates += 1;
  }

  const remplies = lignes.length - vides;
  const type =
    remplies === 0 ? "vide"
    : nombres / remplies > 0.8 ? "nombre"
    : dates / remplies > 0.8 ? "date"
    : "texte";

  return {
    index,
    type,
    remplies,
    vides,
    distinctes: distinctes.size,
    somme: type === "nombre" ? somme : null,
    moyenne: type === "nombre" && nombres ? somme / nombres : null,
    min,
    max,
  };
};

export const profiler = (lignes = [], largeur = 0) =>
  Array.from({ length: largeur }, (_, i) => profilerColonne(lignes, i));

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

/// Un champ n'est entouré de guillemets que s'il en a besoin : séparateur,
/// guillemet, saut de ligne, ou espaces en bordure — qu'un tableur
/// mangerait sinon. Tout guillemeter alourdit le fichier et fâche certains
/// outils.
const echapper = (valeur, sep) => {
  const s = String(valeur ?? "");
  const doitEtreCite =
    s.includes(sep) || s.includes('"') || s.includes("\n") || s.includes("\r") ||
    s !== s.trim();
  return doitEtreCite ? `"${s.replace(/"/g, '""')}"` : s;
};

/// Sérialise une grille en texte CSV.
///
/// `bom` ajoute la marque d'ordre d'octets : Excel en configuration
/// francophone lit sinon l'UTF-8 comme du Latin-1, et « Côte d'Ivoire »
/// s'affiche « CÃ´te d'Ivoire ».
export const ecrire = (grille = [], { separateur = ";", finDeLigne = "crlf", bom = true } = {}) => {
  const eol = finDeLigne === "lf" ? "\n" : "\r\n";
  const corps = grille
    .map((l) => l.map((c) => echapper(c, separateur)).join(separateur))
    .join(eol);
  return (bom ? "﻿" : "") + corps;
};

// ---------------------------------------------------------------------------
// Opérations sur la grille — toutes rendent une NOUVELLE grille
// ---------------------------------------------------------------------------
//
// Aucune ne modifie son entrée : c'est ce qui rend l'annulation possible
// (on empile des états) et ce qui évite qu'un rendu React manque un
// changement fait en place.

export const ligneVide = (largeur) => Array(largeur).fill("");

export const poserCellule = (grille, l, c, valeur) =>
  grille.map((ligne, i) => (i === l ? ligne.map((v, j) => (j === c ? valeur : v)) : ligne));

export const insererLigne = (grille, index, largeur) => {
  const copie = [...grille];
  copie.splice(index, 0, ligneVide(largeur || grille[0]?.length || 1));
  return copie;
};

export const supprimerLigne = (grille, index) => grille.filter((_, i) => i !== index);

export const insererColonne = (grille, index) =>
  grille.map((l) => {
    const copie = [...l];
    copie.splice(index, 0, "");
    return copie;
  });

export const supprimerColonne = (grille, index) =>
  grille.map((l) => l.filter((_, j) => j !== index));

export const deplacerColonne = (grille, de, vers) =>
  grille.map((l) => {
    const copie = [...l];
    const [x] = copie.splice(de, 1);
    copie.splice(vers, 0, x);
    return copie;
  });

/// Tri par colonne. Les nombres se comparent en nombres — sinon « 100 »
/// passe avant « 20 », ce qui est le tri de texte et non ce qu'on veut.
/// Les cellules vides finissent toujours en bas, quel que soit le sens :
/// un trou n'est ni grand ni petit.
export const trier = (lignes, colonne, croissant = true) => {
  const copie = [...lignes];
  copie.sort((a, b) => {
    const va = String(a[colonne] ?? "").trim();
    const vb = String(b[colonne] ?? "").trim();
    if (va === "" && vb === "") return 0;
    if (va === "") return 1;
    if (vb === "") return -1;
    const na = versNombre(va);
    const nb = versNombre(vb);
    const cmp =
      na !== null && nb !== null ? na - nb : va.localeCompare(vb, "fr", { numeric: true });
    return croissant ? cmp : -cmp;
  });
  return copie;
};

/// Recherche plein texte sur toutes les colonnes.
export const chercher = (lignes, terme) => {
  const q = String(terme || "").trim().toLowerCase();
  if (!q) return lignes.map((_, i) => i);
  return lignes.reduce((acc, l, i) => {
    if (l.some((c) => String(c ?? "").toLowerCase().includes(q))) acc.push(i);
    return acc;
  }, []);
};

/// Remplacement dans toute la grille (ou une seule colonne).
/// Rend la grille et le nombre de remplacements — annoncer « 0 remplacé »
/// vaut mieux que laisser croire que ça a marché.
export const remplacer = (grille, cherche, par, { colonne = null, sensible = false } = {}) => {
  if (!cherche) return { grille, n: 0 };
  let n = 0;
  const motif = new RegExp(
    cherche.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    sensible ? "g" : "gi",
  );
  const sortie = grille.map((ligne) =>
    ligne.map((v, j) => {
      if (colonne !== null && j !== colonne) return v;
      const s = String(v ?? "");
      if (!motif.test(s)) return v;
      motif.lastIndex = 0;
      const remplacee = s.replace(motif, () => { n += 1; return par; });
      return remplacee;
    }),
  );
  return { grille: sortie, n };
};

/// Retire les lignes entièrement vides — un export en produit souvent en
/// fin de fichier, et elles faussent tous les décomptes.
export const retirerLignesVides = (lignes) =>
  lignes.filter((l) => l.some((c) => String(c ?? "").trim() !== ""));

/// Retire les doublons exacts, en gardant la première occurrence.
export const retirerDoublons = (lignes) => {
  const vus = new Set();
  const sortie = [];
  for (const l of lignes) {
    const cle = JSON.stringify(l);
    if (vus.has(cle)) continue;
    vus.add(cle);
    sortie.push(l);
  }
  return { lignes: sortie, retires: lignes.length - sortie.length };
};

/// Supprime les espaces en bordure de chaque cellule.
export const nettoyerEspaces = (grille) =>
  grille.map((l) => l.map((c) => String(c ?? "").trim()));

// ---------------------------------------------------------------------------
// Historique — annuler / rétablir
// ---------------------------------------------------------------------------

/// Une pile bornée d'états. Vingt pas suffisent à rattraper une bêtise et
/// évitent de garder en mémoire cinquante copies d'un fichier de 50 000
/// lignes.
export const PROFONDEUR_HISTORIQUE = 20;

export const empiler = (historique, etat) => {
  const pile = [...historique.passe, etat].slice(-PROFONDEUR_HISTORIQUE);
  // Toute action neuve invalide la branche rétablissable : c'est le
  // comportement attendu partout ailleurs.
  return { passe: pile, futur: [] };
};

export const annuler = (historique, courant) => {
  if (!historique.passe.length) return { historique, etat: courant };
  const passe = [...historique.passe];
  const etat = passe.pop();
  return { historique: { passe, futur: [courant, ...historique.futur] }, etat };
};

export const retablir = (historique, courant) => {
  if (!historique.futur.length) return { historique, etat: courant };
  const [etat, ...futur] = historique.futur;
  return { historique: { passe: [...historique.passe, courant], futur }, etat };
};

// ---------------------------------------------------------------------------
// Repères de colonnes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Encodage — la panne n° 1 des fichiers hérités
// ---------------------------------------------------------------------------

export const ENCODAGES = [
  { id: "utf-8", nom: "UTF-8" },
  { id: "windows-1252", nom: "Windows-1252 / Latin-1" },
];

/// Les traces d'un texte Latin-1 lu comme de l'UTF-8, ou l'inverse.
///
/// « Côte d'Ivoire » enregistré en UTF-8 puis relu en Windows-1252 devient
/// « CÃ´te d'Ivoire » : la séquence de deux octets de « ô » est lue comme
/// deux caractères. Le motif `Ã` ou `Â` suivi d'un caractère de
/// ponctuation est la signature de cette double lecture.
const MOJIBAKE = /[ÃÂ][-¿]|â€™|â€œ|Ã©|Ã¨|Ã´|Ã§|Ã /;

/// Décode des octets en texte, en devinant l'encodage.
///
/// On tente l'UTF-8 en mode strict : s'il échoue, les octets ne sont pas
/// de l'UTF-8 valide, et c'est presque toujours du Windows-1252 (un export
/// d'un vieux logiciel de gestion, ou d'Excel sans BOM). Le repli est
/// silencieux mais l'écran affiche l'encodage retenu — et laisse en
/// changer, car aucune détection n'est infaillible.
export const decoder = (octets) => {
  try {
    const texte = new TextDecoder("utf-8", { fatal: true }).decode(octets);
    // UTF-8 valide, mais qui *contient* du mojibake : le fichier a déjà
    // subi une mauvaise conversion en amont. On le signale sans rien
    // corriger d'office — réparer à tort abîmerait un texte correct.
    return { texte, encodage: "utf-8", suspect: MOJIBAKE.test(texte) };
  } catch {
    return {
      texte: new TextDecoder("windows-1252").decode(octets),
      encodage: "windows-1252",
      suspect: false,
    };
  }
};

export const decoderAvec = (octets, encodage) => {
  try {
    return new TextDecoder(encodage).decode(octets);
  } catch {
    return new TextDecoder("utf-8").decode(octets);
  }
};

/// Répare un texte déjà abîmé : on reprend ses caractères pour des octets
/// Latin-1 et on les relit en UTF-8. « CÃ´te » redevient « Côte ».
export const reparerMojibake = (texte) => {
  try {
    const octets = Uint8Array.from([...texte].map((c) => c.charCodeAt(0) & 0xff));
    const repare = new TextDecoder("utf-8", { fatal: true }).decode(octets);
    return MOJIBAKE.test(repare) ? texte : repare;
  } catch {
    return texte; // la réparation n'est pas applicable : on ne touche à rien
  }
};

// ---------------------------------------------------------------------------
// Table de fréquences — la fonction signature de VisiData
// ---------------------------------------------------------------------------

/// Combien de fois chaque valeur apparaît dans une colonne.
///
/// C'est le geste le plus utile sur un fichier qu'on ne connaît pas :
/// il révèle d'un coup les fautes de saisie (« Abidjan » et « abidjan »),
/// les catégories réelles, et la part de chacune.
export const frequences = (lignes = [], colonne, limite = 50) => {
  const comptes = new Map();
  let vides = 0;
  for (const l of lignes) {
    const v = String(l[colonne] ?? "").trim();
    if (v === "") { vides += 1; continue; }
    comptes.set(v, (comptes.get(v) || 0) + 1);
  }
  const total = lignes.length || 1;
  const liste = [...comptes.entries()]
    .map(([valeur, n]) => ({ valeur, n, part: (n / total) * 100 }))
    .sort((a, b) => b.n - a.n);
  return {
    valeurs: liste.slice(0, limite),
    distinctes: liste.length,
    vides,
    tronquee: liste.length > limite,
  };
};

// ---------------------------------------------------------------------------
// Presse-papiers — échanger avec un vrai tableur
// ---------------------------------------------------------------------------

/// Excel, Sheets et LibreOffice s'échangent les plages en **TSV** : c'est
/// ce format qu'il faut produire pour qu'un collage arrive en colonnes et
/// non dans une seule cellule.
export const versTSV = (grille, { l1, c1, l2, c2 }) => {
  const lignes = [];
  for (let i = Math.min(l1, l2); i <= Math.max(l1, l2); i += 1) {
    const cellules = [];
    for (let j = Math.min(c1, c2); j <= Math.max(c1, c2); j += 1) {
      cellules.push(String(grille[i]?.[j] ?? "").replace(/[\t\r\n]/g, " "));
    }
    lignes.push(cellules.join("\t"));
  }
  return lignes.join("\n");
};

export const depuisTSV = (texte = "") =>
  texte.replace(/\r\n?$/, "").split(/\r?\n/).map((l) => l.split("\t"));

/// Colle un bloc à partir d'une cellule, en agrandissant la grille si le
/// bloc déborde — coller 50 lignes en bas d'un fichier doit les ajouter,
/// pas les perdre.
export const coller = (grille, bloc, l0, c0) => {
  const largeur = Math.max(grille[0]?.length || 0, c0 + Math.max(...bloc.map((b) => b.length)));
  const hauteur = Math.max(grille.length, l0 + bloc.length);

  const sortie = Array.from({ length: hauteur }, (_, i) => {
    const source = grille[i] || [];
    return Array.from({ length: largeur }, (_, j) => source[j] ?? "");
  });

  bloc.forEach((ligne, i) =>
    ligne.forEach((valeur, j) => {
      sortie[l0 + i][c0 + j] = valeur;
    }),
  );
  return sortie;
};

/// Recopie la valeur du haut de la sélection vers le bas — le Ctrl+D des
/// tableurs, geste quotidien pour remplir une colonne.
export const remplirVersLeBas = (grille, { l1, c1, l2, c2 }) => {
  const hautL = Math.min(l1, l2);
  const basL = Math.max(l1, l2);
  const gaucheC = Math.min(c1, c2);
  const droiteC = Math.max(c1, c2);
  return grille.map((ligne, i) => {
    if (i <= hautL || i > basL) return ligne;
    return ligne.map((v, j) =>
      j >= gaucheC && j <= droiteC ? grille[hautL][j] : v,
    );
  });
};

// ---------------------------------------------------------------------------
// Formules
// ---------------------------------------------------------------------------
//
// Une cellule qui commence par « = » est une formule. Le moteur couvre ce
// dont on se sert vraiment sur un fichier de gestion : les quatre
// opérations, les parenthèses, les références (A1), les plages (A1:A20) et
// une trentaine de fonctions.
//
// Il est écrit à la main — `eval` sur une saisie utilisateur exécuterait
// n'importe quel code dans la page, ce qui est hors de question dans un
// OS qui porte les données d'une entreprise.
//
// Les noms de fonctions existent en français **et** en anglais : un
// fichier venu d'Excel FR écrit `=SOMME(A1:A9)`, un autre `=SUM(A1:A9)`,
// et les deux doivent marcher.

const FONCTIONS = {
  // Agrégats
  SOMME: (v) => v.reduce((s, n) => s + n, 0),
  MOYENNE: (v) => (v.length ? v.reduce((s, n) => s + n, 0) / v.length : 0),
  MIN: (v) => (v.length ? Math.min(...v) : 0),
  MAX: (v) => (v.length ? Math.max(...v) : 0),
  NB: (v) => v.length,
  MEDIANE: (v) => {
    if (!v.length) return 0;
    const t = [...v].sort((a, b) => a - b);
    const m = Math.floor(t.length / 2);
    return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
  },
  ECARTYPE: (v) => {
    if (v.length < 2) return 0;
    const m = v.reduce((s, n) => s + n, 0) / v.length;
    return Math.sqrt(v.reduce((s, n) => s + (n - m) ** 2, 0) / (v.length - 1));
  },
  PRODUIT: (v) => v.reduce((p, n) => p * n, 1),
  // Arithmétique
  ABS: (v) => Math.abs(v[0] ?? 0),
  ARRONDI: (v) => {
    const f = 10 ** (v[1] ?? 0);
    return Math.round((v[0] ?? 0) * f) / f;
  },
  PLANCHER: (v) => Math.floor(v[0] ?? 0),
  PLAFOND: (v) => Math.ceil(v[0] ?? 0),
  RACINE: (v) => Math.sqrt(Math.max(0, v[0] ?? 0)),
  PUISSANCE: (v) => (v[0] ?? 0) ** (v[1] ?? 0),
  MOD: (v) => (v[1] ? (v[0] ?? 0) % v[1] : 0),
  // Métier : la TVA et les remises sont le calcul quotidien ici.
  TVA: (v) => (v[0] ?? 0) * ((v[1] ?? 18) / 100),
  TTC: (v) => (v[0] ?? 0) * (1 + (v[1] ?? 18) / 100),
  HT: (v) => (v[0] ?? 0) / (1 + (v[1] ?? 18) / 100),
  REMISE: (v) => (v[0] ?? 0) * (1 - (v[1] ?? 0) / 100),
  POURCENT: (v) => (v[1] ? ((v[0] ?? 0) / v[1]) * 100 : 0),
};

/// Les noms anglais renvoient aux mêmes fonctions.
const ALIAS_FONCTIONS = {
  SUM: "SOMME", AVERAGE: "MOYENNE", AVG: "MOYENNE", COUNT: "NB",
  MEDIAN: "MEDIANE", STDEV: "ECARTYPE", PRODUCT: "PRODUIT",
  ROUND: "ARRONDI", FLOOR: "PLANCHER", CEILING: "PLAFOND", CEIL: "PLAFOND",
  SQRT: "RACINE", POWER: "PUISSANCE", DISCOUNT: "REMISE", PERCENT: "POURCENT",
  VAT: "TVA", NET: "HT", GROSS: "TTC",
};

export const NOMS_FONCTIONS = [
  ...Object.keys(FONCTIONS),
  ...Object.keys(ALIAS_FONCTIONS),
].sort();

const REF = /^([A-Z]+)(\d+)$/;

/// « B3 » → { l: 2, c: 1 }, en indices de corps (la ligne 1 est la
/// première ligne de données, l'en-tête n'est pas numéroté).
export const decoderRef = (ref) => {
  const m = REF.exec(String(ref).toUpperCase());
  if (!m) return null;
  let c = 0;
  for (const car of m[1]) c = c * 26 + (car.charCodeAt(0) - 64);
  return { l: Number(m[2]) - 1, c: c - 1 };
};

/// Découpe une formule en unités : nombres, références, plages, noms,
/// opérateurs, parenthèses, points-virgules.
const tokeniser = (src) => {
  const jetons = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " ") { i += 1; continue; }
    if ("+-*/^%(),;:".includes(c)) { jetons.push({ t: c }); i += 1; continue; }
    if (/[0-9.]/.test(c)) {
      let n = "";
      while (i < src.length && /[0-9.]/.test(src[i])) { n += src[i]; i += 1; }
      jetons.push({ t: "nombre", v: Number(n) });
      continue;
    }
    if (/[A-Za-zÀ-ÿ_]/.test(c)) {
      let m = "";
      while (i < src.length && /[A-Za-z0-9À-ÿ_]/.test(src[i])) { m += src[i]; i += 1; }
      jetons.push({ t: "nom", v: m.toUpperCase() });
      continue;
    }
    throw new Error(`Caractère inattendu : ${c}`);
  }
  return jetons;
};

/// Évalue une formule.
///
/// `lire(l, c)` rend la valeur d'une cellule ; c'est l'appelant qui gère
/// la détection des cycles, parce que lui seul sait d'où part le calcul.
const evaluer = (jetons, lire) => {
  let p = 0;
  const fin = () => p >= jetons.length;
  const voir = () => jetons[p];
  const manger = (t) => {
    if (fin() || jetons[p].t !== t) throw new Error(`Attendu ${t}`);
    return jetons[p++];
  };

  /// Les valeurs d'une plage A1:B4, aplaties et réduites aux nombres —
  /// une cellule de texte dans une somme ne vaut pas zéro, elle ne compte
  /// simplement pas.
  const plage = (a, b) => {
    const d = decoderRef(a);
    const f = decoderRef(b);
    if (!d || !f) throw new Error("Plage invalide");
    const out = [];
    for (let l = Math.min(d.l, f.l); l <= Math.max(d.l, f.l); l += 1) {
      for (let c = Math.min(d.c, f.c); c <= Math.max(d.c, f.c); c += 1) {
        const v = versNombre(lire(l, c));
        if (v !== null) out.push(v);
      }
    }
    return out;
  };

  // expression → terme (('+'|'-') terme)*
  const expression = () => {
    let g = terme();
    while (!fin() && (voir().t === "+" || voir().t === "-")) {
      const op = jetons[p++].t;
      const d = terme();
      g = op === "+" ? g + d : g - d;
    }
    return g;
  };

  // terme → facteur (('*'|'/'|'%') facteur)*
  const terme = () => {
    let g = facteur();
    while (!fin() && (voir().t === "*" || voir().t === "/" || voir().t === "%")) {
      const op = jetons[p++].t;
      const d = facteur();
      if (op === "*") g *= d;
      else if (op === "/") {
        if (d === 0) throw new Error("Division par zéro");
        g /= d;
      } else g %= d;
    }
    return g;
  };

  // facteur → base ('^' facteur)?   — la puissance associe à droite
  const facteur = () => {
    const g = base();
    if (!fin() && voir().t === "^") { p += 1; return g ** facteur(); }
    return g;
  };

  const base = () => {
    if (fin()) throw new Error("Formule incomplète");
    const j = voir();

    if (j.t === "-") { p += 1; return -base(); }
    if (j.t === "+") { p += 1; return base(); }
    if (j.t === "nombre") { p += 1; return j.v; }

    if (j.t === "(") {
      p += 1;
      const v = expression();
      manger(")");
      return v;
    }

    if (j.t === "nom") {
      p += 1;
      // Appel de fonction
      if (!fin() && voir().t === "(") {
        p += 1;
        const nom = ALIAS_FONCTIONS[j.v] || j.v;
        const fn = FONCTIONS[nom];
        if (!fn) throw new Error(`Fonction inconnue : ${j.v}`);
        const args = [];
        if (!fin() && voir().t !== ")") {
          for (;;) {
            // Une plage se reconnaît à « ref : ref ».
            if (voir()?.t === "nom" && jetons[p + 1]?.t === ":" && jetons[p + 2]?.t === "nom") {
              args.push(...plage(jetons[p].v, jetons[p + 2].v));
              p += 3;
            } else args.push(expression());
            if (!fin() && (voir().t === "," || voir().t === ";")) { p += 1; continue; }
            break;
          }
        }
        manger(")");
        return fn(args);
      }
      // Référence simple
      const r = decoderRef(j.v);
      if (!r) throw new Error(`Référence inconnue : ${j.v}`);
      return versNombre(lire(r.l, r.c)) ?? 0;
    }

    throw new Error("Formule invalide");
  };

  const valeur = expression();
  if (!fin()) throw new Error("Formule invalide");
  return valeur;
};

export const estFormule = (v) => typeof v === "string" && v.trim().startsWith("=");

/// Calcule la valeur affichée d'une cellule.
///
/// `vues` porte les cellules déjà traversées : une formule qui se
/// référence, directement ou par un détour, doit dire « cycle » plutôt que
/// de faire boucler le navigateur jusqu'au plantage.
export const calculer = (corps, l, c, vues = new Set(), resoudreReference = null) => {
  const brute = corps[l]?.[c];
  if (!estFormule(brute)) return brute ?? "";

  const cle = `${l}:${c}`;
  if (vues.has(cle)) return "#CYCLE";
  vues.add(cle);

  try {
    const lire = (rl, rc) => {
      if (resoudreReference) return resoudreReference(rl, rc, vues);
      const v = corps[rl]?.[rc];
      if (!estFormule(v)) return v;
      const resultat = calculer(corps, rl, rc, vues);
      // Une cellule en erreur contamine celles qui la lisent : sans cette
      // remontée, « #CYCLE » se convertirait en 0 un cran plus haut et la
      // formule afficherait un résultat faux au lieu de dire qu'elle ne
      // peut pas se calculer.
      if (typeof resultat === "string" && resultat.startsWith("#")) {
        const erreur = new Error(resultat);
        erreur.marqueur = resultat;
        throw erreur;
      }
      return resultat;
    };
    const valeur = evaluer(tokeniser(brute.trim().slice(1)), lire);
    if (!Number.isFinite(valeur)) return "#NOMBRE";
    // Pas de décimales fantômes : 0,1 + 0,2 doit afficher 0,3.
    return String(Math.round(valeur * 1e10) / 1e10);
  } catch (e) {
    if (e.marqueur) return e.marqueur;
    return e.message === "Division par zéro" ? "#DIV/0" : "#ERREUR";
  } finally {
    vues.delete(cle);
  }
};

/// La grille telle qu'elle s'affiche : formules remplacées par leur
/// résultat. Sert à l'écran et à l'export — on n'envoie pas « =A1*2 » à
/// un comptable.
export const calculerTout = (corps) =>
  corps.map((ligne, l) => ligne.map((_, c) => calculer(corps, l, c)));

/// Y a-t-il au moins une formule ? Inutile de tout recalculer sinon.
export const contientFormules = (corps) =>
  corps.some((l) => l.some((c) => estFormule(c)));

/// A, B, … Z, AA, AB… comme dans un tableur, pour désigner une colonne
/// sans en-tête.
export const repereColonne = (index) => {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};
