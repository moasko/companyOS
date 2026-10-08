// Stock — les règles de pilotage, sans React.
//
// Le modèle reprend deux références : Odoo pour la rigueur (entrepôts,
// lots et péremption, points de commande, inventaire tournant) et Sortly
// pour la simplicité (scan au téléphone, étiquettes). Tout se calcule à
// partir des mouvements — le principe de domaine.js ne change pas : le
// stock n'est jamais stocké, il se déduit.

import { niveaux, niveauxParEntrepot, pmp } from "./domaine.js";

const JOUR = 86400000;
const arrondi = (n) => Math.round(Number(n) || 0);
export const aujourdhui = () => new Date().toISOString().slice(0, 10);
const joursEntre = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / JOUR);
const moinsJours = (iso, n) => new Date(new Date(`${iso}T12:00:00Z`).getTime() - n * JOUR).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Entrepôts
// ---------------------------------------------------------------------------

/// Les entrepôts de l'espace. Le « principal » existe toujours : il a
/// l'identifiant vide, celui de tous les mouvements anciens, et ne se
/// supprime pas. Le renommer crée son record, marqué `principal` ; les
/// autres entrepôts gardent l'identifiant de leur record.
export const listeEntrepots = (records = []) => {
  const principal = records.find((r) => r.data.principal);
  return [
    principal
      ? { emplacements: [], ...principal.data, id: "", recordId: principal.id }
      : { id: "", recordId: null, nom: "Principal", code: "PR", emplacements: [], principal: true },
    ...records.filter((r) => !r.data.principal).map((r) => ({ emplacements: [], ...r.data, id: r.id, recordId: r.id })),
  ];
};

/// Le stock d'un article dans un entrepôt.
export const stockDans = (parEntrepot, articleId, entrepotId) => {
  const s = parEntrepot[articleId] || {};
  if (entrepotId === undefined || entrepotId === null || entrepotId === "*") {
    return Object.values(s).reduce((t, q) => t + q, 0);
  }
  return s[entrepotId] || 0;
};

/// Valeur et nombre d'articles par entrepôt.
export const syntheseEntrepots = (entrepots, articles, mouvements) => {
  const par = niveauxParEntrepot(mouvements);
  const cout = new Map(articles.map((a) => [a.id, pmp(a, mouvements)]));
  return entrepots.map((e) => {
    let valeur = 0;
    let references = 0;
    for (const a of articles) {
      const q = stockDans(par, a.id, e.id);
      if (q > 0) {
        valeur += q * cout.get(a.id);
        references += 1;
      }
    }
    return { ...e, valeur: arrondi(valeur), references };
  });
};

// ---------------------------------------------------------------------------
// Consommation et réapprovisionnement
// ---------------------------------------------------------------------------

/// Sorties par jour d'un article sur une fenêtre (30 jours par défaut).
/// Les transferts et les inventaires ne sont pas des consommations : ils
/// déplacent ou corrigent, ils ne vendent pas.
export const consommations = (mouvements, { jours = 30, jusqua = aujourdhui() } = {}) => {
  const depuis = moinsJours(jusqua, jours);
  const t = {};
  for (const m of mouvements) {
    const d = m.data;
    if (d.sens !== "sortie" || d.date < depuis || d.date > jusqua) continue;
    t[d.articleId] = (t[d.articleId] || 0) + (Number(d.quantite) || 0);
  }
  for (const k of Object.keys(t)) t[k] /= jours;
  return t;
};

/// Paramètres de réapprovisionnement d'un article, avec leurs valeurs par
/// défaut : 2 jours de sécurité, 7 jours de délai, pas de multiple.
export const parametresReappro = (article) => {
  const d = article.data || article;
  return {
    securite: Number(d.stockSecurite) || 0,
    delai: Number(d.delaiFournisseur) || 7,
    multiple: Math.max(1, Number(d.qteCommande) || 1),
    max: Number(d.stockMax) || 0,
    seuil: Number(d.seuil) || 0,
  };
};

/// Le point de commande : ce qui part pendant le délai du fournisseur, plus
/// le stock de sécurité. Sans historique de ventes, le seuil saisi à la
/// main fait foi.
export const pointDeCommande = (article, conso = 0) => {
  const p = parametresReappro(article);
  const calcule = Math.ceil(conso * p.delai + (p.securite || conso * 2));
  return conso > 0 ? Math.max(calcule, p.seuil) : p.seuil;
};

