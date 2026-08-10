// Classeur — le modèle, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI DISTINGUE LE CLASSEUR DU TABLEUR CSV
//
// Le Tableur CSV est un **outil de fichier** : on ouvre un .csv reçu, on le
// corrige, on le réenregistre. Une feuille, du texte, rien d'autre — parce
// que le format CSV ne sait rien porter d'autre.
//
// Le Classeur est un **document de travail** : plusieurs feuilles, des
// cellules mises en forme, des formats de nombre, et une existence propre
// dans l'espace de travail. Il s'exporte en `.xlsx`, le vrai format, et
// sait le relire.
//
// LE MODÈLE DE DONNÉES, INSPIRÉ DE react-spreadsheet
//
// La bibliothèque `react-spreadsheet` (iddan) tient sa grille dans une
// `Matrix<CellBase>` : un tableau à deux dimensions d'**objets** cellule,
// et non de chaînes. C'est l'idée qu'on lui reprend, parce que c'est elle
// qui rend la mise en forme possible : une cellule qui n'est qu'une chaîne
// ne peut pas être grasse.
//
//   cellule = { v: "12000", s: { gras: true, format: "monnaie" } }
//
// `v` est la valeur **saisie** — une formule y reste sous sa forme
// « =SOMME(A1:A9) ». `s` est facultatif : une cellule sans mise en forme
// n'a pas de `s` du tout, ce qui garde les classeurs légers.
//
// Le moteur de formules n'est pas réécrit : c'est celui du Tableur CSV,
// importé tel quel. Deux moteurs divergeraient au premier correctif.
// ─────────────────────────────────────────────────────────────────────────

import {
  calculer as calculerBrut,
  estFormule,
  repereColonne,
  versNombre,
} from "../tableur/domaine";

export { estFormule, repereColonne, versNombre };

export const LIGNES_DEFAUT = 40;
export const COLONNES_DEFAUT = 12;
export const LARGEUR_DEFAUT = 108;

// ---------------------------------------------------------------------------
// Formats de nombre
// ---------------------------------------------------------------------------

/// Ce que la cellule *montre*, indépendamment de ce qu'elle *contient*.
/// Une cellule vaut 0,18 et s'affiche « 18 % » : la donnée ne change pas.
export const FORMATS = [
  { id: "auto", nom: { fr: "Automatique", en: "Automatic" } },
  { id: "texte", nom: { fr: "Texte", en: "Text" } },
  { id: "nombre", nom: { fr: "Nombre", en: "Number" } },
  { id: "entier", nom: { fr: "Entier", en: "Integer" } },
  { id: "monnaie", nom: { fr: "Monnaie", en: "Currency" } },
  { id: "pourcent", nom: { fr: "Pourcentage", en: "Percentage" } },
  { id: "date", nom: { fr: "Date", en: "Date" } },
];

const ESPACE_FIN = " "; // espace fine insécable : 12 000, pas 12000

const groupe = (n, decimales) =>
  n
    .toLocaleString("fr-FR", {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    })
    .replace(/ |\s/g, ESPACE_FIN);

/// Met en forme une valeur pour l'affichage.
///
/// `devise` vient du réglage de l'espace (voir src/utils/monnaie.js) : le
/// classeur ne décide pas tout seul d'écrire des francs.
export const formater = (valeur, format = "auto", devise = "F") => {
  const s = String(valeur ?? "");
  if (s === "") return "";
  // Une erreur de formule s'affiche telle quelle : la mettre en forme
  // comme un nombre donnerait « #DIV/0 » transformé en « 0 ».
  if (s.startsWith("#")) return s;
  if (format === "texte") return s;

  // La date se traite **avant** le garde-fou numérique : « 2026-08-09 »
  // n'est pas un nombre, et le laisser filer renverrait la chaîne ISO
  // telle quelle — le format ne servirait à rien.
  if (format === "date") {
    const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("fr-FR");
  }

  const n = versNombre(s);
  if (n === null) return s;

  switch (format) {
    case "entier":
      return groupe(Math.round(n), 0);
    case "nombre":
      return groupe(n, 2);
    case "monnaie":
      return `${groupe(Math.round(n), 0)}${ESPACE_FIN}${devise}`;
    case "pourcent":
      return `${groupe(n * 100, n * 100 % 1 === 0 ? 0 : 1)}${ESPACE_FIN}%`;
    default:
      // « auto » : les nombres se groupent, le texte reste intact. C'est
      // ce qui rend un tableau de chiffres lisible sans rien régler.
      return Number.isInteger(n) ? groupe(n, 0) : groupe(n, 2);
  }
};

