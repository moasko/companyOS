// Analyse — le moteur, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE FAIT CE FICHIER
//
// Les autres modules savent chacun *leur* métier : la caisse encaisse, le
// stock déstocke, la paie calcule. Aucun ne sait répondre à « quels
// produits font 80 % de ma marge », « quels clients suis-je en train de
// perdre », « combien vais-je encaisser le mois prochain ».
//
// Ce fichier est cette couche-là : un moteur d'analyse générique qui prend
// des enregistrements bruts — ceux d'un module, d'une app Studio, ou d'un
// fichier importé — les **profile** (quels champs, de quel type), puis
// exécute dessus des requêtes et des analyses statistiques.
//
// Il ne connaît aucun module en particulier. Il connaît des colonnes.
// C'est ce qui lui permet d'analyser une application qui n'existait pas
// quand il a été écrit.
//
// Tout est pur : entrée → sortie, aucun appel réseau, aucun état. On peut
// donc l'éprouver ligne à ligne sans ouvrir un navigateur.
// ─────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// 1. Sources : où trouver des données dans l'OS
// ---------------------------------------------------------------------------

/// Le catalogue des jeux de données connus.
///
/// Il ne sert qu'à **nommer** et à donner du sens : la lecture, elle, passe
/// par `api.records.list(module, collection)` pour n'importe quel couple.
/// Une app Studio absente d'ici reste analysable — elle arrive par
/// introspection, avec ses propres champs.
///
/// `montant` et `date` désignent le champ à sommer et le champ à dater par
/// défaut : c'est ce qui permet d'ouvrir une source et d'avoir tout de
/// suite un graphique juste, sans rien régler.
export const SOURCES = [
  {
    id: "caisse.tickets",
    module: "caisse",
    collection: "tickets",
    nom: { fr: "Ventes (caisse)", en: "Sales (point of sale)" },
    famille: "ventes",
    montant: "ttc",
    date: "date",
    lignes: "lignes",
  },
  {
    id: "facturation.factures",
    module: "facturation",
    collection: "factures",
    nom: { fr: "Factures", en: "Invoices" },
    famille: "ventes",
    montant: null, // calculé depuis les lignes — voir `deriverChamps`
    date: "date",
    lignes: "lignes",
  },
  {
    id: "facturation.reglements",
    module: "facturation",
    collection: "reglements",
    nom: { fr: "Règlements reçus", en: "Payments received" },
    famille: "ventes",
    montant: "montant",
    date: "date",
  },
  {
    id: "stock.mouvements",
    module: "stock",
    collection: "mouvements",
    nom: { fr: "Mouvements de stock", en: "Stock movements" },
    famille: "stock",
    montant: "quantite",
    date: "date",
  },
  {
    id: "stock.articles",
    module: "stock",
    collection: "articles",
    nom: { fr: "Articles", en: "Items" },
    famille: "stock",
    montant: "prix",
    date: null,
  },
  {
    id: "achats.commandes",
    module: "achats",
    collection: "commandes",
    nom: { fr: "Commandes fournisseurs", en: "Purchase orders" },
    famille: "achats",
    montant: null,
    date: "date",
    lignes: "lignes",
  },
  {
    id: "achats.paiements",
    module: "achats",
    collection: "paiements",
    nom: { fr: "Paiements fournisseurs", en: "Supplier payments" },
    famille: "achats",
    montant: "montant",
    date: "date",
  },
  {
    id: "frais.notes",
    module: "frais",
    collection: "notes",
    nom: { fr: "Notes de frais", en: "Expense reports" },
    famille: "charges",
    montant: "montant",
    date: "date",
  },
  {
    id: "paie.bulletins",
    module: "paie",
    collection: "bulletins",
    nom: { fr: "Bulletins de paie", en: "Payslips" },
    famille: "charges",
    montant: "net",
    date: "mois",
  },
  {
    id: "crm.clients",
    module: "crm",
    collection: "clients",
    nom: { fr: "Clients", en: "Customers" },
    famille: "clients",
    montant: null,
    date: null,
  },
  {
    id: "crm.opportunites",
    module: "crm",
    collection: "opportunites",
    nom: { fr: "Opportunités", en: "Opportunities" },
    famille: "clients",
    montant: "montant",
    date: "dateCloture",
  },
  {
    id: "comptabilite.ecritures",
    module: "comptabilite",
    collection: "ecritures",
    nom: { fr: "Écritures comptables", en: "Journal entries" },
    famille: "comptabilite",
    montant: null,
    date: "date",
  },
  {
    id: "rh.salaries",
    module: "rh",
    collection: "salaries",
    nom: { fr: "Salariés", en: "Employees" },
    famille: "rh",
    montant: "salaireBase",
    date: "dateEmbauche",
  },
  {
    id: "rh.absences",
    module: "rh",
    collection: "absences",
    nom: { fr: "Absences et congés", en: "Absences and leave" },
    famille: "rh",
    montant: null,
    date: "du",
  },
  {
    id: "projets.cartes",
    module: "projets",
    collection: "cartes",
    nom: { fr: "Tâches de projet", en: "Project tasks" },
    famille: "projets",
    montant: null,
    date: "echeance",
  },
];

