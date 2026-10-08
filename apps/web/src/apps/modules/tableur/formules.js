// Moteur de formules — partagé par le Classeur et le Tableur CSV.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QU'IL COMPREND
//
// La syntaxe d'Excel, en français comme en anglais :
//
//   • `=SI(A1>10;"oui";"non")` et `=IF(A1>10,"yes","no")` : le point-virgule
//     sépare les arguments à la française, la virgule à l'anglaise ;
//   • la virgule décimale (`=A1*1,18`) dès que la formule est « française »
//     (elle contient un point-virgule) ou hors des parenthèses d'une
//     fonction — là, une virgule ne peut pas séparer des arguments ;
//   • le texte entre guillemets, la concaténation `&`, les comparaisons
//     (= <> < > <= >=), le pourcentage postfixé (`50%`), les références
//     absolues (`$A$1`), les colonnes entières (`A:A`) et les autres
//     feuilles (`'Paramètres'!B2`, `Feuil2!A1:A10`) ;
//   • une centaine de fonctions : conditions (SI, ET, SIERREUR…), recherche
//     (RECHERCHEV, RECHERCHEX, INDEX, EQUIV), agrégats conditionnels
//     (SOMME.SI.ENS, NB.SI…), texte, dates — et les fonctions métier
//     (TVA, TTC, HT, REMISE).
//
// LES VALEURS
//
// Le moteur ne travaille pas sur des chaînes mais sur des valeurs typées :
// nombre, texte, booléen, date, vide, erreur, plage. Les cellules, elles,
// restent stockées en texte (« 12 », « 2026-10-08 », « VRAI ») : on les
// convertit à la lecture et on reconvertit le résultat à la sortie.
//
// Une date est un numéro de série d'Excel (jours depuis le 30/12/1899),
// porté par un type à part pour que `=A1+30` reste une date ; elle sort en
// ISO (« 2026-11-07 »), le format de date du Classeur.
//
// POURQUOI À LA MAIN
//
// `eval` sur une saisie utilisateur exécuterait n'importe quel code dans
// la page — hors de question dans un OS qui porte les données d'une
// entreprise. Et une bibliothèque de formules complète pèse plusieurs
// centaines de kilo-octets pour des fonctions financières que personne
// n'utilise ici.
// ─────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Valeurs
// ---------------------------------------------------------------------------

export const ERREURS = {
  DIV0: "#DIV/0!",
  VALEUR: "#VALEUR!",
  NOM: "#NOM?",
  NA: "#N/A",
  REF: "#REF!",
  NOMBRE: "#NOMBRE!",
  CYCLE: "#CYCLE",
  SYNTAXE: "#ERREUR",
};

class Erreur {
  constructor(code) { this.code = code; }
}
class DateV {
  constructor(n) { this.n = n; }
}
/// Une plage : ses valeurs en lignes, déjà converties.
class Plage {
  constructor(valeurs) { this.valeurs = valeurs; }
  get lignes() { return this.valeurs.length; }
  get colonnes() { return this.valeurs[0]?.length || 0; }
  aplatie() { return this.valeurs.flat(); }
}

const err = (code) => new Erreur(code);
const estErreur = (v) => v instanceof Erreur;

/// Une erreur levée pour couper court à une évaluation : elle remonte
/// jusqu'à la fonction qui sait la rattraper (SIERREUR) ou jusqu'au bout.
class Interruption extends Error {
  constructor(erreur) { super(erreur.code); this.erreur = erreur; }
}
const lever = (e) => { throw new Interruption(e); };
const verifier = (v) => (estErreur(v) ? lever(v) : v);

// ---- Dates ----------------------------------------------------------------

const EPOQUE = Date.UTC(1899, 11, 30);
const JOUR_MS = 86400000;

const serieDepuis = (annee, mois, jour) => (Date.UTC(annee, mois - 1, jour) - EPOQUE) / JOUR_MS;
const dateDepuisSerie = (n) => new Date(EPOQUE + Math.floor(n) * JOUR_MS);
const isoDepuisSerie = (n) => dateDepuisSerie(n).toISOString().slice(0, 10);

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_FR = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

/// « 2026-10-08 » ou « 08/10/2026 » → numéro de série, sinon null.
const serieDepuisTexte = (s) => {
  let m = ISO.exec(s);
  if (m) return serieDepuis(Number(m[1]), Number(m[2]), Number(m[3]));
  m = DATE_FR.exec(s);
  if (m) {
    const annee = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return serieDepuis(annee, Number(m[2]), Number(m[1]));
  }
  return null;
};

// ---- Nombres --------------------------------------------------------------

const ESPACES = /[\s  ]/g;

/// Lit un nombre écrit à la française ou à l'anglaise : « 12 000,50 »,
/// « 12000.5 », « -3 », « 15 % ». Rend null si ce n'en est pas un.
export const lireNombre = (texte) => {
  let s = String(texte ?? "").trim();
  if (s === "") return null;
  let facteur = 1;
  if (s.endsWith("%")) { facteur = 0.01; s = s.slice(0, -1).trim(); }
  s = s.replace(ESPACES, "");
  if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n * facteur : null;
};

/// Le contenu d'une cellule, tel que le moteur le voit.
export const depuisCellule = (brute) => {
  if (brute === undefined || brute === null) return null;
  if (typeof brute === "number") return brute;
  if (typeof brute === "boolean") return brute;
  const s = String(brute);
  if (s.trim() === "") return null;
  if (s.startsWith("#")) {
    const code = Object.values(ERREURS).find((c) => c === s || c.replace(/[!?]$/, "") === s);
    if (code) return err(code);
  }
  const haut = s.trim().toUpperCase();
  if (haut === "VRAI" || haut === "TRUE") return true;
  if (haut === "FAUX" || haut === "FALSE") return false;
  if (ISO.test(s.trim())) return new DateV(serieDepuisTexte(s.trim()));
  const n = lireNombre(s);
  return n === null ? s : n;
};

const nombreEnTexte = (n) => {
  const arrondi = Math.round(n * 1e10) / 1e10;
  return String(arrondi).replace(".", ",");
};

const pad2 = (n) => String(n).padStart(2, "0");
const dateEnTexte = (serie) => {
  const d = dateDepuisSerie(serie);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};

// ---- Conversions -----------------------------------------------------------

/// La valeur d'une plage réduite à une cellule (intersection implicite).
const unique = (v) => {
  // Un argument laissé vide (=SI(A1;;1)) vaut une cellule vide.
  if (v === VIDE) return null;
  if (!(v instanceof Plage)) return v;
  if (v.lignes === 1 && v.colonnes === 1) return v.valeurs[0][0];
  return err(ERREURS.VALEUR);
};

const enNombre = (v) => {
  const x = unique(v);
  if (estErreur(x)) return x;
  if (x === null) return 0;
  if (typeof x === "number") return x;
  if (typeof x === "boolean") return x ? 1 : 0;
  if (x instanceof DateV) return x.n;
  const n = lireNombre(x);
  if (n !== null) return n;
  const serie = serieDepuisTexte(String(x).trim());
  return serie === null ? err(ERREURS.VALEUR) : serie;
};

const nombre = (v) => verifier(enNombre(v));

const texte = (v) => {
  const x = verifier(unique(v));
  if (x === null) return "";
  if (typeof x === "number") return nombreEnTexte(x);
  if (typeof x === "boolean") return x ? "VRAI" : "FAUX";
  if (x instanceof DateV) return dateEnTexte(x.n);
  return String(x);
};

const booleen = (v) => {
  const x = verifier(unique(v));
  if (x === null) return false;
  if (typeof x === "boolean") return x;
  if (typeof x === "number") return x !== 0;
  if (x instanceof DateV) return x.n !== 0;
  const haut = String(x).trim().toUpperCase();
  if (haut === "VRAI" || haut === "TRUE") return true;
  if (haut === "FAUX" || haut === "FALSE") return false;
  return lever(err(ERREURS.VALEUR));
};