/// Les articles à commander, avec la quantité suggérée.
///
/// On commande quand le **disponible** (stock moins ce qui est déjà promis
/// aux clients, plus ce qui est déjà commandé) passe sous le point de
/// commande. La quantité remonte jusqu'au stock maximum — à défaut, de quoi
/// tenir trente jours — arrondie au multiple d'achat (le carton).
export const aReapprovisionner = ({ articles = [], mouvements = [], reserves = {}, enCommande = {}, jusqua = aujourdhui() }) => {
  const niv = niveaux(mouvements);
  const conso = consommations(mouvements, { jusqua });
  const out = [];
  for (const a of articles) {
    if (a.data.archive) continue;
    const c = conso[a.id] || 0;
    const point = pointDeCommande(a, c);
    if (!point) continue;
    const stock = niv[a.id] || 0;
    const dispo = stock - (reserves[a.id] || 0);
    const projete = dispo + (enCommande[a.id] || 0);
    if (projete > point) continue;
    const p = parametresReappro(a);
    const cible = p.max || Math.max(point * 2, Math.ceil(point + c * 30));
    const brut = Math.max(cible - projete, p.multiple);
    const qte = Math.ceil(brut / p.multiple) * p.multiple;
    const pu = Number(a.data.prixAchat) || pmp(a, mouvements);
    out.push({
      article: a,
      stock,
      dispo,
      enCommande: enCommande[a.id] || 0,
      conso: c,
      couverture: c > 0 ? Math.max(0, Math.floor(dispo / c)) : null,
      point,
      qte,
      pu,
      montant: arrondi(qte * pu),
      fournisseurId: a.data.fournisseurId || "",
      rupture: dispo <= 0,
    });
  }
  return out.sort((x, y) => Number(y.rupture) - Number(x.rupture) || (x.couverture ?? 1e9) - (y.couverture ?? 1e9));
};

/// Les suggestions regroupées par fournisseur, pour une commande chacun.
export const parFournisseur = (suggestions) => {
  const m = new Map();
  for (const s of suggestions) {
    const k = s.fournisseurId || "";
    if (!m.has(k)) m.set(k, { fournisseurId: k, lignes: [], total: 0 });
    const g = m.get(k);
    g.lignes.push(s);
    g.total += s.montant;
  }
  return [...m.values()].sort((a, b) => (a.fournisseurId ? 0 : 1) - (b.fournisseurId ? 0 : 1) || b.total - a.total);
};

/// Les lignes d'une commande des Achats, à partir des suggestions.
export const lignesDeCommande = (lignes) =>
  lignes.map((s) => ({
    articleId: s.article.id,
    designation: s.article.data.designation,
    qte: s.qte,
    pu: arrondi(s.pu),
    tva: Number(s.article.data.tva) || 0,
  }));

// ---------------------------------------------------------------------------
// Réservations et livraisons (Facturation)
// ---------------------------------------------------------------------------

const lignesArticles = (doc) => (doc.data?.lignes || []).filter((l) => l.articleId && Number(l.qte || l.quantite) > 0);

/// Les factures émises dont les articles ne sont pas encore sortis du
/// stock. La Facturation vend ; c'est la livraison qui fait sortir la
/// marchandise, et elle se constate ici.
export const facturesALivrer = (documents = [], mouvements = []) => {
  const livrees = new Set(mouvements.map((m) => m.data.origine).filter(Boolean));
  return documents.filter(
    (d) =>
      d.data.type === "facture" &&
      !["brouillon", "annule"].includes(d.data.statut) &&
      lignesArticles(d).length &&
      !livrees.has(`facture:${d.id}`),
  );
};

/// Ce qui est promis aux clients et pas encore sorti : devis acceptés et
/// factures non livrées. Le disponible, c'est le stock moins ça.
export const reservations = (documents = [], mouvements = []) => {
  const t = {};
  const ajouter = (doc) => {
    for (const l of lignesArticles(doc)) t[l.articleId] = (t[l.articleId] || 0) + Number(l.qte || l.quantite);
  };
  for (const d of documents) if (d.data.type === "devis" && d.data.statut === "accepte") ajouter(d);
  for (const d of facturesALivrer(documents, mouvements)) ajouter(d);
  return t;
};

/// Les sorties qui livrent une facture.
export const sortiesDeFacture = (doc, entrepotId = "") =>
  lignesArticles(doc).map((l) => ({
    articleId: l.articleId,
    sens: "sortie",
    quantite: Number(l.qte || l.quantite),
    date: aujourdhui(),
    entrepotId,
    motif: `Livraison ${doc.data.numero || ""}`.trim(),
    origine: `facture:${doc.id}`,
  }));