export const sourceParId = (id) => SOURCES.find((s) => s.id === id) || null;

// ---------------------------------------------------------------------------
// 2. Aplatissement et profilage — comprendre des données qu'on n'a pas écrites
// ---------------------------------------------------------------------------

const EST_DATE_ISO = /^\d{4}-\d{2}(-\d{2})?/;

/// Le type d'une valeur, du point de vue de l'analyse.
const typeDe = (v) => {
  if (v === null || v === undefined || v === "") return null; // sans opinion
  if (typeof v === "boolean") return "booleen";
  if (typeof v === "number" && Number.isFinite(v)) return "nombre";
  if (typeof v === "string") {
    if (EST_DATE_ISO.test(v)) return "date";
    // « 15000 » saisi dans un champ texte reste un nombre pour l'analyse :
    // les formulaires de l'OS rendent souvent des chaînes.
    if (v.trim() !== "" && Number.isFinite(Number(v))) return "nombre";
    return "texte";
  }
  return null; // objets, tableaux : pas une colonne analysable
};

/// Aplatit un enregistrement `{ id, data: {...}, auteur, createdAt }` en une
/// ligne plate. Les sous-objets d'un niveau sont dépliés en `parent.enfant`
/// — c'est ce qui rend analysable un champ imbriqué sans le connaître.
export const aplatir = (record) => {
  const ligne = { _id: record.id };
  if (record.createdAt) ligne._cree = String(record.createdAt).slice(0, 10);
  if (record.auteur?.name) ligne._auteur = record.auteur.name;

  const data = record.data || {};
  for (const [cle, val] of Object.entries(data)) {
    if (Array.isArray(val)) {
      // Un tableau ne devient pas une colonne : sa **longueur**, si.
      ligne[`${cle}.n`] = val.length;
      continue;
    }
    if (val && typeof val === "object") {
      for (const [k2, v2] of Object.entries(val)) {
        if (v2 === null || typeof v2 !== "object") ligne[`${cle}.${k2}`] = v2;
      }
      continue;
    }
    ligne[cle] = val;
  }
  return ligne;
};

/// Champs dérivés propres à certaines sources : un total qui n'est pas
/// stocké mais se recalcule depuis les lignes du document.
///
/// C'est le seul endroit du moteur qui connaisse une forme particulière —
/// et il échoue en silence sur une source qui ne l'a pas.
export const deriverChamps = (ligne, record, source) => {
  const lignes = source?.lignes ? record.data?.[source.lignes] : null;
  if (Array.isArray(lignes)) {
    let ht = 0;
    let ttc = 0;
    for (const l of lignes) {
      const brut = (Number(l.qte) || 0) * (Number(l.pu) || 0);
      const net = brut - brut * ((Number(l.remise) || 0) / 100);
      ht += net;
      ttc += net * (1 + (Number(l.tva) || 0) / 100);
    }
    const remise = Number(record.data?.remiseGlobale) || 0;
    const facteur = 1 - remise / 100;
    if (ligne["total.ht"] === undefined) ligne["total.ht"] = Math.round(ht * facteur);
    if (ligne["total.ttc"] === undefined) ligne["total.ttc"] = Math.round(ttc * facteur);
  }
  return ligne;
};

/// Transforme des enregistrements bruts en table analysable.
export const enTable = (records = [], source = null) =>
  records.map((r) => deriverChamps(aplatir(r), r, source));

/// Profil d'une colonne : son type dominant, son remplissage, sa
/// cardinalité, ses bornes. C'est ce qui permet à l'écran de proposer les
/// bons choix — sommer une date n'aurait pas de sens.
export const profilerChamp = (lignes, champ) => {
  const votes = { nombre: 0, date: 0, texte: 0, booleen: 0 };
  const distinctes = new Set();
  let remplies = 0;
  let min = null;
  let max = null;
  let somme = 0;

  for (const l of lignes) {
    const v = l[champ];
    const t = typeDe(v);
    if (!t) continue;
    remplies += 1;
    votes[t] += 1;
    if (distinctes.size < 1000) distinctes.add(String(v));
    if (t === "nombre") {
      const n = Number(v);
      somme += n;
      min = min === null || n < min ? n : min;
      max = max === null || n > max ? n : max;
    } else if (t === "date") {
      const s = String(v);
      min = min === null || s < min ? s : min;
      max = max === null || s > max ? s : max;
    }
  }

  const type =
    Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || "texte";
  return {
    champ,
    type: remplies ? type : "texte",
    remplies,
    total: lignes.length,
    remplissage: lignes.length ? remplies / lignes.length : 0,
    distinctes: distinctes.size,
    min,
    max,
    moyenne: votes.nombre ? somme / votes.nombre : null,
  };
};

/// Profil de toutes les colonnes d'une table.
///
/// Les colonnes techniques (`_id`) restent disponibles mais partent en fin
/// de liste : on ne groupe pas par identifiant unique par accident.
export const profiler = (lignes = []) => {
  const champs = new Set();
  for (const l of lignes) for (const k of Object.keys(l)) champs.add(k);
  return [...champs]
    .map((c) => profilerChamp(lignes, c))
    .sort((a, b) => {
      const tech = (p) => (p.champ.startsWith("_") ? 1 : 0);
      return tech(a) - tech(b) || b.remplissage - a.remplissage;
    });
};