// ---------------------------------------------------------------------------
// Cellules et feuilles
// ---------------------------------------------------------------------------

export const celluleVide = () => ({ v: "" });

export const feuilleVide = (nom = "Feuille 1", lignes = LIGNES_DEFAUT, colonnes = COLONNES_DEFAUT) => ({
  nom,
  cellules: Array.from({ length: lignes }, () =>
    Array.from({ length: colonnes }, celluleVide),
  ),
  largeurs: {},
  figees: { lignes: 0, colonnes: 0 },
});

export const classeurVide = (titre = "Nouveau classeur") => ({
  titre,
  feuilles: [feuilleVide()],
  version: 1,
});

/// La valeur brute d'une cellule, pour le moteur de formules qui ne
/// connaît que des chaînes.
const brutes = (cellules) => cellules.map((l) => l.map((c) => c?.v ?? ""));

/// Le résultat affiché d'une cellule : formule calculée puis mise en forme.
export const valeurAffichee = (cellules, l, c, devise) => {
  const cel = cellules[l]?.[c];
  if (!cel || cel.v === "" || cel.v === undefined) return "";
  const calculee = estFormule(cel.v) ? calculerBrut(brutes(cellules), l, c) : cel.v;
  return formater(calculee, cel.s?.format || "auto", devise);
};

/// La valeur calculée **sans** mise en forme — ce qu'un export doit écrire.
export const valeurCalculee = (cellules, l, c) => {
  const cel = cellules[l]?.[c];
  if (!cel || cel.v === "") return "";
  return estFormule(cel.v) ? calculerBrut(brutes(cellules), l, c) : cel.v;
};

// ---------------------------------------------------------------------------
// Opérations — toutes rendent une NOUVELLE feuille
// ---------------------------------------------------------------------------

export const poser = (cellules, l, c, patch) =>
  cellules.map((ligne, i) =>
    i !== l
      ? ligne
      : ligne.map((cel, j) => (j === c ? { ...cel, ...patch } : cel)),
  );

/// Applique un style à une plage. `bascule` inverse un booléen au lieu de
/// le poser : c'est ce qu'on attend d'un bouton « gras ».
export const styler = (cellules, plage, patch, bascule = false) => {
  const { l1, c1, l2, c2 } = normaliser(plage);
  // Pour une bascule, l'état de la première cellule décide de toute la
  // plage — sinon un bouton alterne les cellules une sur deux.
  const [cle] = Object.keys(patch);
  const actif = bascule ? !cellules[l1]?.[c1]?.s?.[cle] : null;

  return cellules.map((ligne, i) => {
    if (i < l1 || i > l2) return ligne;
    return ligne.map((cel, j) => {
      if (j < c1 || j > c2) return cel;
      const s = { ...(cel.s || {}), ...patch };
      if (bascule) s[cle] = actif;
      // Une propriété remise à sa valeur neutre disparaît : un classeur
      // ne doit pas grossir de styles vides à chaque clic.
      for (const k of Object.keys(s)) {
        if (s[k] === false || s[k] === "" || s[k] === "auto" || s[k] == null) delete s[k];
      }
      return Object.keys(s).length ? { ...cel, s } : { v: cel.v };
    });
  });
};

export const normaliser = ({ l, c, l2, c2 }) => ({
  l1: Math.min(l, l2), c1: Math.min(c, c2),
  l2: Math.max(l, l2), c2: Math.max(c, c2),
});

export const insererLigne = (cellules, index) => {
  const copie = [...cellules];
  copie.splice(index, 0, Array.from({ length: cellules[0]?.length || 1 }, celluleVide));
  return copie;
};

export const supprimerLigne = (cellules, index) =>
  cellules.length > 1 ? cellules.filter((_, i) => i !== index) : cellules;

export const insererColonne = (cellules, index) =>
  cellules.map((l) => {
    const copie = [...l];
    copie.splice(index, 0, celluleVide());
    return copie;
  });

export const supprimerColonne = (cellules, index) =>
  cellules[0]?.length > 1 ? cellules.map((l) => l.filter((_, j) => j !== index)) : cellules;