const serie = (v) => {
  const x = verifier(unique(v));
  if (x instanceof DateV) return x.n;
  return nombre(x);
};

/// Le résultat d'une formule, tel qu'il est rangé dans la cellule.
export const versSortie = (v) => {
  const x = unique(v);
  if (estErreur(x)) return x.code;
  if (x === null) return "0";
  if (typeof x === "number") {
    if (!Number.isFinite(x)) return ERREURS.NOMBRE;
    return String(Math.round(x * 1e10) / 1e10);
  }
  if (typeof x === "boolean") return x ? "VRAI" : "FAUX";
  if (x instanceof DateV) return isoDepuisSerie(x.n);
  return String(x);
};

// ---------------------------------------------------------------------------
// Découpage
// ---------------------------------------------------------------------------

const LETTRE = /[A-Za-zÀ-ÿ_]/;
const CAR_NOM = /[A-Za-z0-9À-ÿ_.$]/;

/// La formule est « française » si un point-virgule sépare des arguments
/// (hors texte) : la virgule y est alors décimale.
const estFrancaise = (src) => {
  let dansTexte = false;
  for (const c of src) {
    if (c === '"') dansTexte = !dansTexte;
    else if (c === ";" && !dansTexte) return true;
  }
  return false;
};

const tokeniser = (src) => {
  const francaise = estFrancaise(src);
  const jetons = [];
  // La pile des parenthèses : « f » pour celles d'une fonction, « p » pour
  // un simple groupement. Une virgule dans une fonction anglaise sépare des
  // arguments ; ailleurs, elle ne peut être que décimale.
  const pile = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\n" || c === "\t") { i += 1; continue; }

    if (c === '"') {
      let s = "";
      i += 1;
      for (;;) {
        if (i >= src.length) throw new SyntaxError("Texte non fermé");
        if (src[i] === '"') {
          if (src[i + 1] === '"') { s += '"'; i += 2; continue; }
          i += 1;
          break;
        }
        s += src[i];
        i += 1;
      }
      jetons.push({ t: "texte", v: s });
      continue;
    }

    // Nom de feuille entre apostrophes : 'Mes ventes'!A1
    if (c === "'") {
      let s = "";
      i += 1;
      for (;;) {
        if (i >= src.length) throw new SyntaxError("Nom de feuille non fermé");
        if (src[i] === "'") {
          if (src[i + 1] === "'") { s += "'"; i += 2; continue; }
          i += 1;
          break;
        }
        s += src[i];
        i += 1;
      }
      if (src[i] !== "!") throw new SyntaxError("« ! » attendu après le nom de feuille");
      i += 1;
      jetons.push({ t: "feuille", v: s });
      continue;
    }

    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      let n = "";
      while (i < src.length && /[0-9]/.test(src[i])) n += src[i++];
      const virguleDecimale = src[i] === "," && /[0-9]/.test(src[i + 1] || "")
        && (francaise || !pile.includes("f"));
      if (src[i] === "." || virguleDecimale) {
        n += ".";
        i += 1;
        while (i < src.length && /[0-9]/.test(src[i])) n += src[i++];
      }
      if (/[eE]/.test(src[i] || "") && /[-+0-9]/.test(src[i + 1] || "")) {
        n += src[i++];
        if (/[-+]/.test(src[i])) n += src[i++];
        while (i < src.length && /[0-9]/.test(src[i])) n += src[i++];
      }
      // « 1:1 » serait une plage de lignes : non prise en charge.
      jetons.push({ t: "nombre", v: Number(n) });
      continue;
    }

    if (LETTRE.test(c) || c === "$") {
      let m = "";
      while (i < src.length && CAR_NOM.test(src[i])) m += src[i++];
      if (src[i] === "!") {
        i += 1;
        jetons.push({ t: "feuille", v: m });
        continue;
      }
      // Les préfixes d'Excel pour ses fonctions récentes (_xlfn.XLOOKUP).
      const nom = m.replace(/^_xl(fn|ws)\./i, "");
      if (src[i] === "(") {
        jetons.push({ t: "fonction", v: nom.toUpperCase() });
        continue;
      }
      jetons.push({ t: "nom", v: nom });
      continue;
    }

    if (c === "(") {
      pile.push(jetons[jetons.length - 1]?.t === "fonction" ? "f" : "p");
      jetons.push({ t: "(" });
      i += 1;
      continue;
    }
    if (c === ")") { pile.pop(); jetons.push({ t: ")" }); i += 1; continue; }

    const deux = src.slice(i, i + 2);
    if (deux === "<>" || deux === "<=" || deux === ">=") { jetons.push({ t: "op", v: deux }); i += 2; continue; }
    if ("+-*/^&=<>%".includes(c)) { jetons.push({ t: "op", v: c }); i += 1; continue; }
    if (c === ";" || c === ",") { jetons.push({ t: "sep" }); i += 1; continue; }
    if (c === ":") { jetons.push({ t: ":" }); i += 1; continue; }
    if (c === "#") {
      // Une erreur écrite en dur : =SI(A1="";#N/A;A1)
      const m = /^#(N\/A|NA|DIV\/0!?|VALEUR!?|VALUE!?|REF!?|NOM\?|NAME\?|NOMBRE!?|NUM!?)/i.exec(src.slice(i));
      if (m) {
        const code = m[0].toUpperCase();
        const table = {
          "#N/A": ERREURS.NA, "#NA": ERREURS.NA, "#DIV/0": ERREURS.DIV0, "#DIV/0!": ERREURS.DIV0,
          "#VALEUR": ERREURS.VALEUR, "#VALEUR!": ERREURS.VALEUR, "#VALUE": ERREURS.VALEUR, "#VALUE!": ERREURS.VALEUR,
          "#REF": ERREURS.REF, "#REF!": ERREURS.REF, "#NOM?": ERREURS.NOM, "#NAME?": ERREURS.NOM,
          "#NOMBRE": ERREURS.NOMBRE, "#NOMBRE!": ERREURS.NOMBRE, "#NUM": ERREURS.NOMBRE, "#NUM!": ERREURS.NOMBRE,
        };
        jetons.push({ t: "erreur", v: table[code] || ERREURS.NA });
        i += m[0].length;
        continue;
      }
    }
    throw new SyntaxError(`Caractère inattendu : ${c}`);
  }
  return { jetons, francaise };
};

// ---------------------------------------------------------------------------
// Analyse : la formule devient un arbre
// ---------------------------------------------------------------------------

const REF_CELLULE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
const REF_COLONNE = /^(\$?)([A-Za-z]{1,3})$/;

const indexColonne = (lettres) => {
  let c = 0;
  for (const car of lettres.toUpperCase()) c = c * 26 + (car.charCodeAt(0) - 64);
  return c - 1;
};