/// Les quantités déjà commandées aux fournisseurs et pas encore reçues.
/// Un brouillon compte : c'est le réapprovisionnement qui le crée, et
/// l'ignorer reproposerait aussitôt les mêmes articles — deux commandes pour
/// un seul besoin.
export const quantitesEnCommande = (commandes = [], receptions = []) => {
  const t = {};
  const recu = {};
  for (const r of receptions) {
    for (const l of r.data.lignes || []) {
      const k = `${r.data.commandeId}:${l.articleId}`;
      recu[k] = (recu[k] || 0) + (Number(l.qte) || 0);
    }
  }
  for (const c of commandes) {
    if (["annulee", "recue"].includes(c.data.statut)) continue;
    for (const l of c.data.lignes || []) {
      if (!l.articleId) continue;
      const reste = (Number(l.qte) || 0) - (recu[`${c.id}:${l.articleId}`] || 0);
      if (reste > 0) t[l.articleId] = (t[l.articleId] || 0) + reste;
    }
  }
  return t;
};

// ---------------------------------------------------------------------------
// Lots et péremption
// ---------------------------------------------------------------------------

/// Les lots encore en stock d'un article.
///
/// On suppose la règle « premier périmé, premier sorti » respectée : le
/// stock restant est donc dans les lots qui périment le plus tard. On
/// remplit les lots du plus tardif au plus proche, chacun jusqu'à sa
/// quantité reçue ; ce qui dépasse est « sans lot ». Cette lecture tient
/// même quand une sortie n'a pas dit de quel lot elle prenait.
export const lotsEnStock = (articleId, mouvements, stock, jusqua = aujourdhui()) => {
  const recus = new Map();
  for (const m of mouvements) {
    const d = m.data;
    if (d.articleId !== articleId || d.sens !== "entree" || !d.lot) continue;
    const l = recus.get(d.lot) || { lot: d.lot, peremption: d.peremption || "", recu: 0, entrepotId: d.entrepotId || "", emplacement: d.emplacement || "" };
    l.recu += Number(d.quantite) || 0;
    if (d.peremption && (!l.peremption || d.peremption < l.peremption)) l.peremption = d.peremption;
    recus.set(d.lot, l);
  }
  const ordre = [...recus.values()].sort((a, b) => (b.peremption || "9999").localeCompare(a.peremption || "9999"));
  let reste = Math.max(0, Number(stock) || 0);
  const out = [];
  for (const l of ordre) {
    if (reste <= 0) break;
    const q = Math.min(l.recu, reste);
    reste -= q;
    out.push({ ...l, qte: q, jours: l.peremption ? joursEntre(jusqua, l.peremption) : null });
  }
  if (reste > 0 && out.length) out.push({ lot: "", peremption: "", qte: reste, jours: null });
  return out.sort((a, b) => (a.peremption || "9999").localeCompare(b.peremption || "9999"));
};

/// Les lots qui périment dans la fenêtre (30 jours), tous articles.
export const lotsAPerimer = (articles, mouvements, { jours = 30, jusqua = aujourdhui() } = {}) => {
  const niv = niveaux(mouvements);
  const out = [];
  for (const a of articles) {
    for (const l of lotsEnStock(a.id, mouvements, niv[a.id] || 0, jusqua)) {
      if (l.jours != null && l.jours <= jours) out.push({ article: a, ...l, valeur: arrondi(l.qte * pmp(a, mouvements)) });
    }
  }
  return out.sort((a, b) => a.jours - b.jours);
};

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

