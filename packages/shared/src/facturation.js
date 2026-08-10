// Règles de facturation, en fonctions pures.
//
// Rien ici ne connaît React ni l'API. C'est ce qui permet de vérifier un
// total, un reste à payer ou un numéro de facture sans ouvrir l'écran.
//
// DEUX PRINCIPES.
//
// 1. Le montant payé n'est pas un champ, c'est une somme de règlements.
//    Un état « payée » coché à la main ment le jour où un acompte est
//    encaissé, et personne ne sait plus ce qui reste dû.
//
// 2. L'état de paiement se **déduit**, il ne se saisit pas. Ce que
//    l'utilisateur décide, c'est autre chose : brouillon, envoyée,
//    annulée. Payée ou non, c'est la caisse qui le dit.

export const TYPES = {
  devis: { label: "Devis", prefixe: "DEV", icone: "faFileLines" },
  facture: { label: "Facture", prefixe: "FAC", icone: "faFileInvoiceDollar" },
  // Un avoir porte des montants négatifs à l'encaissement : il rembourse
  // ou annule tout ou partie d'une facture déjà émise. On ne « supprime »
  // jamais une facture envoyée — la comptabilité l'interdit.
  avoir: { label: "Avoir", prefixe: "AV", icone: "faFileCircleMinus" },
};

/// Ce que l'utilisateur décide explicitement.
export const STATUTS = {
  brouillon: { label: "Brouillon", ton: "idle" },
  envoye: { label: "Envoyé", ton: "info" },
  accepte: { label: "Accepté", ton: "ok" },
  refuse: { label: "Refusé", ton: "off" },
  annule: { label: "Annulé", ton: "off" },
};

export const MOYENS = [
  "Espèces",
  "Mobile Money",
  "Virement",
  "Chèque",
  "Carte bancaire",
];

export const DEVISES = ["XOF", "EUR", "USD"];

export const today = () => new Date().toISOString().slice(0, 10);

