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
  decoderRef,
  estFormule,
  repereColonne,
  versNombre,
} from "../tableur/domaine.js";

export { estFormule, repereColonne, versNombre };

export const LIGNES_DEFAUT = 40;
export const COLONNES_DEFAUT = 12;
export const LARGEUR_DEFAUT = 88;

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
export const formater = (valeur, format = "auto", devise = "F", decimales = null) => {
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
      return groupe(n, Number.isInteger(decimales) ? decimales : 2);
    case "monnaie":
      return `${groupe(Math.round(n), 0)}${ESPACE_FIN}${devise}`;
    case "pourcent":
      return `${groupe(n * 100, n * 100 % 1 === 0 ? 0 : 1)}${ESPACE_FIN}%`;
    default:
      // « auto » : les nombres se groupent, le texte reste intact. C'est
      // ce qui rend un tableau de chiffres lisible sans rien régler.
      return Number.isInteger(n) ? groupe(n, 0) : groupe(n, Number.isInteger(decimales) ? decimales : 2);
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
/// La grille telle que le moteur de formules la lit. Une formule saisie est
/// rangée dans `f` avec un `v` vide : sans ce repli, le moteur voyait une
/// cellule vide — la copie et le calcul rapide de la barre d'état
/// perdaient toutes les cellules calculées.
const brutes = (cellules) => cellules.map((l) => l.map((c) =>
  ((c?.v === "" || c?.v === undefined) && c?.f ? c.f : c?.v ?? "")));

/// Le résultat affiché d'une cellule : formule calculée puis mise en forme.
export const valeurAffichee = (cellules, l, c, devise) => {
  const cel = cellules[l]?.[c];
  if (!cel || ((cel.v === "" || cel.v === undefined) && !cel.f)) return "";
  const valeur = cel.f && (cel.v === "" || cel.v === undefined) ? cel.f : cel.v;
  const calculee = estFormule(valeur) ? calculerBrut(brutes(cellules), l, c) : valeur;
  return formater(calculee, cel.s?.format || "auto", devise, cel.s?.decimales);
};

/// La valeur calculée **sans** mise en forme — ce qu'un export doit écrire.
export const valeurCalculee = (cellules, l, c) => {
  const cel = cellules[l]?.[c];
  // Une formule saisie laisse `v` vide ou absent selon le chemin : les deux
  // cas doivent mener à la formule, comme dans `valeurAffichee`.
  const vide = cel?.v === "" || cel?.v === undefined;
  if (!cel || (vide && !cel.f)) return "";
  const valeur = cel.f && vide ? cel.f : cel.v;
  return estFormule(valeur) ? calculerBrut(brutes(cellules), l, c) : valeur;
};

const REFERENCE_INTERFEUILLE = /(?:'((?:[^']|'')+)'|([A-Za-zÀ-ÿ_][A-Za-z0-9À-ÿ_.]*))!\$?([A-Z]+)\$?(\d+)/gi;