/// Classement ABC sur la valeur sortie : A fait 80 % de la valeur, B les
/// 15 % suivants, C le reste. C'est lui qui dit quoi compter souvent.
export const classesABC = (articles, mouvements, { jours = 90, jusqua = aujourdhui() } = {}) => {
  const depuis = moinsJours(jusqua, jours);
  const valeur = new Map(articles.map((a) => [a.id, 0]));
  const cout = new Map(articles.map((a) => [a.id, pmp(a, mouvements)]));
  for (const m of mouvements) {
    const d = m.data;
    if (d.sens !== "sortie" || d.date < depuis || !valeur.has(d.articleId)) continue;
    valeur.set(d.articleId, valeur.get(d.articleId) + (Number(d.quantite) || 0) * cout.get(d.articleId));
  }
  const total = [...valeur.values()].reduce((s, v) => s + v, 0);
  const tries = [...valeur.entries()].sort((a, b) => b[1] - a[1]);
  const classes = {};
  let cumul = 0;
  for (const [id, v] of tries) {
    const part = total ? cumul / total : 1;
    classes[id] = !v ? "C" : part < 0.8 ? "A" : part < 0.95 ? "B" : "C";
    cumul += v;
  }
  const resume = { A: { n: 0, valeur: 0 }, B: { n: 0, valeur: 0 }, C: { n: 0, valeur: 0 } };
  for (const [id, v] of valeur) {
    resume[classes[id]].n += 1;
    resume[classes[id]].valeur += v;
  }
  for (const k of Object.keys(resume)) resume[k].part = total ? resume[k].valeur / total : 0;
  return { classes, resume, total };
};

/// Les articles en stock qui n'ont pas bougé depuis `jours` jours.
export const dormants = (articles, mouvements, { jours = 90, jusqua = aujourdhui() } = {}) => {
  const niv = niveaux(mouvements);
  const dernier = {};
  for (const m of mouvements) {
    if (m.data.sens !== "sortie") continue;
    if (!dernier[m.data.articleId] || m.data.date > dernier[m.data.articleId]) dernier[m.data.articleId] = m.data.date;
  }
  const limite = moinsJours(jusqua, jours);
  return articles
    .filter((a) => (niv[a.id] || 0) > 0)
    .filter((a) => {
      const d = dernier[a.id];
      const cree = String(a.createdAt || "").slice(0, 10);
      return d ? d < limite : cree && cree < limite;
    })
    .map((a) => ({ article: a, stock: niv[a.id], valeur: arrondi(niv[a.id] * pmp(a, mouvements)), depuis: dernier[a.id] || "" }));
};