export const lettresColonne = (index) => {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

const lireRef = (texteRef) => {
  const m = REF_CELLULE.exec(texteRef);
  if (m) {
    return { l: Number(m[4]) - 1, c: indexColonne(m[2]), absC: !!m[1], absL: !!m[3] };
  }
  const col = REF_COLONNE.exec(texteRef);
  if (col) return { l: null, c: indexColonne(col[2]), absC: !!col[1], absL: false };
  return null;
};

// Priorités, de la plus faible à la plus forte (celles d'Excel).
const PRIORITES = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

export const analyser = (source) => {
  const src = String(source ?? "").trim().replace(/^=/, "");
  const { jetons, francaise } = tokeniser(src);
  let p = 0;
  const voir = () => jetons[p];
  const manger = (t) => {
    if (jetons[p]?.t !== t) throw new SyntaxError(`« ${t} » attendu`);
    return jetons[p++];
  };

  const binaire = (minimum) => {
    let g = unaire();
    for (;;) {
      const j = voir();
      if (!j || j.t !== "op" || !(j.v in PRIORITES) || PRIORITES[j.v] < minimum) break;
      p += 1;
      const d = binaire(PRIORITES[j.v] + 1);
      g = { k: "bin", op: j.v, g, d };
    }
    return g;
  };

  const unaire = () => {
    const j = voir();
    if (j?.t === "op" && (j.v === "-" || j.v === "+")) {
      p += 1;
      return { k: "un", op: j.v, x: unaire() };
    }
    return postfixe(primaire());
  };

  const postfixe = (x) => {
    let n = x;
    while (voir()?.t === "op" && voir().v === "%") { p += 1; n = { k: "pct", x: n }; }
    return n;
  };

  const reference = (feuille) => {
    const j = manger("nom");
    const a = lireRef(j.v);
    if (!a) {
      if (feuille) throw new SyntaxError(`Référence invalide : ${j.v}`);
      return null;
    }
    if (voir()?.t === ":") {
      p += 1;
      const jb = voir();
      if (jb?.t !== "nom" && jb?.t !== "nombre") throw new SyntaxError("Plage invalide");
      p += 1;
      const b = lireRef(String(jb.v));
      if (!b || (a.l === null) !== (b.l === null)) throw new SyntaxError("Plage invalide");
      return { k: "plage", feuille, a, b };
    }
    if (a.l === null) throw new SyntaxError(`Référence incomplète : ${j.v}`);
    return { k: "ref", feuille, ...a };
  };

  const primaire = () => {
    const j = voir();
    if (!j) throw new SyntaxError("Formule incomplète");
    if (j.t === "nombre") { p += 1; return { k: "num", v: j.v }; }
    if (j.t === "texte") { p += 1; return { k: "txt", v: j.v }; }
    if (j.t === "erreur") { p += 1; return { k: "err", v: j.v }; }
    if (j.t === "(") {
      p += 1;
      const x = binaire(1);
      manger(")");
      return { k: "paren", x };
    }
    if (j.t === "feuille") {
      p += 1;
      return reference(j.v);
    }
    if (j.t === "fonction") {
      p += 1;
      manger("(");
      const args = [];
      if (voir()?.t !== ")") {
        for (;;) {
          // Un argument laissé vide : =RECHERCHEV(A1;B:C;2;)
          if (voir()?.t === "sep" || voir()?.t === ")") args.push({ k: "vide" });
          else args.push(binaire(1));
          if (voir()?.t === "sep") { p += 1; continue; }
          break;
        }
      }
      manger(")");
      return { k: "fn", nom: j.v, args };
    }
    if (j.t === "nom") {
      const haut = j.v.toUpperCase();
      if (haut === "VRAI" || haut === "TRUE") { p += 1; return { k: "bool", v: true }; }
      if (haut === "FAUX" || haut === "FALSE") { p += 1; return { k: "bool", v: false }; }
      const r = reference(null);
      if (r) return r;
      throw new SyntaxError(`Nom inconnu : ${j.v}`);
    }
    throw new SyntaxError("Formule invalide");
  };

  const arbre = binaire(1);
  if (p < jetons.length) throw new SyntaxError("Formule invalide");
  return { arbre, francaise };
};

// ---------------------------------------------------------------------------
// Fonctions
// ---------------------------------------------------------------------------

/// Les noms anglais d'Excel, vers les noms français du moteur.
const ANGLAIS = {
  SUM: "SOMME", AVERAGE: "MOYENNE", AVG: "MOYENNE", COUNT: "NB", COUNTA: "NBVAL", COUNTBLANK: "NB.VIDE",
  MEDIAN: "MEDIANE", STDEV: "ECARTYPE", "STDEV.S": "ECARTYPE", PRODUCT: "PRODUIT", SUMPRODUCT: "SOMMEPROD",
  ROUND: "ARRONDI", ROUNDUP: "ARRONDI.SUP", ROUNDDOWN: "ARRONDI.INF", INT: "ENT", TRUNC: "TRONQUE",
  FLOOR: "PLANCHER", CEILING: "PLAFOND", CEIL: "PLAFOND", SQRT: "RACINE", POWER: "PUISSANCE", SIGN: "SIGNE",
  SUMIF: "SOMME.SI", SUMIFS: "SOMME.SI.ENS", COUNTIF: "NB.SI", COUNTIFS: "NB.SI.ENS",
  AVERAGEIF: "MOYENNE.SI", AVERAGEIFS: "MOYENNE.SI.ENS", MAXIFS: "MAX.SI.ENS", MINIFS: "MIN.SI.ENS",
  IF: "SI", IFS: "SI.CONDITIONS", AND: "ET", OR: "OU", NOT: "NON", IFERROR: "SIERREUR", IFNA: "SI.NON.DISP",
  TRUE: "VRAI", FALSE: "FAUX", ISBLANK: "ESTVIDE", ISNUMBER: "ESTNUM", ISTEXT: "ESTTEXTE",
  ISERROR: "ESTERREUR", ISNA: "ESTNA", ISLOGICAL: "ESTLOGIQUE", CHOOSE: "CHOISIR",
  VLOOKUP: "RECHERCHEV", HLOOKUP: "RECHERCHEH", XLOOKUP: "RECHERCHEX", MATCH: "EQUIV",
  CONCATENATE: "CONCATENER", TEXTJOIN: "JOINDRE.TEXTE", LEFT: "GAUCHE", RIGHT: "DROITE", MID: "STXT",
  LEN: "NBCAR", UPPER: "MAJUSCULE", LOWER: "MINUSCULE", PROPER: "NOMPROPRE", TRIM: "SUPPRESPACE",
  SUBSTITUTE: "SUBSTITUE", FIND: "TROUVE", SEARCH: "CHERCHE", TEXT: "TEXTE", VALUE: "CNUM", REPT: "REPT",
  TODAY: "AUJOURDHUI", NOW: "MAINTENANT", YEAR: "ANNEE", MONTH: "MOIS", DAY: "JOUR", WEEKDAY: "JOURSEM",
  EOMONTH: "FIN.MOIS", EDATE: "MOIS.DECALER", DAYS: "JOURS", NETWORKDAYS: "NB.JOURS.OUVRES",
  WORKDAY: "SERIE.JOUR.OUVRE",
  DISCOUNT: "REMISE", PERCENT: "POURCENT", VAT: "TVA", NET: "HT", GROSS: "TTC",
};

/// Variantes françaises sans point ou sans accent, telles qu'on les tape.
const VARIANTES = {
  "ANNÉE": "ANNEE", "MÉDIANE": "MEDIANE", "ÉCARTYPE": "ECARTYPE",
  "ECARTYPE.STANDARD": "ECARTYPE", "ÉCARTYPE.STANDARD": "ECARTYPE", CONCATENER: "CONCATENER",
  "CONCATÉNER": "CONCATENER", "SI.ERREUR": "SIERREUR", "NB.JOURS.OUVRÉS": "NB.JOURS.OUVRES",
  "SÉRIE.JOUR.OUVRÉ": "SERIE.JOUR.OUVRE", "ÉQUIV": "EQUIV", "MOIS.DÉCALER": "MOIS.DECALER",
};

const nomCanonique = (nom) => {
  const haut = nom.toUpperCase();
  return VARIANTES[haut] || ANGLAIS[haut] || haut;
};

// ---- Outils des fonctions ---------------------------------------------------

/// Les nombres d'une liste d'arguments, à la manière d'Excel : dans une
/// plage, seuls les nombres (et les dates) comptent ; en argument direct,
/// un texte numérique ou un booléen compte aussi.
const nombresDe = (args) => {
  const out = [];
  for (const a of args) {
    if (a instanceof Plage) {
      for (const v of a.aplatie()) {
        if (estErreur(v)) lever(v);
        if (typeof v === "number") out.push(v);
        else if (v instanceof DateV) out.push(v.n);
      }
    } else if (a !== undefined && a !== VIDE) {
      out.push(nombre(a));
    }
  }
  return out;
};

const VIDE = Symbol("vide");
const arg = (a, defaut) => (a === undefined || a === VIDE ? defaut : a);

const plageDe = (v) => {
  if (v instanceof Plage) return v;
  if (estErreur(v)) lever(v);
  return new Plage([[v]]);
};

/// Égalité « à la Excel » : texte sans casse, nombres et dates par valeur.
const comparer = (a, b) => {
  const x = a instanceof DateV ? a.n : a;
  const y = b instanceof DateV ? b.n : b;
  const rang = (v) => (v === null ? -1 : typeof v === "number" ? 0 : typeof v === "string" ? 1 : 2);
  // Une cellule vide vaut 0 face à un nombre, "" face à un texte.
  let g = x;
  let d = y;
  if (g === null) g = typeof d === "string" ? "" : typeof d === "boolean" ? false : 0;
  if (d === null) d = typeof g === "string" ? "" : typeof g === "boolean" ? false : 0;
  const rg = rang(g);
  const rd = rang(d);
  if (rg !== rd) return rg < rd ? -1 : 1;
  if (typeof g === "string") {
    const a2 = g.toLocaleLowerCase("fr");
    const b2 = d.toLocaleLowerCase("fr");
    return a2 === b2 ? 0 : a2 < b2 ? -1 : 1;
  }
  if (g === d) return 0;
  return g < d ? -1 : 1;
};

/// Un motif à jokers (* et ?) en expression régulière, sans casse.
const motif = (texteMotif) => {
  let re = "";
  for (let i = 0; i < texteMotif.length; i += 1) {
    const c = texteMotif[i];
    if (c === "~" && i + 1 < texteMotif.length) { re += texteMotif[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is");
};

/// Un critère de SOMME.SI, NB.SI… : « >10 », « <>Payé », « Ab* », 5, "".
const critere = (brut) => {
  const c = unique(brut);
  if (estErreur(c)) lever(c);
  if (c === null) return (v) => v === null || v === "";
  if (typeof c !== "string") return (v) => !estErreur(v) && v !== null && comparer(v, c) === 0;

  const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(c);
  const op = m[1] || "=";
  const operande = m[2];
  if (operande === "") {
    if (op === "=") return (v) => v === null || v === "";
    if (op === "<>") return (v) => !(v === null || v === "");
  }
  const n = lireNombre(operande);
  const s = n === null ? serieDepuisTexte(operande.trim()) : null;
  const valeur = n !== null ? n : s !== null ? s : null;
  if (valeur !== null) {
    return (v) => {
      const x = v instanceof DateV ? v.n : typeof v === "number" ? v : typeof v === "string" ? lireNombre(v) : null;
      if (x === null || estErreur(v)) return op === "<>";
      switch (op) {
        case "=": return x === valeur;
        case "<>": return x !== valeur;
        case "<": return x < valeur;
        case ">": return x > valeur;
        case "<=": return x <= valeur;
        default: return x >= valeur;
      }
    };
  }
  const re = /[*?]/.test(operande) ? motif(operande) : null;
  return (v) => {
    if (estErreur(v)) return false;
    const t = v === null ? "" : typeof v === "boolean" ? (v ? "VRAI" : "FAUX") : v instanceof DateV ? dateEnTexte(v.n) : typeof v === "number" ? nombreEnTexte(v) : String(v);
    if (op === "=") return re ? re.test(t) : t.toLocaleLowerCase("fr") === operande.toLocaleLowerCase("fr");
    if (op === "<>") return re ? !re.test(t) : t.toLocaleLowerCase("fr") !== operande.toLocaleLowerCase("fr");
    if (typeof v !== "string") return false;
    const r = comparer(v, operande);
    return op === "<" ? r < 0 : op === ">" ? r > 0 : op === "<=" ? r <= 0 : r >= 0;
  };
};

/// Les positions (index aplatis) qui satisfont toutes les paires
/// plage/critère des fonctions .ENS.
const correspondances = (paires) => {
  const plages = [];
  for (let i = 0; i < paires.length; i += 2) {
    plages.push({ valeurs: plageDe(paires[i]).aplatie(), test: critere(paires[i + 1]) });
  }
  const taille = plages[0]?.valeurs.length || 0;
  if (plages.some((x) => x.valeurs.length !== taille)) lever(err(ERREURS.VALEUR));
  const ok = [];
  for (let k = 0; k < taille; k += 1) {
    if (plages.every((x) => x.test(x.valeurs[k]))) ok.push(k);
  }
  return ok;
};

const valeursNumeriquesAux = (plage, positions) => {
  const valeurs = plageDe(plage).aplatie();
  const out = [];
  for (const k of positions) {
    const v = valeurs[k];
    if (estErreur(v)) lever(v);
    if (typeof v === "number") out.push(v);
    else if (v instanceof DateV) out.push(v.n);
  }
  return out;
};

const somme = (v) => v.reduce((s, n) => s + n, 0);

/// Recherche d'une valeur dans une liste : exacte (avec jokers pour le
/// texte) ou approchée (la plus grande valeur inférieure ou égale, sur une
/// liste triée — le comportement par défaut de RECHERCHEV).
const chercherIndex = (liste, cherchee, mode) => {
  if (mode === 0) {
    const re = typeof cherchee === "string" && /[*?]/.test(cherchee) ? motif(cherchee) : null;
    return liste.findIndex((v) => !estErreur(v) && (re ? typeof v === "string" && re.test(v) : comparer(v, cherchee) === 0));
  }
  if (mode === 1) {
    let trouve = -1;
    for (let i = 0; i < liste.length; i += 1) {
      const v = liste[i];
      if (estErreur(v) || v === null) continue;
      const r = comparer(v, cherchee);
      if (r <= 0) trouve = i;
      else break;
    }
    return trouve;
  }
  // -1 : la plus petite valeur supérieure ou égale (liste décroissante).
  let trouve = -1;
  for (let i = 0; i < liste.length; i += 1) {
    const v = liste[i];
    if (estErreur(v) || v === null) continue;
    if (comparer(v, cherchee) >= 0) trouve = i;
    else break;
  }
  return trouve;
};

const JOURS_NOMS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS_NOMS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/// TEXTE(valeur ; format) — les formats qu'on écrit vraiment : dates
/// (jj/mm/aaaa, mmmm aaaa…) et nombres (0, 0,00, # ##0, 0 %).
const formaterTexte = (v, format) => {
  const f = String(format);
  if (/[jdy]|aa|m{3,}/i.test(f) && !/^[#0 ,.%]+$/.test(f)) {
    const n = serie(v);
    const d = dateDepuisSerie(n);
    const jour = d.getUTCDate();
    const mois = d.getUTCMonth();
    const annee = d.getUTCFullYear();
    const jourSem = d.getUTCDay();
    return f.replace(/jjjj|dddd|jjj|ddd|jj|dd|j|d|mmmm|mmm|mm|m|aaaa|yyyy|aa|yy/gi, (t) => {
      switch (t.toLowerCase()) {
        case "jjjj": case "dddd": return JOURS_NOMS[jourSem];
        case "jjj": case "ddd": return JOURS_NOMS[jourSem].slice(0, 3) + ".";
        case "jj": case "dd": return pad2(jour);
        case "j": case "d": return String(jour);
        case "mmmm": return MOIS_NOMS[mois];
        case "mmm": return MOIS_NOMS[mois].slice(0, 4).replace(/\.?$/, ".");
        case "mm": return pad2(mois + 1);
        case "m": return String(mois + 1);
        case "aaaa": case "yyyy": return String(annee);
        default: return String(annee).slice(2);
      }
    });
  }
  let n = nombre(v);
  const pourcent = f.trim().endsWith("%");
  if (pourcent) n *= 100;
  const corps = f.replace(/%/g, "").trim();
  const dec = /[.,](0+)\s*$/.exec(corps);
  const decimales = dec ? dec[1].length : 0;
  const groupes = /#[\s  ,]#/.test(corps) || /#[\s  ]##0/.test(corps) || /#,##0/.test(corps);
  const sortie = n.toLocaleString("fr-FR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
    useGrouping: groupes,
  }).replace(/ /g, " ");
  return pourcent ? `${sortie} %` : sortie;
};

const ouvres = (debut, fin, feries) => {
  const jours = new Set(feries);
  let n = 0;
  const pas = debut <= fin ? 1 : -1;
  for (let s = debut; pas > 0 ? s <= fin : s >= fin; s += pas) {
    const j = dateDepuisSerie(s).getUTCDay();
    if (j !== 0 && j !== 6 && !jours.has(s)) n += 1;
  }
  return n * pas;
};

const feriesDe = (v) => (v === undefined || v === VIDE ? [] : plageDe(v).aplatie().filter((x) => x !== null).map((x) => serie(x)));

const decalerMois = (n, mois, finDeMois) => {
  const d = dateDepuisSerie(n);
  const cible = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + mois + 1, 0));
  if (finDeMois) return (cible.getTime() - EPOQUE) / JOUR_MS;
  const jour = Math.min(d.getUTCDate(), cible.getUTCDate());
  return serieDepuis(cible.getUTCFullYear(), cible.getUTCMonth() + 1, jour);
};

const aujourdhui = () => {
  const d = new Date();
  return serieDepuis(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

/// Les fonctions ordinaires : elles reçoivent leurs arguments déjà
/// évalués (plages comprises) et rendent une valeur.
const FONCTIONS = {
  // ---- Agrégats
  SOMME: (a) => somme(nombresDe(a)),
  MOYENNE: (a) => { const v = nombresDe(a); return v.length ? somme(v) / v.length : err(ERREURS.DIV0); },
  MIN: (a) => { const v = nombresDe(a); return v.length ? Math.min(...v) : 0; },
  MAX: (a) => { const v = nombresDe(a); return v.length ? Math.max(...v) : 0; },
  NB: (a) => a.reduce((n, x) => n + (x instanceof Plage
    ? x.aplatie().filter((v) => typeof v === "number" || v instanceof DateV).length
    : (typeof unique(x) === "number" || lireNombre(unique(x)) !== null ? 1 : 0)), 0),
  NBVAL: (a) => a.reduce((n, x) => n + (x instanceof Plage ? x.aplatie().filter((v) => v !== null && v !== "").length : x === VIDE ? 0 : 1), 0),
  "NB.VIDE": (a) => plageDe(a[0]).aplatie().filter((v) => v === null || v === "").length,
  MEDIANE: (a) => {
    const t = nombresDe(a).sort((x, y) => x - y);
    if (!t.length) return err(ERREURS.NOMBRE);
    const m = Math.floor(t.length / 2);
    return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
  },
  ECARTYPE: (a) => {
    const v = nombresDe(a);
    if (v.length < 2) return err(ERREURS.DIV0);
    const m = somme(v) / v.length;
    return Math.sqrt(somme(v.map((n) => (n - m) ** 2)) / (v.length - 1));
  },
  PRODUIT: (a) => nombresDe(a).reduce((p, n) => p * n, 1),
  SOMMEPROD: (a) => {
    const plages = a.map((x) => plageDe(x).aplatie());
    const taille = plages[0]?.length || 0;
    if (plages.some((p) => p.length !== taille)) return err(ERREURS.VALEUR);
    let s = 0;
    for (let k = 0; k < taille; k += 1) {
      let produit = 1;
      for (const p of plages) {
        const v = p[k];
        if (estErreur(v)) return v;
        produit *= typeof v === "number" ? v : v instanceof DateV ? v.n : 0;
      }
      s += produit;
    }
    return s;
  },

  // ---- Agrégats conditionnels
  "SOMME.SI": (a) => {
    const plage = plageDe(a[0]).aplatie();
    const test = critere(a[1]);
    const cible = a[2] === undefined || a[2] === VIDE ? plageDe(a[0]) : plageDe(a[2]);
    const positions = plage.map((v, k) => (test(v) ? k : -1)).filter((k) => k >= 0);
    return somme(valeursNumeriquesAux(cible, positions));
  },
  "SOMME.SI.ENS": (a) => somme(valeursNumeriquesAux(a[0], correspondances(a.slice(1)))),
  "NB.SI": (a) => correspondances(a.slice(0, 2)).length,
  "NB.SI.ENS": (a) => correspondances(a).length,
  "MOYENNE.SI": (a) => {
    const plage = plageDe(a[0]).aplatie();
    const test = critere(a[1]);
    const cible = a[2] === undefined || a[2] === VIDE ? plageDe(a[0]) : plageDe(a[2]);
    const v = valeursNumeriquesAux(cible, plage.map((x, k) => (test(x) ? k : -1)).filter((k) => k >= 0));
    return v.length ? somme(v) / v.length : err(ERREURS.DIV0);
  },
  "MOYENNE.SI.ENS": (a) => {
    const v = valeursNumeriquesAux(a[0], correspondances(a.slice(1)));
    return v.length ? somme(v) / v.length : err(ERREURS.DIV0);
  },
  "MAX.SI.ENS": (a) => { const v = valeursNumeriquesAux(a[0], correspondances(a.slice(1))); return v.length ? Math.max(...v) : 0; },
  "MIN.SI.ENS": (a) => { const v = valeursNumeriquesAux(a[0], correspondances(a.slice(1))); return v.length ? Math.min(...v) : 0; },

  // ---- Arithmétique
  ABS: (a) => Math.abs(nombre(a[0])),
  ARRONDI: (a) => { const f = 10 ** nombre(arg(a[1], 0)); const n = nombre(a[0]); return Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9) / f; },
  "ARRONDI.SUP": (a) => { const f = 10 ** nombre(arg(a[1], 0)); const n = nombre(a[0]); return Math.sign(n) * Math.ceil(Math.abs(n) * f - 1e-9) / f; },
  "ARRONDI.INF": (a) => { const f = 10 ** nombre(arg(a[1], 0)); const n = nombre(a[0]); return Math.sign(n) * Math.floor(Math.abs(n) * f + 1e-9) / f; },
  ENT: (a) => Math.floor(nombre(a[0])),
  TRONQUE: (a) => { const f = 10 ** nombre(arg(a[1], 0)); return Math.trunc(nombre(a[0]) * f) / f; },
  PLANCHER: (a) => { const m = nombre(arg(a[1], 1)); return m === 0 ? 0 : Math.floor(nombre(a[0]) / m) * m; },
  PLAFOND: (a) => { const m = nombre(arg(a[1], 1)); return m === 0 ? 0 : Math.ceil(nombre(a[0]) / m) * m; },
  RACINE: (a) => { const n = nombre(a[0]); return n < 0 ? err(ERREURS.NOMBRE) : Math.sqrt(n); },
  PUISSANCE: (a) => nombre(a[0]) ** nombre(a[1]),
  MOD: (a) => {
    const n = nombre(a[0]);
    const d = nombre(a[1]);
    if (d === 0) return err(ERREURS.DIV0);
    return n - d * Math.floor(n / d);
  },
  SIGNE: (a) => Math.sign(nombre(a[0])),
  PI: () => Math.PI,

  // ---- Métier : la TVA et les remises sont le calcul quotidien ici.
  TVA: (a) => nombre(a[0]) * (nombre(arg(a[1], 18)) / 100),
  TTC: (a) => nombre(a[0]) * (1 + nombre(arg(a[1], 18)) / 100),
  HT: (a) => nombre(a[0]) / (1 + nombre(arg(a[1], 18)) / 100),
  REMISE: (a) => nombre(a[0]) * (1 - nombre(arg(a[1], 0)) / 100),
  POURCENT: (a) => { const d = nombre(a[1]); return d ? (nombre(a[0]) / d) * 100 : 0; },

  // ---- Logique
  ET: (a) => a.every((x) => (x instanceof Plage ? x.aplatie().filter((v) => v !== null).every((v) => booleen(v)) : booleen(x))),
  OU: (a) => a.some((x) => (x instanceof Plage ? x.aplatie().filter((v) => v !== null).some((v) => booleen(v)) : booleen(x))),
  NON: (a) => !booleen(a[0]),
  VRAI: () => true,
  FAUX: () => false,
  ESTVIDE: (a) => unique(a[0]) === null,
  ESTNUM: (a) => { const v = unique(a[0]); return typeof v === "number" || v instanceof DateV; },
  ESTTEXTE: (a) => typeof unique(a[0]) === "string",
  ESTLOGIQUE: (a) => typeof unique(a[0]) === "boolean",
  CHOISIR: (a) => {
    const i = Math.trunc(nombre(a[0]));
    if (i < 1 || i >= a.length) return err(ERREURS.VALEUR);
    return arg(a[i], null);
  },

  // ---- Recherche
  RECHERCHEV: (a) => {
    const p = plageDe(a[1]);
    const col = Math.trunc(nombre(a[2]));
    if (col < 1 || col > p.colonnes) return err(ERREURS.REF);
    const approchee = a[3] === undefined || a[3] === VIDE ? true : booleen(a[3]);
    const i = chercherIndex(p.valeurs.map((ligne) => ligne[0]), verifier(unique(a[0])), approchee ? 1 : 0);
    return i < 0 ? err(ERREURS.NA) : p.valeurs[i][col - 1];
  },
  RECHERCHEH: (a) => {
    const p = plageDe(a[1]);
    const ligne = Math.trunc(nombre(a[2]));
    if (ligne < 1 || ligne > p.lignes) return err(ERREURS.REF);
    const approchee = a[3] === undefined || a[3] === VIDE ? true : booleen(a[3]);
    const i = chercherIndex(p.valeurs[0] || [], verifier(unique(a[0])), approchee ? 1 : 0);
    return i < 0 ? err(ERREURS.NA) : p.valeurs[ligne - 1][i];
  },
  RECHERCHEX: (a) => {
    const recherche = plageDe(a[1]);
    const retour = plageDe(a[2]);
    const vertical = recherche.colonnes === 1;
    const liste = recherche.aplatie();
    const mode = Math.trunc(nombre(arg(a[4], 0)));
    const cherchee = verifier(unique(a[0]));
    let i;
    if (mode === 0 || mode === 2) i = chercherIndex(liste, cherchee, 0);
    else {
      // -1 : exacte ou immédiatement inférieure ; 1 : exacte ou supérieure.
      let meilleur = -1;
      for (let k = 0; k < liste.length; k += 1) {
        const v = liste[k];
        if (v === null || estErreur(v)) continue;
        const r = comparer(v, cherchee);
        if (r === 0) { meilleur = k; break; }
        if (mode === -1 && r < 0 && (meilleur < 0 || comparer(v, liste[meilleur]) > 0)) meilleur = k;
        if (mode === 1 && r > 0 && (meilleur < 0 || comparer(v, liste[meilleur]) < 0)) meilleur = k;
      }
      i = meilleur;
    }
    if (i < 0) return a[3] === undefined || a[3] === VIDE ? err(ERREURS.NA) : a[3];
    return vertical ? retour.valeurs[i]?.[0] ?? err(ERREURS.REF) : retour.valeurs[0]?.[i] ?? err(ERREURS.REF);
  },
  EQUIV: (a) => {
    const type = Math.trunc(nombre(arg(a[2], 1)));
    const i = chercherIndex(plageDe(a[1]).aplatie(), verifier(unique(a[0])), type === 0 ? 0 : type > 0 ? 1 : -1);
    return i < 0 ? err(ERREURS.NA) : i + 1;
  },
  INDEX: (a) => {
    const p = plageDe(a[0]);
    let l = Math.trunc(nombre(arg(a[1], 1)));
    let c = Math.trunc(nombre(arg(a[2], 1)));
    // Une plage d'une seule ligne s'indexe par la colonne.
    if (p.lignes === 1 && (a[2] === undefined || a[2] === VIDE)) { c = l; l = 1; }
    if (l < 1 || c < 1 || l > p.lignes || c > p.colonnes) return err(ERREURS.REF);
    return p.valeurs[l - 1][c - 1];
  },

  // ---- Texte
  CONCATENER: (a) => a.map((x) => texte(x)).join(""),
  CONCAT: (a) => a.map((x) => (x instanceof Plage ? x.aplatie().map(texte).join("") : texte(x))).join(""),
  "JOINDRE.TEXTE": (a) => {
    const sep = texte(a[0]);
    const ignorer = booleen(arg(a[1], true));
    const morceaux = [];
    for (const x of a.slice(2)) {
      const valeurs = x instanceof Plage ? x.aplatie() : [x];
      for (const v of valeurs) {
        const t = texte(v);
        if (!(ignorer && t === "")) morceaux.push(t);
      }
    }
    return morceaux.join(sep);
  },
  GAUCHE: (a) => texte(a[0]).slice(0, Math.max(0, nombre(arg(a[1], 1)))),
  DROITE: (a) => { const t = texte(a[0]); const n = Math.max(0, nombre(arg(a[1], 1))); return n ? t.slice(-n) : ""; },
  STXT: (a) => { const debut = nombre(a[1]); if (debut < 1) return err(ERREURS.VALEUR); return texte(a[0]).substr(debut - 1, Math.max(0, nombre(a[2]))); },
  NBCAR: (a) => texte(a[0]).length,
  MAJUSCULE: (a) => texte(a[0]).toLocaleUpperCase("fr"),
  MINUSCULE: (a) => texte(a[0]).toLocaleLowerCase("fr"),
  NOMPROPRE: (a) => texte(a[0]).toLocaleLowerCase("fr").replace(/(^|[^\p{L}])(\p{L})/gu, (_, avant, l) => avant + l.toLocaleUpperCase("fr")),
  SUPPRESPACE: (a) => texte(a[0]).replace(/ +/g, " ").trim(),
  SUBSTITUE: (a) => {
    const t = texte(a[0]);
    const ancien = texte(a[1]);
    const nouveau = texte(a[2]);
    if (!ancien) return t;
    if (a[3] === undefined || a[3] === VIDE) return t.split(ancien).join(nouveau);
    const n = Math.trunc(nombre(a[3]));
    let pos = -1;
    for (let k = 0; k < n; k += 1) { pos = t.indexOf(ancien, pos + 1); if (pos < 0) return t; }
    return t.slice(0, pos) + nouveau + t.slice(pos + ancien.length);
  },
  TROUVE: (a) => { const i = texte(a[1]).indexOf(texte(a[0]), nombre(arg(a[2], 1)) - 1); return i < 0 ? err(ERREURS.VALEUR) : i + 1; },
  CHERCHE: (a) => {
    const aiguille = texte(a[0]);
    const botte = texte(a[1]);
    const debut = nombre(arg(a[2], 1)) - 1;
    const re = new RegExp(motif(aiguille).source.replace(/^\^|\$$/g, ""), "is");
    const m = re.exec(botte.slice(debut));
    return m ? m.index + debut + 1 : err(ERREURS.VALEUR);
  },
  TEXTE: (a) => formaterTexte(a[0], texte(a[1])),
  CNUM: (a) => { const v = unique(a[0]); if (typeof v === "number") return v; const n = lireNombre(texte(v)); return n === null ? err(ERREURS.VALEUR) : n; },
  REPT: (a) => texte(a[0]).repeat(Math.max(0, Math.trunc(nombre(a[1])))),
  EXACT: (a) => texte(a[0]) === texte(a[1]),

  // ---- Dates
  AUJOURDHUI: () => new DateV(aujourdhui()),
  MAINTENANT: () => { const d = new Date(); return new DateV(aujourdhui() + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400); },
  DATE: (a) => {
    let annee = Math.trunc(nombre(a[0]));
    if (annee < 1900) annee += 1900;
    return new DateV((Date.UTC(annee, Math.trunc(nombre(a[1])) - 1, Math.trunc(nombre(a[2]))) - EPOQUE) / JOUR_MS);
  },
  ANNEE: (a) => dateDepuisSerie(serie(a[0])).getUTCFullYear(),
  MOIS: (a) => dateDepuisSerie(serie(a[0])).getUTCMonth() + 1,
  JOUR: (a) => dateDepuisSerie(serie(a[0])).getUTCDate(),
  JOURSEM: (a) => {
    const j = dateDepuisSerie(serie(a[0])).getUTCDay();
    const type = Math.trunc(nombre(arg(a[1], 1)));
    if (type === 2) return j === 0 ? 7 : j;
    if (type === 3) return j === 0 ? 6 : j - 1;
    return j + 1;
  },
  "FIN.MOIS": (a) => new DateV(decalerMois(serie(a[0]), Math.trunc(nombre(a[1])), true)),
  "MOIS.DECALER": (a) => new DateV(decalerMois(serie(a[0]), Math.trunc(nombre(a[1])), false)),
  JOURS: (a) => Math.floor(serie(a[0])) - Math.floor(serie(a[1])),
  DATEDIF: (a) => {
    const debut = Math.floor(serie(a[0]));
    const fin = Math.floor(serie(a[1]));
    if (debut > fin) return err(ERREURS.NOMBRE);
    const u = texte(a[2]).toUpperCase();
    const d1 = dateDepuisSerie(debut);
    const d2 = dateDepuisSerie(fin);
    let mois = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + d2.getUTCMonth() - d1.getUTCMonth();
    if (d2.getUTCDate() < d1.getUTCDate()) mois -= 1;
    if (u === "J" || u === "D") return fin - debut;
    if (u === "M") return mois;
    if (u === "A" || u === "Y") return Math.floor(mois / 12);
    if (u === "MJ" || u === "MD") {
      const repere = decalerMois(debut, mois, false);
      return fin - repere;
    }
    if (u === "AM" || u === "YM") return mois % 12;
    return err(ERREURS.NOMBRE);
  },
  "NB.JOURS.OUVRES": (a) => ouvres(Math.floor(serie(a[0])), Math.floor(serie(a[1])), feriesDe(a[2])),
  "SERIE.JOUR.OUVRE": (a) => {
    let s = Math.floor(serie(a[0]));
    let reste = Math.trunc(nombre(a[1]));
    const feries = new Set(feriesDe(a[2]));
    const pas = reste >= 0 ? 1 : -1;
    while (reste !== 0) {
      s += pas;
      const j = dateDepuisSerie(s).getUTCDay();
      if (j !== 0 && j !== 6 && !feries.has(s)) reste -= pas;
    }
    return new DateV(s);
  },
};

/// Les fonctions qui choisissent ce qu'elles évaluent : SI n'évalue que la
/// branche retenue, SIERREUR rattrape l'erreur de son premier argument.
const SPECIALES = {
  SI: (args, ev) => {
    const condition = booleen(ev(args[0]));
    if (condition) return args[1] ? ev(args[1]) : true;
    return args[2] ? ev(args[2]) : false;
  },
  "SI.CONDITIONS": (args, ev) => {
    for (let i = 0; i + 1 < args.length; i += 2) {
      if (booleen(ev(args[i]))) return ev(args[i + 1]);
    }
    return err(ERREURS.NA);
  },
  SIERREUR: (args, ev) => {
    try {
      const v = unique(ev(args[0]));
      if (estErreur(v)) return args[1] ? ev(args[1]) : "";
      return v;
    } catch (e) {
      if (e instanceof Interruption) return args[1] ? ev(args[1]) : "";
      throw e;
    }
  },
  "SI.NON.DISP": (args, ev) => {
    try {
      const v = unique(ev(args[0]));
      if (estErreur(v) && v.code === ERREURS.NA) return args[1] ? ev(args[1]) : "";
      return v;
    } catch (e) {
      if (e instanceof Interruption && e.erreur.code === ERREURS.NA) return args[1] ? ev(args[1]) : "";
      throw e;
    }
  },
  ESTERREUR: (args, ev) => {
    try { return estErreur(unique(ev(args[0]))); } catch (e) { if (e instanceof Interruption) return true; throw e; }
  },
  ESTNA: (args, ev) => {
    try {
      const v = unique(ev(args[0]));
      return estErreur(v) && v.code === ERREURS.NA;
    } catch (e) {
      if (e instanceof Interruption) return e.erreur.code === ERREURS.NA;
      throw e;
    }
  },
};

/// Tous les noms reconnus, français et anglais — pour l'aide à la saisie.
export const NOMS_FONCTIONS = [
  ...Object.keys(FONCTIONS),
  ...Object.keys(SPECIALES),
  ...Object.keys(ANGLAIS),
].sort();

// ---------------------------------------------------------------------------
// Évaluation
// ---------------------------------------------------------------------------

/// Évalue l'arbre d'une formule.
///
/// `contexte.cellule(feuille, l, c)` rend le contenu (calculé) d'une
/// cellule — `feuille` vaut null pour la feuille courante — et
/// `contexte.dimensions(feuille)` sa taille, pour les colonnes entières.
const evaluerArbre = (arbre, contexte) => {
  const lire = (feuille, l, c) => depuisCellule(contexte.cellule(feuille, l, c));

  const ev = (n) => {
    switch (n.k) {
      case "num": return n.v;
      case "txt": return n.v;
      case "bool": return n.v;
      case "err": return err(n.v);
      case "vide": return VIDE;
      case "paren": return ev(n.x);
      case "ref": return lire(n.feuille, n.l, n.c);
      case "plage": {
        const dims = contexte.dimensions?.(n.feuille) || { lignes: 0, colonnes: 0 };
        const l1 = n.a.l === null ? 0 : Math.min(n.a.l, n.b.l);
        const l2 = n.a.l === null ? Math.max(0, dims.lignes - 1) : Math.max(n.a.l, n.b.l);
        const c1 = Math.min(n.a.c, n.b.c);
        const c2 = Math.max(n.a.c, n.b.c);
        if ((l2 - l1 + 1) * (c2 - c1 + 1) > 2_000_000) return err(ERREURS.REF);
        const valeurs = [];
        for (let l = l1; l <= l2; l += 1) {
          const ligne = [];
          for (let c = c1; c <= c2; c += 1) ligne.push(lire(n.feuille, l, c));
          valeurs.push(ligne);
        }
        return new Plage(valeurs);
      }
      case "un": {
        const v = enNombre(ev(n.x));
        if (estErreur(v)) return v;
        return n.op === "-" ? -v : v;
      }
      case "pct": {
        const v = enNombre(ev(n.x));
        return estErreur(v) ? v : v / 100;
      }
      case "bin": return binaire(n.op, ev(n.g), ev(n.d));
      case "fn": {
        const nom = nomCanonique(n.nom);
        if (SPECIALES[nom]) return SPECIALES[nom](n.args, ev);
        const fn = FONCTIONS[nom];
        if (!fn) return err(ERREURS.NOM);
        const args = n.args.map((x) => ev(x));
        return fn(args);
      }
      default:
        return err(ERREURS.SYNTAXE);
    }
  };

  const binaire = (op, g0, d0) => {
    const g = unique(g0);
    const d = unique(d0);
    if (estErreur(g)) return g;
    if (estErreur(d)) return d;
    if (op === "&") return texte(g) + texte(d);
    if (op === "=" || op === "<>" || op === "<" || op === ">" || op === "<=" || op === ">=") {
      const r = comparer(g, d);
      switch (op) {
        case "=": return r === 0;
        case "<>": return r !== 0;
        case "<": return r < 0;
        case ">": return r > 0;
        case "<=": return r <= 0;
        default: return r >= 0;
      }
    }
    const a = enNombre(g);
    const b = enNombre(d);
    if (estErreur(a)) return a;
    if (estErreur(b)) return b;
    const dateG = g instanceof DateV || (typeof g === "string" && ISO.test(g.trim()));
    const dateD = d instanceof DateV || (typeof d === "string" && ISO.test(d.trim()));
    switch (op) {
      case "+": return dateG !== dateD ? new DateV(a + b) : a + b;
      case "-": return dateG && !dateD ? new DateV(a - b) : a - b;
      case "*": return a * b;
      case "/": return b === 0 ? err(ERREURS.DIV0) : a / b;
      case "^": return a ** b;
      default: return err(ERREURS.SYNTAXE);
    }
  };

  try {
    return ev(arbre);
  } catch (e) {
    if (e instanceof Interruption) return e.erreur;
    throw e;
  }
};

const CACHE_ARBRES = new Map();

const arbreDe = (source) => {
  let a = CACHE_ARBRES.get(source);
  if (a === undefined) {
    try {
      a = analyser(source).arbre;
    } catch {
      a = null;
    }
    if (CACHE_ARBRES.size > 5000) CACHE_ARBRES.clear();
    CACHE_ARBRES.set(source, a);
  }
  return a;
};

/// Calcule une formule et rend le résultat tel qu'on le range en cellule :
/// « 12 », « VRAI », « 2026-10-08 », « Payé », « #N/A »…
export const evaluerFormule = (source, contexte) => {
  const arbre = arbreDe(String(source ?? "").trim());
  if (!arbre) return ERREURS.SYNTAXE;
  try {
    return versSortie(evaluerArbre(arbre, contexte));
  } catch (e) {
    if (e?.marqueur) return e.marqueur;
    return ERREURS.SYNTAXE;
  }
};

/// La formule se lit-elle sans erreur de syntaxe ?
export const syntaxeValide = (source) => arbreDe(String(source ?? "").trim()) !== null;

// ---------------------------------------------------------------------------
// Traduction vers et depuis le fichier Excel
// ---------------------------------------------------------------------------
//
// Dans un .xlsx, une formule est toujours écrite à l'anglaise — noms
// anglais, virgules, point décimal — quelle que soit la langue d'Excel ;
// les fonctions récentes portent en plus le préfixe `_xlfn.`. C'est Excel
// qui l'affiche ensuite en français à un utilisateur français.

const FRANCAIS_VERS_ANGLAIS = Object.entries(ANGLAIS).reduce((acc, [en, fr]) => {
  if (!acc[fr] && !["AVG", "CEIL", "DISCOUNT", "PERCENT", "VAT", "NET", "GROSS", "STDEV.S"].includes(en)) acc[fr] = en;
  return acc;
}, {});

/// Les fonctions ajoutées à Excel après 2007 : le fichier les écrit avec
/// `_xlfn.`, faute de quoi Excel les affiche en #NOM?.
const XLFN = new Set(["IFS", "XLOOKUP", "CONCAT", "TEXTJOIN", "MAXIFS", "MINIFS", "IFNA", "DAYS"]);

const nomFeuilleExcel = (nom) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(nom) ? nom : `'${nom.replace(/'/g, "''")}'`);

const refEnTexte = (r) => `${r.absC ? "$" : ""}${lettresColonne(r.c)}${r.l === null ? "" : `${r.absL ? "$" : ""}${r.l + 1}`}`;

/// Réécrit un arbre en formule, à l'anglaise (`excel`) ou à la française.
const ecrire = (arbre, excel) => {
  const sep = excel ? "," : ";";
  const nombreTexte = (n) => (excel ? String(n) : String(n).replace(".", ","));
  const e = (n) => {
    switch (n.k) {
      case "num": return nombreTexte(n.v);
      case "txt": return `"${n.v.replace(/"/g, '""')}"`;
      case "bool": return excel ? (n.v ? "TRUE" : "FALSE") : (n.v ? "VRAI" : "FAUX");
      case "err": return n.v;
      case "vide": return "";
      case "paren": return `(${e(n.x)})`;
      case "ref": return `${n.feuille ? `${nomFeuilleExcel(n.feuille)}!` : ""}${refEnTexte(n)}`;
      case "plage": return `${n.feuille ? `${nomFeuilleExcel(n.feuille)}!` : ""}${refEnTexte(n.a)}:${refEnTexte(n.b)}`;
      case "un": return `${n.op}${e(n.x)}`;
      case "pct": return `${e(n.x)}%`;
      case "bin": return `${e(n.g)}${n.op}${e(n.d)}`;
      case "fn": {
        const canon = nomCanonique(n.nom);
        const args = n.args.map(e);
        if (!excel) return `${canon in FONCTIONS || canon in SPECIALES ? canon : n.nom}(${args.join(sep)})`;
        // Les fonctions métier n'existent pas dans Excel : on écrit le
        // calcul qu'elles font, pour que le fichier reste juste partout.
        const x = args[0] || "0";
        const taux = args[1] && args[1] !== "" ? args[1] : null;
        switch (canon) {
          case "TVA": return `((${x})*(${taux ?? "18"})/100)`;
          case "TTC": return `((${x})*(1+(${taux ?? "18"})/100))`;
          case "HT": return `((${x})/(1+(${taux ?? "18"})/100))`;
          case "REMISE": return `((${x})*(1-(${taux ?? "0"})/100))`;
          case "POURCENT": return `IF((${args[1] || "0"})=0,0,(${x})/(${args[1] || "0"})*100)`;
          default: {
            const en = FRANCAIS_VERS_ANGLAIS[canon] || canon;
            return `${XLFN.has(en) ? "_xlfn." : ""}${en}(${args.join(sep)})`;
          }
        }
      }
      default: return "";
    }
  };
  return e(arbre);
};

/// « =SOMME(A1:A3;1,5) » → « SUM(A1:A3,1.5) », sans le « = », comme dans
/// la balise <f> d'un .xlsx. Null si la formule ne se lit pas.
export const versExcel = (source) => {
  const arbre = arbreDe(String(source ?? "").trim());
  return arbre ? ecrire(arbre, true) : null;
};

/// « SUM(A1:A3,1.5) » lu dans un .xlsx → « =SOMME(A1:A3;1,5) ». Une
/// formule qu'on ne sait pas lire (référence structurée de tableau…) est
/// gardée telle quelle : le résultat mis en cache par Excel s'affichera.
export const depuisExcel = (formuleExcel) => {
  const source = `=${String(formuleExcel ?? "").trim()}`;
  try {
    // Lue à l'anglaise : un fichier Excel n'a jamais de virgule décimale.
    const src = source.slice(1);
    if (estFrancaise(src)) return source;
    return `=${ecrire(analyser(src).arbre, false)}`;
  } catch {
    return source;
  }
};