/// Les colonnes utilisables comme mesure (à sommer, à moyenner).
export const mesuresPossibles = (profils) =>
  profils.filter((p) => p.type === "nombre" && p.remplies > 0);

/// Les colonnes utilisables comme dimension (pour grouper).
///
/// Une colonne dont **chaque** ligne a une valeur différente ne groupe
/// rien : elle est écartée au-delà de 200 valeurs distinctes.
export const dimensionsPossibles = (profils) =>
  profils.filter(
    (p) =>
      p.remplies > 0 &&
      (p.type === "texte" || p.type === "booleen" || p.type === "date") &&
      p.distinctes <= 200,
  );

export const datesPossibles = (profils) =>
  profils.filter((p) => p.type === "date" && p.remplies > 0);

// ---------------------------------------------------------------------------
// 3. Requête : filtrer → grouper → agréger
// ---------------------------------------------------------------------------

export const OPERATEURS = [
  "=",
  "≠",
  ">",
  "≥",
  "<",
  "≤",
  "contient",
  "commence par",
  "non vide",
];

const compare = (valeur, op, cible) => {
  const vide = valeur === null || valeur === undefined || valeur === "";
  if (op === "non vide") return !vide;
  if (vide) return false;

  const nA = Number(valeur);
  const nB = Number(cible);
  const numerique = Number.isFinite(nA) && Number.isFinite(nB) && cible !== "";

  switch (op) {
    case "=":
      return numerique ? nA === nB : String(valeur) === String(cible);
    case "≠":
      return numerique ? nA !== nB : String(valeur) !== String(cible);
    case ">":
      return numerique ? nA > nB : String(valeur) > String(cible);
    case "≥":
      return numerique ? nA >= nB : String(valeur) >= String(cible);
    case "<":
      return numerique ? nA < nB : String(valeur) < String(cible);
    case "≤":
      return numerique ? nA <= nB : String(valeur) <= String(cible);
    case "contient":
      return String(valeur).toLowerCase().includes(String(cible).toLowerCase());
    case "commence par":
      return String(valeur).toLowerCase().startsWith(String(cible).toLowerCase());
    default:
      return true;
  }
};

/// Applique une liste de filtres — tous doivent passer (ET).
export const filtrer = (lignes, filtres = []) =>
  filtres.length
    ? lignes.filter((l) =>
        filtres.every((f) => !f.champ || compare(l[f.champ], f.op, f.valeur)),
      )
    : lignes;

/// Restreint à une fenêtre de dates sur un champ donné (bornes incluses).
export const dansPeriode = (lignes, champDate, du, au) => {
  if (!champDate || (!du && !au)) return lignes;
  return lignes.filter((l) => {
    const v = l[champDate];
    if (!v) return false;
    const s = String(v).slice(0, 10);
    if (du && s < du) return false;
    if (au && s > au) return false;
    return true;
  });
};

export const GRANULARITES = ["jour", "semaine", "mois", "trimestre", "annee"];