/// Le niveau d'un article jour par jour sur `jours` jours, pour la courbe.
export const historiqueNiveau = (articleId, mouvements, { jours = 30, jusqua = aujourdhui() } = {}) => {
  const siens = mouvements.filter((m) => m.data.articleId === articleId);
  const out = [];
  for (let i = jours - 1; i >= 0; i -= 1) {
    const jour = moinsJours(jusqua, i);
    const q = niveaux(siens.filter((m) => m.data.date <= jour))[articleId] || 0;
    out.push({ jour, q });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Inventaire tournant
// ---------------------------------------------------------------------------

/// Fréquence de comptage par classe, en jours.
export const FREQUENCES = { A: 7, B: 30, C: 90 };

/// Les articles à compter : ceux dont le dernier inventaire est plus ancien
/// que la fréquence de leur classe.
export const aCompter = (articles, mouvements, classes, { jusqua = aujourdhui() } = {}) => {
  const dernier = {};
  for (const m of mouvements) {
    if (m.data.sens !== "inventaire") continue;
    if (!dernier[m.data.articleId] || m.data.date > dernier[m.data.articleId]) dernier[m.data.articleId] = m.data.date;
  }
  return articles.filter((a) => {
    const f = FREQUENCES[classes[a.id] || "C"];
    const d = dernier[a.id];
    return !d || joursEntre(d, jusqua) >= f;
  });
};

/// Les lignes d'un nouvel inventaire : chaque article avec ce que les
/// livres attendent dans l'entrepôt.
export const lignesInventaire = (articles, mouvements, entrepotId) => {
  const par = niveauxParEntrepot(mouvements);
  return articles.map((a) => ({ articleId: a.id, attendu: stockDans(par, a.id, entrepotId), compte: null, cause: "" }));
};

/// Écarts d'un inventaire, valorisés au prix moyen pondéré.
export const ecartsInventaire = (lignes, articles, mouvements) => {
  const parId = new Map(articles.map((a) => [a.id, a]));
  let comptes = 0;
  let avecEcart = 0;
  let valeur = 0;
  const detail = lignes.map((l) => {
    const a = parId.get(l.articleId);
    const compte = l.compte === null || l.compte === "" || l.compte === undefined ? null : Number(l.compte);
    const ecart = compte === null ? null : compte - (Number(l.attendu) || 0);
    const v = ecart === null || !a ? 0 : ecart * pmp(a, mouvements);
    if (compte !== null) comptes += 1;
    if (ecart) {
      avecEcart += 1;
      valeur += v;
    }
    return { ...l, compte, ecart, valeur: arrondi(v) };
  });
  return { detail, comptes, total: lignes.length, avecEcart, valeur: arrondi(valeur) };
};

/// Les mouvements qui appliquent un inventaire validé : un par ligne
/// comptée, qui impose le niveau constaté dans l'entrepôt.
export const mouvementsInventaire = (inventaire, id) =>
  (inventaire.lignes || [])
    .filter((l) => l.compte !== null && l.compte !== "" && l.compte !== undefined)
    .map((l) => ({
      articleId: l.articleId,
      sens: "inventaire",
      quantite: Number(l.compte),
      entrepotId: inventaire.entrepotId || "",
      date: aujourdhui(),
      motif: `${inventaire.numero}${l.cause ? ` — ${l.cause}` : ""}`,
      cause: l.cause || "",
      origine: `inventaire:${id}:${l.articleId}`,
    }));

/// L'écriture comptable des écarts d'un inventaire : une perte réduit le
/// stock (311) contre la variation de stock (6031), un excédent l'inverse.
export const ecritureInventaire = (inventaire, id, valeur) => {
  const v = Math.abs(arrondi(valeur));
  if (!v) return null;
  const perte = valeur < 0;
  return {
    journal: "OD",
    date: inventaire.valideLe || aujourdhui(),
    libelle: `Écarts d'inventaire ${inventaire.numero}`,
    piece: inventaire.numero,
    origine: `stock-inventaire:${id}`,
    source: "Stock",
    lignes: perte
      ? [{ compte: "6031", debit: v, credit: 0 }, { compte: "311", debit: 0, credit: v }]
      : [{ compte: "311", debit: v, credit: 0 }, { compte: "6031", debit: 0, credit: v }],
  };
};

/// Numéro suivant d'une série : INV-0001, TR-0001…
export const prochainNumero = (records, prefixe) => {
  const re = new RegExp(`^${prefixe}-(\\d+)$`);
  const max = records.reduce((m, r) => {
    const x = re.exec(r.data.numero || "");
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
  return `${prefixe}-${String(max + 1).padStart(4, "0")}`;
};

// ---------------------------------------------------------------------------
// Code-barres
// ---------------------------------------------------------------------------

/// Trouve un article par ce qu'un lecteur ou une caméra a lu : code-barres,
/// référence, sans tenir compte de la casse ni des espaces.
export const parCode = (articles, code) => {
  const c = String(code || "").replace(/\s/g, "").toUpperCase();
  if (!c) return null;
  return (
    articles.find((a) => String(a.data.codeBarre || "").replace(/\s/g, "").toUpperCase() === c) ||
    articles.find((a) => String(a.data.reference || "").replace(/\s/g, "").toUpperCase() === c) ||
    null
  );
};

// Code 39 : lisible par tous les lecteurs, sans clé de contrôle obligatoire,
// et assez simple pour être dessiné barre par barre dans un PDF. Chaque
// caractère fait neuf éléments (barre, espace, barre…) dont trois larges.
const C39 = {
  0: "nnnwwnwnn", 1: "wnnwnnnnw", 2: "nnwwnnnnw", 3: "wnwwnnnnn", 4: "nnnwwnnnw", 5: "wnnwwnnnn",
  6: "nnwwwnnnn", 7: "nnnwnnwnw", 8: "wnnwnnwnn", 9: "nnwwnnwnn", A: "wnnnnwnnw", B: "nnwnnwnnw",
  C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn", F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn",
  I: "nnwnnwwnn", J: "nnnnwwwnn", K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww",
  O: "wnnnwnnwn", P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn", Z: "nwwnwnnnn",
  "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", $: "nwnwnwnnn", "/": "nwnwnnnwn", "+": "nwnnnwnwn",
  "%": "nnnwnwnwn", "*": "nwnnwnwnn",
};

/// Les barres d'un code 39 : [{ x, largeur }] en modules (étroit = 1,
/// large = 3), et la largeur totale. Les caractères hors alphabet sont
/// écartés plutôt que de produire un code illisible.
export const barresCode39 = (texte) => {
  const propre = String(texte || "").toUpperCase().split("").filter((c) => C39[c] && c !== "*").join("");
  const motif = `*${propre}*`;
  const barres = [];
  let x = 0;
  for (const c of motif) {
    C39[c].split("").forEach((e, i) => {
      const l = e === "w" ? 3 : 1;
      if (i % 2 === 0) barres.push({ x, largeur: l });
      x += l;
    });
    x += 1; // espace entre caractères
  }
  return { texte: propre, barres, largeur: x - 1 };
};