/// Calcule une cellule dans le contexte du classeur entier. Excel stocke
/// `'Paramètres'!$F$4` dans la formule, alors que l'ancien moteur ne voyait
/// que la feuille active. Les fonctions non encore comprises conservent
/// leur résultat Excel mis en cache au lieu d'afficher une erreur trompeuse.
export const valeurCalculeeClasseur = (classeur, iFeuille, l, c, visites = new Set()) => {
  const feuille = classeur?.feuilles?.[iFeuille];
  const cel = feuille?.cellules?.[l]?.[c];
  if (!cel) return "";
  const formule = cel.f || (estFormule(cel.v) ? cel.v : "");
  if (!formule) return cel.v ?? "";

  const cle = `${iFeuille}:${l}:${c}`;
  if (visites.has(cle)) return "#CYCLE";
  visites.add(cle);
  try {
    let source = formule.replace(REFERENCE_INTERFEUILLE, (_, nomEntreQuotes, nomSimple, colonne, ligne) => {
      const nom = String(nomEntreQuotes || nomSimple || "").replace(/''/g, "'");
      const cibleFeuille = classeur.feuilles.findIndex((f) => f.nom.toLocaleLowerCase() === nom.toLocaleLowerCase());
      const position = decoderRef(`${colonne}${ligne}`);
      if (cibleFeuille < 0 || !position) return "0";
      const valeur = valeurCalculeeClasseur(classeur, cibleFeuille, position.l, position.c, visites);
      const nombre = versNombre(valeur);
      return nombre === null ? "0" : String(nombre);
    });
    source = source.replace(/\$/g, "");

    const corps = brutes(feuille.cellules);
    corps[l] = [...(corps[l] || [])];
    corps[l][c] = source;
    const resultat = calculerBrut(corps, l, c, new Set(), (rl, rc) =>
      valeurCalculeeClasseur(classeur, iFeuille, rl, rc, visites));
    if (typeof resultat === "string" && resultat.startsWith("#") && cel.v !== "" && cel.v !== formule) {
      return cel.v;
    }
    return resultat;
  } finally {
    visites.delete(cle);
  }
};

export const valeurAfficheeClasseur = (classeur, iFeuille, l, c, devise) => {
  const cel = classeur?.feuilles?.[iFeuille]?.cellules?.[l]?.[c];
  if (!cel || ((cel.v === "" || cel.v === undefined) && !cel.f)) return "";
  return formater(
    valeurCalculeeClasseur(classeur, iFeuille, l, c),
    cel.s?.format || "auto",
    devise,
    cel.s?.decimales,
  );
};