/// Agrandit la grille pour qu'une saisie hors bornes tienne — coller un
/// bloc de 200 lignes dans une feuille de 40 doit l'agrandir.
export const agrandir = (cellules, lignes, colonnes) => {
  const L = Math.max(cellules.length, lignes);
  const C = Math.max(cellules[0]?.length || 0, colonnes);
  return Array.from({ length: L }, (_, i) =>
    Array.from({ length: C }, (_, j) => cellules[i]?.[j] ?? celluleVide()),
  );
};

export const vider = (cellules, plage) => {
  const { l1, c1, l2, c2 } = normaliser(plage);
  return cellules.map((ligne, i) =>
    i < l1 || i > l2
      ? ligne
      : ligne.map((cel, j) => (j < c1 || j > c2 ? cel : { v: "" })),
  );
};

/// Recopie la première ligne de la plage vers le bas, style compris.
export const remplirVersLeBas = (cellules, plage) => {
  const { l1, c1, l2, c2 } = normaliser(plage);
  return cellules.map((ligne, i) => {
    if (i <= l1 || i > l2) return ligne;
    return ligne.map((cel, j) => (j >= c1 && j <= c2 ? { ...cellules[l1][j] } : cel));
  });
};

/// Sélection → TSV, le format que s'échangent les tableurs.
export const versTSV = (cellules, plage, devise) => {
  const { l1, c1, l2, c2 } = normaliser(plage);
  const out = [];
  for (let i = l1; i <= l2; i += 1) {
    const ligne = [];
    for (let j = c1; j <= c2; j += 1) {
      ligne.push(String(valeurCalculee(cellules, i, j) ?? "").replace(/[\t\r\n]/g, " "));
    }
    out.push(ligne.join("\t"));
  }
  return out.join("\n");
};

export const collerTSV = (cellules, texte, l0, c0) => {
  const bloc = texte.replace(/\r\n?$/, "").split(/\r?\n/).map((l) => l.split("\t"));
  const agrandie = agrandir(cellules, l0 + bloc.length, c0 + Math.max(...bloc.map((b) => b.length)));
  return agrandie.map((ligne, i) =>
    ligne.map((cel, j) => {
      const v = bloc[i - l0]?.[j - c0];
      return v === undefined ? cel : { ...cel, v };
    }),
  );
};

// ---------------------------------------------------------------------------
// Statistiques de sélection — la barre d'état d'un tableur
// ---------------------------------------------------------------------------

export const resume = (cellules, plage) => {
  const { l1, c1, l2, c2 } = normaliser(plage);
  const nombres = [];
  let remplies = 0;
  let total = 0;
  for (let i = l1; i <= l2; i += 1) {
    for (let j = c1; j <= c2; j += 1) {
      total += 1;
      const v = valeurCalculee(cellules, i, j);
      if (String(v ?? "") !== "") remplies += 1;
      const n = versNombre(v);
      if (n !== null) nombres.push(n);
    }
  }
  if (total < 2) return null;
  const somme = nombres.reduce((s, n) => s + n, 0);
  return {
    total,
    remplies,
    n: nombres.length,
    somme,
    moyenne: nombres.length ? somme / nombres.length : 0,
    min: nombres.length ? Math.min(...nombres) : 0,
    max: nombres.length ? Math.max(...nombres) : 0,
  };
};

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

export const PROFONDEUR = 30;

export const empiler = (h, etat) => ({
  passe: [...h.passe, etat].slice(-PROFONDEUR),
  futur: [],
});

export const annuler = (h, courant) => {
  if (!h.passe.length) return { historique: h, etat: courant };
  const passe = [...h.passe];
  const etat = passe.pop();
  return { historique: { passe, futur: [courant, ...h.futur] }, etat };
};

export const retablir = (h, courant) => {
  if (!h.futur.length) return { historique: h, etat: courant };
  const [etat, ...futur] = h.futur;
  return { historique: { passe: [...h.passe, courant], futur }, etat };
};

// ---------------------------------------------------------------------------
// Noms de feuilles
// ---------------------------------------------------------------------------

/// Un nom de feuille libre, sans collision.
export const nomLibre = (feuilles, base = "Feuille") => {
  const pris = new Set(feuilles.map((f) => f.nom));
  let i = feuilles.length + 1;
  while (pris.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
};

/// Excel refuse ces caractères dans un nom d'onglet, et limite à 31
/// caractères : un export au nom invalide produit un fichier que le
/// tableur refuse d'ouvrir, sans dire pourquoi.
export const nomDeFeuilleValide = (nom) =>
  String(nom || "Feuille").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Feuille";