export const plusJours = (jours, depuis) => {
  const d = depuis ? new Date(depuis) : new Date();
  d.setDate(d.getDate() + jours);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Totaux
// ---------------------------------------------------------------------------

/// Total d'une ligne, remise comprise.
///
/// La remise est en pourcentage et s'applique avant la TVA : c'est l'ordre
/// qu'impose la règle fiscale, et l'inverse changerait le montant de taxe
/// dû sans que personne ne le remarque.
export const totalLigne = (l = {}) => {
  const brut = (Number(l.qte) || 0) * (Number(l.pu) || 0);
  const remise = brut * ((Number(l.remise) || 0) / 100);
  return brut - remise;
};

/// Totaux d'un document.
///
/// La TVA est portée par chaque ligne : un même document mélange
/// couramment des taux — prestation à 18 %, produit exonéré à 0 %.
/// Le détail par taux est rendu tel quel, car une facture doit le montrer.
export const totaux = (doc = {}) => {
  const lignes = doc.lignes || [];
  const remiseGlobale = Number(doc.remiseGlobale) || 0;

  let brut = 0;
  for (const l of lignes) brut += totalLigne(l);

  const abattement = brut * (remiseGlobale / 100);
  const ht = brut - abattement;

  // La remise globale se répercute au prorata sur chaque ligne, sinon la
  // somme des TVA par taux ne correspondrait plus à la TVA totale.
  const facteur = brut ? ht / brut : 1;

  const parTaux = new Map();
  let tva = 0;
  for (const l of lignes) {
    const base = totalLigne(l) * facteur;
    const taux = Number(l.tva) || 0;
    const montant = (base * taux) / 100;
    tva += montant;
    const cumul = parTaux.get(taux) || { base: 0, montant: 0 };
    parTaux.set(taux, { base: cumul.base + base, montant: cumul.montant + montant });
  }

  return {
    brut,
    abattement,
    ht,
    tva,
    ttc: ht + tva,
    parTaux: [...parTaux.entries()]
      .map(([taux, v]) => ({ taux, ...v }))
      .sort((a, b) => a.taux - b.taux),
  };
};

// ---------------------------------------------------------------------------
// Règlements
// ---------------------------------------------------------------------------

/// Somme encaissée sur un document.
export const encaisse = (documentId, reglements = []) =>
  reglements
    .filter((r) => r.data.documentId === documentId)
    .reduce((s, r) => s + (Number(r.data.montant) || 0), 0);

/// État de paiement — déduit, jamais saisi.
///
/// L'ordre des tests compte : une facture annulée n'est pas « en retard »,
/// et un devis ne se paie pas.
export const etatPaiement = (doc, reglements = [], maintenant = today()) => {
  const d = doc.data || doc;
  if (d.type === "devis") return { id: "sansObjet", label: "—", ton: "idle" };
  if (d.statut === "annule") return { id: "annule", label: "Annulé", ton: "off" };
  if (d.statut === "brouillon") return { id: "brouillon", label: "Brouillon", ton: "idle" };

  const du = totaux(d).ttc;
  const paye = encaisse(doc.id, reglements);
  // Un centime d'écart d'arrondi ne doit pas laisser une facture
  // éternellement « partiellement payée ».
  const reste = Math.round((du - paye) * 100) / 100;

  if (reste <= 0) return { id: "payee", label: "Payée", ton: "ok", reste: 0, paye };
  if (paye > 0)
    return {
      id: "partielle",
      label: `Payée à ${Math.round((paye / du) * 100)} %`,
      ton: "warn",
      reste,
      paye,
    };
  if (d.echeance && d.echeance < maintenant)
    return { id: "retard", label: "En retard", ton: "bad", reste, paye };
  return { id: "impayee", label: "À encaisser", ton: "info", reste, paye };
};

/// Retard en jours, 0 si l'échéance n'est pas passée.
export const joursDeRetard = (doc, maintenant = today()) => {
  const d = doc.data || doc;
  if (!d.echeance || d.echeance >= maintenant) return 0;
  return Math.round((new Date(maintenant) - new Date(d.echeance)) / 86400000);
};

// ---------------------------------------------------------------------------
// Numérotation
// ---------------------------------------------------------------------------

/// Numéro suivant : FAC-2026-0001.
///
/// La séquence repart chaque année et vaut par type de document — c'est ce
/// qu'attend un comptable, et cela évite qu'un devis consomme un numéro de
/// facture. On repart du plus grand numéro **déjà pris**, jamais du nombre
/// de documents : après une suppression, compter donnerait un numéro déjà
/// utilisé, ce qu'aucune comptabilité n'accepte.
export const prochainNumero = (documents, type, annee = new Date().getFullYear()) => {
  const prefixe = TYPES[type]?.prefixe || "DOC";
  const motif = new RegExp(`^${prefixe}-${annee}-(\\d+)$`);

  const max = documents.reduce((acc, d) => {
    const m = motif.exec(d.data?.numero || "");
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);

  return `${prefixe}-${annee}-${String(max + 1).padStart(4, "0")}`;
};

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/// Transforme un devis accepté en facture.
///
/// Le devis est conservé intact : c'est une pièce du dossier client, pas un
/// brouillon de facture. La facture garde un lien vers lui pour qu'on
/// retrouve l'origine du prix un an plus tard.
export const devisVersFacture = (devis, numero) => ({
  ...devis.data,
  type: "facture",
  numero,
  statut: "brouillon",
  date: today(),
  echeance: plusJours(30),
  sourceId: devis.id,
  sourceNumero: devis.data.numero,
});

// ---------------------------------------------------------------------------
// Agrégats
// ---------------------------------------------------------------------------

/// Chiffres de tête. Les devis et les documents annulés sont exclus du
/// chiffre d'affaires : un devis n'est pas une vente.
export const statistiques = (documents, reglements, maintenant = today()) => {
  let facture = 0;
  let encaisseTotal = 0;
  let enAttente = 0;
  let enRetard = 0;
  let nbRetard = 0;

  for (const doc of documents) {
    const d = doc.data;
    if (d.type === "devis" || d.statut === "annule" || d.statut === "brouillon") continue;

    const signe = d.type === "avoir" ? -1 : 1;
    const ttc = totaux(d).ttc * signe;
    facture += ttc;

    const e = etatPaiement(doc, reglements, maintenant);
    encaisseTotal += (e.paye || 0) * signe;
    if (e.id === "retard") {
      enRetard += e.reste;
      nbRetard += 1;
    } else if (e.id === "impayee" || e.id === "partielle") {
      enAttente += e.reste;
    }
  }

  return { facture, encaisse: encaisseTotal, enAttente, enRetard, nbRetard };
};

/// Ancienneté des impayés — le tableau que réclame tout dirigeant qui
/// cherche à comprendre pourquoi sa trésorerie est vide.
export const balanceAgee = (documents, reglements, maintenant = today()) => {
  const tranches = [
    { id: "courant", label: "Non échu", max: 0, montant: 0 },
    { id: "j30", label: "1 à 30 jours", max: 30, montant: 0 },
    { id: "j60", label: "31 à 60 jours", max: 60, montant: 0 },
    { id: "j90", label: "61 à 90 jours", max: 90, montant: 0 },
    { id: "plus", label: "Plus de 90 jours", max: Infinity, montant: 0 },
  ];

  for (const doc of documents) {
    if (doc.data.type !== "facture") continue;
    const e = etatPaiement(doc, reglements, maintenant);
    if (!["impayee", "partielle", "retard"].includes(e.id)) continue;

    const retard = joursDeRetard(doc, maintenant);
    const tranche = tranches.find((t) => retard <= t.max) || tranches[tranches.length - 1];
    tranche.montant += e.reste;
  }

  return tranches;
};