/// Ramène une date ISO au début de sa période. Les semaines commencent le
/// lundi — c'est la semaine de travail ici comme ailleurs.
export const tronquerDate = (iso, granularite) => {
  const s = String(iso || "").slice(0, 10);
  if (s.length < 7) return s;
  const [a, m, j] = s.split("-");
  switch (granularite) {
    case "annee":
      return `${a}`;
    case "trimestre":
      return `${a}-T${Math.floor((Number(m) - 1) / 3) + 1}`;
    case "mois":
      return `${a}-${m}`;
    case "semaine": {
      const d = new Date(`${a}-${m}-${j || "01"}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) return s;
      const jour = (d.getUTCDay() + 6) % 7; // lundi = 0
      d.setUTCDate(d.getUTCDate() - jour);
      return d.toISOString().slice(0, 10);
    }
    default:
      return s;
  }
};

export const AGREGATS = [
  "somme",
  "moyenne",
  "compte",
  "compte distinct",
  "minimum",
  "maximum",
  "mediane",
];

const mediane = (nombres) => {
  if (!nombres.length) return 0;
  const t = [...nombres].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
};

const agreger = (valeurs, agregat) => {
  const nombres = valeurs
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  switch (agregat) {
    case "compte":
      return valeurs.length;
    case "compte distinct":
      return new Set(valeurs.map((v) => String(v))).size;
    case "moyenne":
      return nombres.length ? nombres.reduce((s, n) => s + n, 0) / nombres.length : 0;
    case "minimum":
      return nombres.length ? Math.min(...nombres) : 0;
    case "maximum":
      return nombres.length ? Math.max(...nombres) : 0;
    case "mediane":
      return mediane(nombres);
    default:
      return nombres.reduce((s, n) => s + n, 0);
  }
};

/// Le cœur : grouper puis agréger.
///
///   requete(lignes, {
///     dimension: "categorie", granularite: "mois",
///     mesure: "montant", agregat: "somme", tri: "valeur", limite: 10,
///   })
///
/// Rend `[{ cle, valeur, n }]`. Une dimension de type date est tronquée à
/// la granularité demandée et triée chronologiquement — un graphique de
/// série temporelle ne se trie pas par valeur.
export const requete = (lignes, options = {}) => {
  const {
    dimension,
    granularite = "mois",
    estDate = false,
    mesure,
    agregat = "somme",
    tri = "valeur",
    limite = 0,
    croissant = false,
  } = options;

  if (!dimension) {
    const valeurs = mesure ? lignes.map((l) => l[mesure]) : lignes.map(() => 1);
    return [{ cle: "", valeur: agreger(valeurs, agregat), n: lignes.length }];
  }

  const groupes = new Map();
  for (const l of lignes) {
    const brute = l[dimension];
    if (brute === null || brute === undefined || brute === "") continue;
    const cle = estDate ? tronquerDate(brute, granularite) : String(brute);
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(mesure ? l[mesure] : 1);
  }

  let resultat = [...groupes.entries()].map(([cle, valeurs]) => ({
    cle,
    valeur: agreger(valeurs, agregat),
    n: valeurs.length,
  }));

  if (estDate || tri === "cle") {
    resultat.sort((a, b) => (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0));
  } else {
    resultat.sort((a, b) => b.valeur - a.valeur);
    if (croissant) resultat.reverse();
  }

  // Le reste part dans « Autres » plutôt que d'être coupé en silence : un
  // total tronqué sans le dire est un graphique qui ment.
  if (limite > 0 && resultat.length > limite && !estDate) {
    const tete = resultat.slice(0, limite);
    const reste = resultat.slice(limite);
    const cumul = reste.reduce(
      (acc, r) => ({ valeur: acc.valeur + r.valeur, n: acc.n + r.n }),
      { valeur: 0, n: 0 },
    );
    tete.push({ cle: "__autres__", valeur: cumul.valeur, n: cumul.n, autres: reste.length });
    resultat = tete;
  }

  return resultat;
};

/// Tableau croisé : deux dimensions, une mesure.
export const croiser = (lignes, { ligne, colonne, mesure, agregat = "somme" }) => {
  const cles = new Map();
  const colonnes = new Set();

  for (const l of lignes) {
    const cl = l[ligne] ?? "—";
    const cc = l[colonne] ?? "—";
    colonnes.add(String(cc));
    const k = String(cl);
    if (!cles.has(k)) cles.set(k, new Map());
    const parCol = cles.get(k);
    const s = String(cc);
    if (!parCol.has(s)) parCol.set(s, []);
    parCol.get(s).push(mesure ? l[mesure] : 1);
  }

  const entetes = [...colonnes].sort();
  const corps = [...cles.entries()].map(([cle, parCol]) => ({
    cle,
    cellules: entetes.map((c) =>
      parCol.has(c) ? agreger(parCol.get(c), agregat) : null,
    ),
    total: agreger(
      [...parCol.values()].flat(),
      agregat === "compte distinct" ? "compte distinct" : agregat,
    ),
  }));
  corps.sort((a, b) => b.total - a.total);
  return { entetes, corps };
};

// ---------------------------------------------------------------------------
// 4. Statistiques descriptives
// ---------------------------------------------------------------------------

const quantile = (trie, p) => {
  if (!trie.length) return 0;
  const pos = (trie.length - 1) * p;
  const bas = Math.floor(pos);
  const haut = Math.ceil(pos);
  if (bas === haut) return trie[bas];
  return trie[bas] + (trie[haut] - trie[bas]) * (pos - bas);
};

/// Le portrait d'une série de nombres.
///
/// `ecartType` est l'écart-type **d'échantillon** (dénominateur n−1) : on
/// observe un échantillon de l'activité, pas la population entière.
export const decrire = (valeurs = []) => {
  const n = valeurs
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);

  if (!n.length) {
    return { n: 0, somme: 0, moyenne: 0, mediane: 0, ecartType: 0, min: 0, max: 0,
             q1: 0, q3: 0, iqr: 0, cv: 0, asymetrie: 0 };
  }

  const somme = n.reduce((s, v) => s + v, 0);
  const moyenne = somme / n.length;
  const variance =
    n.length > 1
      ? n.reduce((s, v) => s + (v - moyenne) ** 2, 0) / (n.length - 1)
      : 0;
  const ecartType = Math.sqrt(variance);
  const q1 = quantile(n, 0.25);
  const q3 = quantile(n, 0.75);
  const asymetrie =
    ecartType > 0 && n.length > 2
      ? (n.reduce((s, v) => s + ((v - moyenne) / ecartType) ** 3, 0) * n.length) /
        ((n.length - 1) * (n.length - 2))
      : 0;

  return {
    n: n.length,
    somme,
    moyenne,
    mediane: quantile(n, 0.5),
    ecartType,
    min: n[0],
    max: n[n.length - 1],
    q1,
    q3,
    iqr: q3 - q1,
    p90: quantile(n, 0.9),
    // Coefficient de variation : la dispersion rapportée à la moyenne. Il
    // dit si « en moyenne 50 000 F » recouvre des valeurs serrées ou un
    // écart entre 5 000 et 300 000.
    cv: moyenne !== 0 ? ecartType / Math.abs(moyenne) : 0,
    asymetrie,
  };
};

/// Corrélation de Pearson — la relation **linéaire** entre deux séries.
export const correlation = (xs = [], ys = []) => {
  const paires = xs
    .map((x, i) => [Number(x), Number(ys[i])])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const n = paires.length;
  if (n < 3) return { r: 0, n, force: "insuffisant" };

  const mx = paires.reduce((s, p) => s + p[0], 0) / n;
  const my = paires.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of paires) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  const r = den === 0 ? 0 : num / den;
  const abs = Math.abs(r);
  const force =
    abs >= 0.8 ? "tres forte" : abs >= 0.6 ? "forte" : abs >= 0.4 ? "moderee" : abs >= 0.2 ? "faible" : "nulle";
  return { r, n, force };
};

/// Régression linéaire par moindres carrés : y = a·x + b.
export const regression = (xs = [], ys = []) => {
  const paires = xs
    .map((x, i) => [Number(x), Number(ys[i])])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const n = paires.length;
  if (n < 2) return { pente: 0, ordonnee: 0, r2: 0, n };

  const mx = paires.reduce((s, p) => s + p[0], 0) / n;
  const my = paires.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of paires) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  const pente = den === 0 ? 0 : num / den;
  const ordonnee = my - pente * mx;

  let sr = 0;
  let st = 0;
  for (const [x, y] of paires) {
    sr += (y - (pente * x + ordonnee)) ** 2;
    st += (y - my) ** 2;
  }
  return { pente, ordonnee, r2: st === 0 ? 0 : 1 - sr / st, n };
};

// ---------------------------------------------------------------------------
// 5. Séries temporelles
// ---------------------------------------------------------------------------

/// Moyenne mobile centrée — ce qui reste quand on retire le bruit du jour.
export const moyenneMobile = (serie = [], fenetre = 7) => {
  if (fenetre < 2) return serie.map((p) => ({ ...p, lisse: p.valeur }));
  const demi = Math.floor(fenetre / 2);
  return serie.map((p, i) => {
    const debut = Math.max(0, i - demi);
    const fin = Math.min(serie.length, i + demi + 1);
    const tranche = serie.slice(debut, fin);
    const s = tranche.reduce((acc, x) => acc + x.valeur, 0);
    return { ...p, lisse: s / tranche.length };
  });
};

/// Le cumul depuis le début de la série.
export const cumuler = (serie = []) => {
  let total = 0;
  return serie.map((p) => {
    total += p.valeur;
    return { ...p, cumul: total };
  });
};

/// Variation d'une période à la précédente, en pourcentage.
export const variations = (serie = []) =>
  serie.map((p, i) => {
    if (i === 0) return { ...p, variation: null };
    const avant = serie[i - 1].valeur;
    return { ...p, variation: avant === 0 ? null : ((p.valeur - avant) / Math.abs(avant)) * 100 };
  });

/// Saisonnalité : l'écart moyen de chaque position du cycle par rapport à
/// la moyenne générale. `cycle` vaut 7 pour la semaine, 12 pour l'année.
///
/// Rend un indice pour 100 : 120 signifie « ce jour-là fait 20 % de plus
/// que la journée moyenne ».
export const saisonnalite = (serie = [], cycle = 7) => {
  if (serie.length < cycle * 2) return [];
  const moyenneGenerale =
    serie.reduce((s, p) => s + p.valeur, 0) / serie.length;
  if (moyenneGenerale === 0) return [];

  const paniers = Array.from({ length: cycle }, () => []);
  for (const p of serie) {
    const d = new Date(`${String(p.cle).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    const pos = cycle === 7 ? (d.getUTCDay() + 6) % 7 : d.getUTCMonth();
    paniers[pos].push(p.valeur);
  }
  return paniers.map((vals, i) => ({
    position: i,
    n: vals.length,
    indice: vals.length
      ? (vals.reduce((s, v) => s + v, 0) / vals.length / moyenneGenerale) * 100
      : null,
  }));
};

/// Prévision par lissage exponentiel double (Holt) : niveau + tendance.
///
/// Choisi plutôt qu'une simple droite parce qu'il **pondère le récent** :
/// une activité qui a changé de rythme le mois dernier ne reste pas
/// prisonnière de son historique. Sans composante saisonnière — il en
/// faudrait deux cycles complets, ce que la plupart des jeunes entreprises
/// n'ont pas encore.
///
/// L'intervalle est empirique : ±1,96 écart-type des erreurs de prévision
/// à un pas observées sur l'historique, élargi avec l'horizon.
export const prevoir = (serie = [], horizon = 3, alpha = 0.5, beta = 0.3) => {
  const valeurs = serie.map((p) => p.valeur);
  if (valeurs.length < 4) return { points: [], fiable: false, erreurType: 0 };

  let niveau = valeurs[0];
  let tendance = valeurs[1] - valeurs[0];
  const erreurs = [];

  for (let i = 1; i < valeurs.length; i += 1) {
    const attendu = niveau + tendance;
    erreurs.push(valeurs[i] - attendu);
    const niveauAvant = niveau;
    niveau = alpha * valeurs[i] + (1 - alpha) * (niveau + tendance);
    tendance = beta * (niveau - niveauAvant) + (1 - beta) * tendance;
  }

  const moyenneErreur = erreurs.reduce((s, e) => s + e, 0) / erreurs.length;
  const erreurType = Math.sqrt(
    erreurs.reduce((s, e) => s + (e - moyenneErreur) ** 2, 0) /
      Math.max(1, erreurs.length - 1),
  );

  const points = [];
  for (let h = 1; h <= horizon; h += 1) {
    const centre = niveau + h * tendance;
    // L'incertitude croît avec la racine de l'horizon : prévoir dans trois
    // mois est plus flou que prévoir le mois prochain, et le dire est plus
    // honnête qu'un trait net.
    const marge = 1.96 * erreurType * Math.sqrt(h);
    points.push({
      rang: h,
      valeur: Math.max(0, centre),
      bas: Math.max(0, centre - marge),
      haut: centre + marge,
    });
  }
  return { points, fiable: valeurs.length >= 8, erreurType, tendance };
};

/// Les dates de prévision, à la suite de la série observée.
export const datesSuivantes = (derniereCle, granularite, combien) => {
  const cles = [];
  if (granularite === "mois" || granularite === "trimestre") {
    const [a, reste] = String(derniereCle).split("-");
    let annee = Number(a);
    if (granularite === "mois") {
      let mois = Number(reste);
      for (let i = 0; i < combien; i += 1) {
        mois += 1;
        if (mois > 12) { mois = 1; annee += 1; }
        cles.push(`${annee}-${String(mois).padStart(2, "0")}`);
      }
    } else {
      let t = Number(String(reste).replace("T", ""));
      for (let i = 0; i < combien; i += 1) {
        t += 1;
        if (t > 4) { t = 1; annee += 1; }
        cles.push(`${annee}-T${t}`);
      }
    }
    return cles;
  }
  if (granularite === "annee") {
    let annee = Number(derniereCle);
    for (let i = 0; i < combien; i += 1) cles.push(String((annee += 1)));
    return cles;
  }
  const pas = granularite === "semaine" ? 7 : 1;
  const d = new Date(`${String(derniereCle).slice(0, 10)}T00:00:00Z`);
  for (let i = 0; i < combien; i += 1) {
    d.setUTCDate(d.getUTCDate() + pas);
    cles.push(d.toISOString().slice(0, 10));
  }
  return cles;
};

// ---------------------------------------------------------------------------
// 6. Anomalies
// ---------------------------------------------------------------------------

/// Points hors norme, par écart absolu médian (MAD).
///
/// La méthode du z-score classique se fait tromper par ce qu'elle cherche :
/// une valeur énorme gonfle la moyenne et l'écart-type, donc se rend
/// elle-même normale. La médiane, elle, ne bouge pas — c'est pourquoi on
/// l'emploie ici. Le facteur 0,6745 ramène le MAD à l'échelle d'un
/// écart-type sur une loi normale.
export const anomalies = (serie = [], seuil = 3.5) => {
  const valeurs = serie.map((p) => Number(p.valeur)).filter(Number.isFinite);
  if (valeurs.length < 5) return [];

  const triees = [...valeurs].sort((a, b) => a - b);
  const med = quantile(triees, 0.5);
  const ecarts = valeurs.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const mad = quantile(ecarts, 0.5);
  if (mad === 0) return [];

  return serie
    .map((p) => {
      const score = (0.6745 * (Number(p.valeur) - med)) / mad;
      return { ...p, score, mediane: med };
    })
    .filter((p) => Math.abs(p.score) >= seuil)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
};

// ---------------------------------------------------------------------------
// 7. Analyses métier
// ---------------------------------------------------------------------------

/// Pareto et classement ABC.
///
/// A = ce qui fait les 80 premiers pour cent, B = jusqu'à 95 %, C = la
/// queue. C'est la question « sur quoi se concentrer » posée aux données.
///
/// Les parts sont rendues **en pourcentage du total** — bars et courbe
/// cumulée partagent ainsi une seule échelle, au lieu du double axe qui
/// laisse croire à des rapports qui n'existent pas.
export const pareto = (resultat = []) => {
  const trie = [...resultat].sort((a, b) => b.valeur - a.valeur);
  const total = trie.reduce((s, r) => s + r.valeur, 0);
  if (total === 0) return { lignes: [], total: 0, seuilA: 0 };

  let cumul = 0;
  const lignes = trie.map((r, i) => {
    cumul += r.valeur;
    const partCumulee = (cumul / total) * 100;
    return {
      ...r,
      rang: i + 1,
      part: (r.valeur / total) * 100,
      partCumulee,
      classe: partCumulee <= 80 ? "A" : partCumulee <= 95 ? "B" : "C",
    };
  });
  // La ligne qui franchit 80 % appartient encore à A : c'est elle qui
  // permet d'atteindre le seuil.
  const premierB = lignes.findIndex((l) => l.classe !== "A");
  if (premierB > 0) lignes[premierB - 1].classe = "A";

  return {
    lignes,
    total,
    seuilA: lignes.filter((l) => l.classe === "A").length,
  };
};

/// Segmentation RFM : récence, fréquence, montant.
///
/// Chaque client est noté de 1 à 5 sur les trois axes (par quintiles), et
/// le triplet donne un segment nommé. C'est la façon la plus directe de
/// répondre à « qui dois-je rappeler cette semaine ».
///
/// `transactions` : [{ client, date, montant }]
export const rfm = (transactions = [], aujourdhui = new Date().toISOString().slice(0, 10)) => {
  const parClient = new Map();
  for (const t of transactions) {
    const cle = String(t.client || "—");
    const montant = Number(t.montant) || 0;
    const date = String(t.date || "").slice(0, 10);
    if (!date) continue;
    const c = parClient.get(cle) || { client: cle, derniere: date, frequence: 0, montant: 0 };
    if (date > c.derniere) c.derniere = date;
    c.frequence += 1;
    c.montant += montant;
    parClient.set(cle, c);
  }

  const clients = [...parClient.values()];
  if (!clients.length) return { clients: [], segments: [] };

  const jours = (a, b) =>
    Math.round(
      (new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000,
    );
  for (const c of clients) c.recence = Math.max(0, jours(c.derniere, aujourdhui));

  /// Note de 1 à 5 par quintile. `inverse` pour la récence : y être proche
  /// de zéro est *bon*, donc la note s'inverse.
  const noter = (champ, inverse) => {
    const triees = clients.map((c) => c[champ]).sort((a, b) => a - b);
    for (const c of clients) {
      const rang = triees.filter((v) => v < c[champ]).length / triees.length;
      const note = Math.min(5, Math.floor(rang * 5) + 1);
      c[`${champ}Note`] = inverse ? 6 - note : note;
    }
  };
  noter("recence", true);
  noter("frequence", false);
  noter("montant", false);

  for (const c of clients) {
    const r = c.recenceNote;
    const f = c.frequenceNote;
    const m = c.montantNote;
    const fm = (f + m) / 2;
    c.segment =
      r >= 4 && fm >= 4 ? "champions"
      : r >= 3 && fm >= 3 ? "fideles"
      : r >= 4 && fm <= 2 ? "nouveaux"
      : r >= 3 && fm <= 2 ? "prometteurs"
      : r <= 2 && fm >= 4 ? "aRisque"
      : r <= 2 && fm >= 3 ? "aReveiller"
      : r <= 2 && fm <= 2 ? "perdus"
      : "aSuivre";
    c.score = `${r}${f}${m}`;
  }

  const parSegment = new Map();
  for (const c of clients) {
    const s = parSegment.get(c.segment) || { segment: c.segment, n: 0, montant: 0 };
    s.n += 1;
    s.montant += c.montant;
    parSegment.set(c.segment, s);
  }

  return {
    clients: clients.sort((a, b) => b.montant - a.montant),
    segments: [...parSegment.values()].sort((a, b) => b.montant - a.montant),
  };
};

export const SEGMENTS_RFM = [
  "champions", "fideles", "nouveaux", "prometteurs",
  "aSuivre", "aReveiller", "aRisque", "perdus",
];

/// Cohortes de rétention.
///
/// Chaque client rejoint la cohorte du mois de son premier achat ; la
/// matrice dit combien sont revenus 1, 2, 3… mois plus tard. C'est la
/// mesure qui distingue une croissance réelle d'un tonneau percé.
export const cohortes = (transactions = [], profondeur = 6) => {
  const premier = new Map();
  const actifs = new Map(); // "client|mois" → présent

  for (const t of transactions) {
    const cle = String(t.client || "—");
    const mois = String(t.date || "").slice(0, 7);
    if (mois.length !== 7) continue;
    if (!premier.has(cle) || mois < premier.get(cle)) premier.set(cle, mois);
    actifs.set(`${cle}|${mois}`, true);
  }
  if (!premier.size) return { cohortes: [], profondeur };

  const distanceMois = (a, b) => {
    const [aa, am] = a.split("-").map(Number);
    const [ba, bm] = b.split("-").map(Number);
    return (ba - aa) * 12 + (bm - am);
  };
  const moisPlus = (m, n) => {
    const [a, mm] = m.split("-").map(Number);
    const total = (a * 12 + (mm - 1)) + n;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
  };

  const parCohorte = new Map();
  for (const [client, mois] of premier.entries()) {
    if (!parCohorte.has(mois)) parCohorte.set(mois, []);
    parCohorte.get(mois).push(client);
  }

  const maintenant = [...actifs.keys()]
    .map((k) => k.split("|")[1])
    .sort()
    .pop();

  const resultat = [...parCohorte.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([mois, clients]) => {
      const cellules = [];
      for (let d = 0; d <= profondeur; d += 1) {
        const cible = moisPlus(mois, d);
        // Un mois qui n'est pas encore arrivé n'est pas une rétention nulle.
        if (distanceMois(cible, maintenant) < 0) { cellules.push(null); continue; }
        const revenus = clients.filter((c) => actifs.has(`${c}|${cible}`)).length;
        cellules.push({
          n: revenus,
          taux: clients.length ? (revenus / clients.length) * 100 : 0,
        });
      }
      return { cohorte: mois, taille: clients.length, cellules };
    });

  return { cohortes: resultat, profondeur };
};

/// Affinités : ce qui s'achète ensemble.
///
/// Pour chaque paire d'articles présents dans un même ticket, on mesure :
///   support    — part des tickets où la paire apparaît ;
///   confiance  — parmi les tickets contenant A, la part contenant aussi B ;
///   lift       — combien de fois plus souvent que si c'était le hasard.
///
/// Un lift > 1 est une vraie association ; = 1 est une coïncidence. C'est
/// ce qui fonde un rangement de rayon ou une remise groupée.
export const affinites = (paniers = [], minSupport = 0.02) => {
  const total = paniers.length;
  if (total < 10) return [];

  const compteArticle = new Map();
  const comptePaire = new Map();

  for (const panier of paniers) {
    const articles = [...new Set(panier.filter(Boolean).map(String))].sort();
    for (const a of articles) compteArticle.set(a, (compteArticle.get(a) || 0) + 1);
    for (let i = 0; i < articles.length; i += 1) {
      for (let j = i + 1; j < articles.length; j += 1) {
        const k = `${articles[i]}\u0000${articles[j]}`;
        comptePaire.set(k, (comptePaire.get(k) || 0) + 1);
      }
    }
  }

  const resultat = [];
  for (const [k, n] of comptePaire.entries()) {
    const support = n / total;
    if (support < minSupport) continue;
    const [a, b] = k.split("\u0000");
    const pa = compteArticle.get(a) / total;
    const pb = compteArticle.get(b) / total;
    resultat.push({
      a,
      b,
      n,
      support: support * 100,
      confiance: (n / compteArticle.get(a)) * 100,
      lift: pa && pb ? support / (pa * pb) : 0,
    });
  }
  return resultat.sort((x, y) => y.lift - x.lift).slice(0, 40);
};

// ---------------------------------------------------------------------------
// 8. Lecture automatique — ce que les chiffres disent
// ---------------------------------------------------------------------------

/// Des constats rédigés à partir d'une série. Le module ne se contente pas
/// de tracer : il dit ce qu'il voit, et pourquoi il le dit.
///
/// Chaque constat porte un `ton` (info / ok / attention) et des valeurs
/// brutes, que l'écran met en forme dans la langue et la devise du poste.
export const constats = (serie = [], { granularite = "mois" } = {}) => {
  const sortie = [];
  if (serie.length < 2) return sortie;

  const stats = decrire(serie.map((p) => p.valeur));
  const avecVar = variations(serie);
  const derniere = avecVar[avecVar.length - 1];

  if (derniere?.variation !== null && derniere?.variation !== undefined) {
    sortie.push({
      cle: "variation",
      ton: derniere.variation >= 0 ? "ok" : "attention",
      valeurs: { pct: derniere.variation, periode: derniere.cle, granularite },
    });
  }

  const reg = regression(serie.map((_, i) => i), serie.map((p) => p.valeur));
  if (serie.length >= 4 && Math.abs(reg.r2) >= 0.3) {
    sortie.push({
      cle: "tendance",
      ton: reg.pente >= 0 ? "ok" : "attention",
      valeurs: { pente: reg.pente, r2: reg.r2, hausse: reg.pente >= 0 },
    });
  }

  const pics = anomalies(serie);
  if (pics.length) {
    sortie.push({
      cle: "anomalie",
      ton: "attention",
      valeurs: { periode: pics[0].cle, valeur: pics[0].valeur, mediane: pics[0].mediane,
                 haut: pics[0].score > 0, combien: pics.length },
    });
  }

  if (stats.cv > 0.75) {
    sortie.push({ cle: "irregulier", ton: "info", valeurs: { cv: stats.cv * 100 } });
  }

  const meilleur = [...serie].sort((a, b) => b.valeur - a.valeur)[0];
  if (meilleur) {
    sortie.push({
      cle: "record",
      ton: "info",
      valeurs: { periode: meilleur.cle, valeur: meilleur.valeur,
                 fois: stats.moyenne ? meilleur.valeur / stats.moyenne : 1 },
    });
  }

  return sortie;
};

/// Export CSV — le point de sortie vers un tableur.
///
/// Séparateur point-virgule et BOM UTF-8 : c'est ce qu'Excel attend en
/// configuration francophone. Avec une virgule, tout atterrit dans une
/// seule colonne ; sans BOM, les accents deviennent illisibles.
export const versCSV = (lignes = [], colonnes = null) => {
  if (!lignes.length) return "";
  const cols = colonnes || [...new Set(lignes.flatMap((l) => Object.keys(l)))];
  const echapper = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const tete = cols.join(";");
  const corps = lignes.map((l) => cols.map((c) => echapper(l[c])).join(";"));
  return `﻿${[tete, ...corps].join("\n")}`;
};