export const optionsValidation = (classeur, validation) => {
  const source = validation?.source;
  if (!source?.feuille || !source?.plage) return validation?.options || [];
  const iSource = classeur?.feuilles?.findIndex((f) => f.nom === source.feuille) ?? -1;
  if (iSource < 0) return validation?.options || [];
  const p = source.plage;
  const valeurs = [];
  for (let l = p.l1; l <= p.l2; l += 1) {
    for (let c = p.c1; c <= p.c2; c += 1) {
      const valeur = String(valeurCalculeeClasseur(classeur, iSource, l, c) ?? "").trim();
      if (valeur && !valeurs.includes(valeur)) valeurs.push(valeur);
    }
  }
  return valeurs.length ? valeurs.slice(0, 500) : validation?.options || [];
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
      // Retirer la mise en forme ne doit jamais retirer le contenu annexe
      // de la cellule (notamment la formule importée et son cache Excel).
      if (Object.keys(s).length) return { ...cel, s };
      const sansStyle = { ...cel };
      delete sansStyle.s;
      return sansStyle;
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

const decalerFormule = (valeur, dl, dc) => {
  if (!estFormule(valeur)) return valeur;
  return valeur.replace(/(\$?)([A-Z]+)(\$?)(\d+)/gi, (_, fixeC, lettres, fixeL, numero) => {
    let colonne = 0;
    for (const lettre of lettres.toUpperCase()) colonne = colonne * 26 + lettre.charCodeAt(0) - 64;
    const c = Math.max(0, colonne - 1 + (fixeC ? 0 : dc));
    const l = Math.max(0, Number(numero) - 1 + (fixeL ? 0 : dl));
    return `${fixeC}${repereColonne(c)}${fixeL}${l + 1}`;
  });
};

/// Recopie une sélection jusqu'à la cellule visée par sa poignée. Les suites
/// de nombres sont prolongées ; les autres contenus sont répétés en motif.
/// Les références relatives des formules suivent leur nouvelle position.
export const recopierAvecPoignee = (cellules, source, cible) => {
  const s = normaliser(source);
  const zone = {
    l1: Math.min(s.l1, cible.l), c1: Math.min(s.c1, cible.c),
    l2: Math.max(s.l2, cible.l), c2: Math.max(s.c2, cible.c),
  };
  const agrandies = agrandir(cellules, zone.l2 + 1, zone.c2 + 1);
  const h = s.l2 - s.l1 + 1;
  const w = s.c2 - s.c1 + 1;
  const verticale = w === 1 && h >= 2;
  const horizontale = h === 1 && w >= 2;
  const premiers = verticale
    ? [versNombre(agrandies[s.l1][s.c1].v), versNombre(agrandies[s.l1 + 1][s.c1].v)]
    : horizontale
      ? [versNombre(agrandies[s.l1][s.c1].v), versNombre(agrandies[s.l1][s.c1 + 1].v)]
      : [null, null];
  const pas = premiers[0] !== null && premiers[1] !== null ? premiers[1] - premiers[0] : null;

  return agrandies.map((ligne, l) => ligne.map((cel, c) => {
    if (l < zone.l1 || l > zone.l2 || c < zone.c1 || c > zone.c2) return cel;
    if (l >= s.l1 && l <= s.l2 && c >= s.c1 && c <= s.c2) return cel;

    if (pas !== null && verticale && c === s.c1) {
      const base = versNombre(agrandies[s.l1][s.c1].v);
      return { ...agrandies[s.l1][s.c1], v: String(base + (l - s.l1) * pas) };
    }
    if (pas !== null && horizontale && l === s.l1) {
      const base = versNombre(agrandies[s.l1][s.c1].v);
      return { ...agrandies[s.l1][s.c1], v: String(base + (c - s.c1) * pas) };
    }

    const sl = s.l1 + (((l - s.l1) % h) + h) % h;
    const sc = s.c1 + (((c - s.c1) % w) + w) % w;
    const origine = agrandies[sl][sc];
    const formule = origine.f || (estFormule(origine.v) ? origine.v : "");
    return {
      ...origine,
      s: origine.s ? { ...origine.s } : undefined,
      v: formule ? "" : origine.v,
      ...(formule ? { f: decalerFormule(formule, l - sl, c - sc) } : {}),
    };
  }));
};

/// Place une somme sous la colonne sélectionnée, comme le bouton Σ d'Excel.
/// Si plusieurs colonnes sont sélectionnées, chacune reçoit sa formule.
export const agregatAutomatique = (cellules, plage, fonction = "SOMME") => {
  const { l1, c1, l2, c2 } = normaliser(plage);
  const cible = l2 + 1;
  const agrandies = agrandir(cellules, cible + 1, cellules[0]?.length || c2 + 1);
  return agrandies.map((ligne, i) =>
    i !== cible
      ? ligne
      : ligne.map((cel, j) =>
          j < c1 || j > c2
            ? cel
            : {
                ...cel,
                v: `=${fonction}(${repereColonne(j)}${l1 + 1}:${repereColonne(j)}${l2 + 1})`,
              },
        ),
  );
};

export const sommeAutomatique = (cellules, plage) => agregatAutomatique(cellules, plage, "SOMME");

/// Compacte les lignes du bloc sélectionné en gardant la première occurrence.
/// Le reste de la feuille ne bouge pas, ce qui évite de désaligner des données
/// situées hors de la plage.
export const retirerDoublonsPlage = (cellules, plage) => {
  const { l1, c1, l2, c2 } = normaliser(plage);
  const vus = new Set();
  const uniques = [];
  for (let l = l1; l <= l2; l += 1) {
    const bloc = cellules[l].slice(c1, c2 + 1);
    const cle = JSON.stringify(bloc.map((cel) => String(cel?.v ?? "").trim()));
    if (!vus.has(cle)) { vus.add(cle); uniques.push(bloc); }
  }
  return cellules.map((ligne, l) => ligne.map((cel, c) => {
    if (l < l1 || l > l2 || c < c1 || c > c2) return cel;
    const source = uniques[l - l1]?.[c - c1];
    return source ? { ...source, s: source.s ? { ...source.s } : undefined } : celluleVide();
  }));
};

export const surlignerDoublons = (cellules, plage) => {
  const { l1, c1, l2, c2 } = normaliser(plage);
  const comptes = new Map();
  for (let l = l1; l <= l2; l += 1) for (let c = c1; c <= c2; c += 1) {
    const valeur = String(cellules[l]?.[c]?.v ?? "").trim().toLocaleLowerCase("fr");
    if (valeur) comptes.set(valeur, (comptes.get(valeur) || 0) + 1);
  }
  return cellules.map((ligne, l) => ligne.map((cel, c) => {
    if (l < l1 || l > l2 || c < c1 || c > c2) return cel;
    const valeur = String(cel?.v ?? "").trim().toLocaleLowerCase("fr");
    if (!valeur || (comptes.get(valeur) || 0) < 2) return cel;
    return { ...cel, s: { ...(cel.s || {}), couleurFond: "FCE8E6", couleurTexte: "B3261E" } };
  }));
};

/// Trie les lignes d'une plage selon sa première colonne, sans déplacer le
/// reste de la feuille. Les nombres restent numériques, puis vient le texte.
export const trierPlage = (cellules, plage, direction = "asc") => {
  const { l1, c1, l2, c2 } = normaliser(plage);
  const bloc = cellules.slice(l1, l2 + 1).map((ligne) =>
    ligne.slice(c1, c2 + 1).map((cel) => ({ ...cel, s: cel.s ? { ...cel.s } : undefined })),
  );
  const facteur = direction === "desc" ? -1 : 1;
  bloc.sort((a, b) => {
    const av = a[0]?.v ?? "";
    const bv = b[0]?.v ?? "";
    const an = versNombre(av);
    const bn = versNombre(bv);
    if (an !== null && bn !== null) return (an - bn) * facteur;
    return String(av).localeCompare(String(bv), "fr", { numeric: true }) * facteur;
  });
  return cellules.map((ligne, i) => {
    if (i < l1 || i > l2) return ligne;
    return ligne.map((cel, j) =>
      j < c1 || j > c2 ? cel : bloc[i - l1][j - c1],
    );
  });
};

export const trouver = (cellules, recherche, depart = { l: 0, c: 0 }) => {
  const terme = String(recherche || "").toLocaleLowerCase("fr");
  if (!terme) return null;
  const positions = [];
  for (let l = 0; l < cellules.length; l += 1) {
    for (let c = 0; c < (cellules[l]?.length || 0); c += 1) positions.push({ l, c });
  }
  const index = positions.findIndex((p) => p.l === depart.l && p.c === depart.c);
  const ordre = [...positions.slice(index + 1), ...positions.slice(0, index + 1)];
  return ordre.find(({ l, c }) =>
    String(cellules[l]?.[c]?.v ?? "").toLocaleLowerCase("fr").includes(terme),
  ) || null;
};

export const remplacerTout = (cellules, recherche, remplacement) => {
  const terme = String(recherche || "");
  if (!terme) return cellules;
  const motif = new RegExp(terme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return cellules.map((ligne) =>
    ligne.map((cel) => ({ ...cel, v: String(cel?.v ?? "").replace(motif, remplacement) })),
  );
};

/// Sélection → TSV, le format que s'échangent les tableurs.
export const versTSV = (cellules, plage, _devise) => {
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

/// `valeurDe` permet au classeur de fournir son propre calcul (références à
/// d'autres feuilles comprises) ; par défaut, la feuille seule.
export const resume = (cellules, plage, valeurDe = (i, j) => valeurCalculee(cellules, i, j)) => {
  const { l1, c1, l2, c2 } = normaliser(plage);
  const nombres = [];
  let remplies = 0;
  let total = 0;
  for (let i = l1; i <= l2; i += 1) {
    for (let j = c1; j <= c2; j += 1) {
      total += 1;
      const v = valeurDe(i, j);
      // Une cellule vide n'est pas un zéro : `Number("")` vaut 0, et la
      // compter faussait la moyenne. Excel l'ignore, nous aussi.
      if (String(v ?? "").trim() === "") continue;
      remplies += 1;
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
