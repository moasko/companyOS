// Paie — les règles, sans React.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE CE FICHIER CALCULE, ET CE QU'IL NE DIT PAS
//
// Il établit un bulletin de salaire ivoirien : du brut, il déduit les
// cotisations sociales et l'impôt, et rend le net à payer, le coût total
// employeur, et le détail de chaque ligne.
//
// Il ne fait pas autorité sur le droit. Les taux et plafonds changent par
// décret, et certaines valeurs sont même débattues entre sources — le
// plafond de l'assiette retraite est donné tantôt à 1 647 315 F, tantôt à
// 3 375 000 F selon les publications. Tout est donc dans `REGLAGES_DEFAUT`,
// modifiable par l'entreprise et son comptable. Le code applique un barème,
// il ne le décrète pas.
//
// ─────────────────────────────────────────────────────────────────────────
// LES BARÈMES DE DÉPART (Côte d'Ivoire)
//
//   — CNPS : retraite 6,3 % salarié + 7,7 % employeur ; prestations
//     familiales 5,75 % employeur ; accident du travail 2 à 5 % employeur
//     selon le risque. Assiette plafonnée.
//   — ITS unifié 2024 (fusion IS + CN + IGR) : barème progressif par
//     tranches, 0/16/21/24/28/32 %, sur le brut, sans abattement. Réduction
//     pour charges de famille : 5 500 F par demi-part au-delà de la
//     première, plafonnée à 5 parts.
//   — CMU : forfait par personne couverte.
//
// Sources : CNPS Côte d'Ivoire, DGI (réforme ITS janvier 2024). Voir la
// conversation qui a produit ce module pour les liens.
// ─────────────────────────────────────────────────────────────────────────

/// Tout ce qui peut changer par décret. Modifiable dans l'application.
export const REGLAGES_DEFAUT = {
  // Cotisations sociales, en pourcentage du brut plafonné.
  cnps: {
    retraiteSalarie: 6.3,
    retraiteEmployeur: 7.7,
    prestationsFamiliales: 5.75, // employeur
    accidentTravail: 2, // employeur, 2 à 5 selon le risque
    // Assiette mensuelle plafonnée. Valeur retenue par défaut ; une autre
    // source cite 1 647 315 — à confirmer avec le comptable.
    plafond: 3375000,
    // Assiette des prestations familiales et de l'accident du travail :
    // plafonnée beaucoup plus bas que la retraite (70 000 F par mois selon
    // les publications). Mettre la même valeur que `plafond` revient à
    // l'ancien calcul.
    plafondPrestations: 70000,
  },
  // Taxes FDFP à la charge de l'employeur, en % de la masse salariale :
  // taxe d'apprentissage et taxe additionnelle à la formation continue.
  fdfp: { apprentissage: 0.4, formationContinue: 1.2 },
  // Salaire minimum interprofessionnel garanti, mensuel. Un brut en
  // dessous est signalé, jamais bloqué : un temps partiel l'explique.
  smig: 75000,
  // Prime d'ancienneté de la convention collective interprofessionnelle :
  // 2 % après 2 ans de présence, +1 % par année, plafonnée à 25 %.
  anciennete: { actif: true, apresAns: 2, tauxInitial: 2, parAn: 1, max: 25 },
  // Indemnité de transport non imposable proposée chaque mois. Le montant
  // dépend de la ville : à ajuster.
  transport: 30000,
  // Base horaire mensuelle (40 h × 52 / 12) et jours ouvrables de
  // référence pour les retenues d'absence.
  heuresMois: 173.33,
  joursMois: 26,
  // Majorations des heures supplémentaires, en %.
  majorations: { h15: 15, h50: 50, h75: 75, h100: 100 },
  // Couverture maladie universelle : forfait mensuel par personne, à la
  // charge de l'employeur par défaut.
  cmu: { montantParPersonne: 1000, aLaChargeEmployeur: true },
  // Barème ITS 2024, bornes mensuelles hautes et taux marginal.
  its: [
    { jusqua: 75000, taux: 0 },
    { jusqua: 240000, taux: 16 },
    { jusqua: 800000, taux: 21 },
    { jusqua: 2400000, taux: 24 },
    { jusqua: 8000000, taux: 28 },
    { jusqua: Infinity, taux: 32 },
  ],
  // Réduction pour charges de famille : par demi-part au-delà de la
  // première, et nombre de parts maximal.
  ricf: { parDemiPart: 5500, partsMax: 5 },
};

const arrondi = (n) => Math.round(Number(n) || 0);

// ---------------------------------------------------------------------------
// Parts et réduction pour charges de famille
// ---------------------------------------------------------------------------

/// Le nombre de parts fiscales, selon la situation et les enfants.
///
/// Barème 2024 : 1 part célibataire, 1,5 veuf, 2 marié, plus une demi-part
/// par enfant à charge. Plafonné, comme la loi le prévoit.
export const parts = (situation, enfants = 0, reglages = REGLAGES_DEFAUT) => {
  const base =
    situation === "marie" ? 2 : situation === "veuf" ? 1.5 : 1;
  const total = base + (Number(enfants) || 0) * 0.5;
  return Math.min(total, reglages.ricf.partsMax);
};

/// La réduction d'impôt pour charges de famille, en francs.
///
/// 5 500 F par demi-part **au-delà de la première part** : un célibataire
/// (1 part) n'a droit à rien, c'est la référence.
export const ricf = (situation, enfants = 0, reglages = REGLAGES_DEFAUT) => {
  const p = parts(situation, enfants, reglages);
  const demiPartsSupplementaires = Math.max(0, (p - 1) / 0.5);
  return arrondi(demiPartsSupplementaires * reglages.ricf.parDemiPart);
};

// ---------------------------------------------------------------------------
// Impôt sur les traitements et salaires
// ---------------------------------------------------------------------------

/// L'ITS brut d'un salaire, avant réduction pour charges de famille.
///
/// Barème progressif : chaque tranche n'est taxée qu'à hauteur de ce qui la
/// traverse. Un salaire de 300 000 paie 0 % sur les 75 000 premiers, 16 %
/// sur les 165 000 suivants, 21 % sur les 60 000 restants — pas 21 % sur
/// tout. C'est l'erreur que fait un calcul « taux × brut », et elle coûte
/// cher au salarié.
export const itsBrut = (brut, reglages = REGLAGES_DEFAUT) => {
  let impot = 0;
  let plancher = 0;
  for (const tranche of reglages.its) {
    if (brut <= plancher) break;
    const base = Math.min(brut, tranche.jusqua) - plancher;
    impot += (base * tranche.taux) / 100;
    plancher = tranche.jusqua;
  }
  return arrondi(impot);
};

/// L'ITS réellement retenu : le barème, moins la réduction familiale, sans
/// jamais passer sous zéro.
export const its = (brut, situation, enfants, reglages = REGLAGES_DEFAUT) =>
  Math.max(0, itsBrut(brut, reglages) - ricf(situation, enfants, reglages));

// ---------------------------------------------------------------------------
// Cotisations CNPS
// ---------------------------------------------------------------------------

/// Les cotisations sociales d'un brut, part salariale et part patronale
/// séparées — c'est cette séparation qui distingue le net à payer du coût
/// employeur.
export const cotisations = (brut, reglages = REGLAGES_DEFAUT) => {
  const c = { ...REGLAGES_DEFAUT.cnps, ...(reglages.cnps || {}) };
  // L'assiette est plafonnée : au-delà, les taux ne s'appliquent plus. La
  // retraite et les prestations n'ont pas le même plafond.
  const assiette = Math.min(brut, c.plafond);
  const assiettePrestations = Math.min(brut, c.plafondPrestations ?? c.plafond);

  const retraiteSalarie = (assiette * c.retraiteSalarie) / 100;
  const retraiteEmployeur = (assiette * c.retraiteEmployeur) / 100;
  const prestationsFamiliales = (assiettePrestations * c.prestationsFamiliales) / 100;
  const accidentTravail = (assiettePrestations * c.accidentTravail) / 100;

  return {
    // Ce qui sort de la poche du salarié.
    salariale: arrondi(retraiteSalarie),
    // Ce que l'employeur paie en plus du brut.
    patronale: arrondi(retraiteEmployeur + prestationsFamiliales + accidentTravail),
    detail: {
      retraiteSalarie: arrondi(retraiteSalarie),
      retraiteEmployeur: arrondi(retraiteEmployeur),
      prestationsFamiliales: arrondi(prestationsFamiliales),
      accidentTravail: arrondi(accidentTravail),
    },
  };
};

// ---------------------------------------------------------------------------
// Bulletin
// ---------------------------------------------------------------------------

/// Établit un bulletin complet.
///
/// `salarie` porte le salaire de base et la situation familiale ; `saisie`
/// ce qui varie d'un mois à l'autre — primes imposables, indemnités non
/// imposables (transport), retenues (avances, prêts). Le brut imposable est
/// le socle du calcul ; les indemnités non imposables s'ajoutent au net
/// sans passer par l'impôt.
export const bulletin = (salarie = {}, saisie = {}, reglagesPartiels = REGLAGES_DEFAUT) => {
  const reglages = completer(reglagesPartiels);
  const base = Number(salarie.salaireBase) || 0;
  const primes = Number(saisie.primes) || 0;
  const indemnites = Number(saisie.indemnites) || 0; // transport, non imposable
  const retenues = Number(saisie.retenues) || 0; // avances, prêts
  const frais = Number(saisie.frais) || 0; // notes de frais remboursées
  const nbCmu = Number(saisie.personnesCmu ?? 1) || 0;
  const situation = saisie.situation ?? salarie.situation;
  const enfants = saisie.enfants ?? salarie.enfants;

  // Entrée ou sortie en cours de mois : le salaire suit les jours
  // ouvrables de présence.
  const pr = saisie.prorata;
  const retenueProrata =
    pr && pr.sur > 0 && pr.jours < pr.sur ? arrondi(base - (base * pr.jours) / pr.sur) : 0;

  // Absences non rémunérées : au trentième ouvrable du salaire de base.
  const abs = saisie.absences || {};
  const joursRetenus = (Number(abs.injustifiee) || 0) + (Number(abs.sansSolde) || 0);
  const retenueAbsences = arrondi((base * joursRetenus) / reglages.joursMois);

  const ans = anneesDeService(salarie.dateEmbauche, saisie.mois);
  const tauxAnciennete = tauxDAnciennete(ans, reglages);
  const primeAnciennete = arrondi((base * tauxAnciennete) / 100);

  const tauxHoraire = base / reglages.heuresMois;
  const hs = saisie.heuresSup || {};
  const lignesHs = Object.entries(reglages.majorations)
    .map(([cle, taux]) => ({ cle, taux, heures: Number(hs[cle]) || 0 }))
    .filter((x) => x.heures > 0)
    .map((x) => ({ ...x, montant: arrondi(x.heures * tauxHoraire * (1 + x.taux / 100)) }));
  const heuresSup = lignesHs.reduce((t, x) => t + x.montant, 0);

  const brut = Math.max(0, base - retenueProrata - retenueAbsences + primeAnciennete + heuresSup + primes);

  const cot = cotisations(brut, reglages);
  const impot = its(brut, situation, enfants, reglages);
  const cmuSalarie = reglages.cmu.aLaChargeEmployeur ? 0 : reglages.cmu.montantParPersonne * nbCmu;
  const cmuEmployeur = reglages.cmu.aLaChargeEmployeur ? reglages.cmu.montantParPersonne * nbCmu : 0;
  const tauxFdfp = (reglages.fdfp.apprentissage || 0) + (reglages.fdfp.formationContinue || 0);
  const fdfp = arrondi((brut * tauxFdfp) / 100);

  const totalRetenuesSalarie = cot.salariale + impot + cmuSalarie + retenues;
  const net = arrondi(brut + indemnites + frais - totalRetenuesSalarie);

  const chargesPatronales = cot.patronale + cmuEmployeur + fdfp;
  // Le remboursement de frais n'est pas un coût salarial : la charge est
  // déjà passée par la note de frais.
  const coutTotal = arrondi(brut + indemnites + chargesPatronales);

  // Les rubriques du bulletin, dans l'ordre où elles s'impriment. Le
  // bulletin à l'écran, le PDF et l'export en dérivent : un seul calcul.
  const R = (code, libelle, o = {}) => ({ code, libelle, base: "", taux: "", gain: 0, retenue: 0, patronal: 0, ...o });
  const assietteRet = Math.min(brut, reglages.cnps.plafond);
  const assiettePf = Math.min(brut, reglages.cnps.plafondPrestations ?? reglages.cnps.plafond);
  const rubriques = [
    R("100", "salaireBase", { base, gain: base }),
    retenueProrata ? R("110", "prorata", { base: `${pr.jours}/${pr.sur}`, retenue: retenueProrata }) : null,
    primeAnciennete ? R("120", "anciennete", { base, taux: tauxAnciennete, gain: primeAnciennete, ans }) : null,
    ...lignesHs.map((x, i) => R(`13${i}`, "heuresSup", { base: x.heures, taux: x.taux, gain: x.montant })),
    primes ? R("140", "primes", { gain: primes }) : null,
    retenueAbsences ? R("150", "absences", { base: joursRetenus, retenue: retenueAbsences }) : null,
    R("199", "brut", { gain: brut, sousTotal: true }),
    R("400", "cnpsRetraite", { base: assietteRet, taux: reglages.cnps.retraiteSalarie, retenue: cot.detail.retraiteSalarie, patronal: cot.detail.retraiteEmployeur }),
    R("410", "cnpsPf", { base: assiettePf, taux: reglages.cnps.prestationsFamiliales, patronal: cot.detail.prestationsFamiliales }),
    R("420", "cnpsAt", { base: assiettePf, taux: reglages.cnps.accidentTravail, patronal: cot.detail.accidentTravail }),
    R("450", "its", { base: brut, retenue: impot }),
    R("470", "cmu", { base: nbCmu, retenue: arrondi(cmuSalarie), patronal: arrondi(cmuEmployeur) }),
    fdfp ? R("480", "fdfp", { base: brut, taux: tauxFdfp, patronal: fdfp }) : null,
    indemnites ? R("600", "transport", { gain: indemnites }) : null,
    frais ? R("610", "frais", { gain: frais }) : null,
    retenues ? R("700", "avances", { retenue: retenues }) : null,
  ].filter(Boolean);

  return {
    brut: arrondi(brut),
    base: arrondi(base),
    primes: arrondi(primes),
    primeAnciennete,
    tauxAnciennete,
    heuresSup,
    retenueAbsences,
    retenueProrata,
    indemnites: arrondi(indemnites),
    frais: arrondi(frais),
    cotisationsSalariales: cot.salariale,
    its: impot,
    cmuSalarie: arrondi(cmuSalarie),
    retenues: arrondi(retenues),
    net,
    fdfp,
    chargesPatronales: arrondi(chargesPatronales),
    cmuEmployeur: arrondi(cmuEmployeur),
    coutTotal,
    cotisations: cot,
    parts: parts(situation, enfants, reglages),
    rubriques,
  };
};

/// Des réglages enregistrés avant l'ajout d'un paramètre gardent la valeur
/// par défaut de ce paramètre : un ancien espace ne doit pas perdre son
/// calcul parce qu'une clé lui manque.
export const completer = (r = {}) => ({
  ...REGLAGES_DEFAUT,
  ...r,
  cnps: { ...REGLAGES_DEFAUT.cnps, ...(r.cnps || {}) },
  cmu: { ...REGLAGES_DEFAUT.cmu, ...(r.cmu || {}) },
  fdfp: { ...REGLAGES_DEFAUT.fdfp, ...(r.fdfp || {}) },
  anciennete: { ...REGLAGES_DEFAUT.anciennete, ...(r.anciennete || {}) },
  majorations: { ...REGLAGES_DEFAUT.majorations, ...(r.majorations || {}) },
  ricf: { ...REGLAGES_DEFAUT.ricf, ...(r.ricf || {}) },
  its: r.its?.length ? r.its.map((t) => ({ ...t, jusqua: t.jusqua ?? Infinity })) : REGLAGES_DEFAUT.its,
});

/// Années complètes de service à la fin du mois payé.
export const anneesDeService = (dateEmbauche, mois) => {
  if (!dateEmbauche) return 0;
  const fin = mois ? finDeMois(mois) : new Date().toISOString().slice(0, 10);
  const [a1, m1, j1] = String(dateEmbauche).split("-").map(Number);
  const [a2, m2, j2] = fin.split("-").map(Number);
  let ans = a2 - a1;
  if (m2 < m1 || (m2 === m1 && j2 < j1)) ans -= 1;
  return Math.max(0, ans);
};

export const tauxDAnciennete = (ans, reglages = REGLAGES_DEFAUT) => {
  const a = completer(reglages).anciennete;
  if (!a.actif || ans < a.apresAns) return 0;
  return Math.min(a.max, a.tauxInitial + (ans - a.apresAns) * a.parAn);
};

export const finDeMois = (aaaaMm) =>
  new Date(Date.UTC(Number(aaaaMm.slice(0, 4)), Number(aaaaMm.slice(5, 7)), 0)).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Reprise comptable
// ---------------------------------------------------------------------------

/// L'écriture d'un bulletin, en partie double SYSCOHADA.
///
/// Le brut au débit des rémunérations (661), les charges patronales au débit
/// des charges sociales (664). En face : le net que le salarié va toucher
/// (421), les cotisations dues à la CNPS (431, part salariale + patronale),
/// et l'impôt retenu pour l'État (447). L'équilibre tient parce que
/// brut = net + cotisation salariale + impôt, et charges patronales = ce que
/// l'employeur verse en plus.
export const ecritureDeBulletin = (b, salarie = {}, mois = "") => {
  const nom = `${salarie.prenom || ""} ${salarie.nom || ""}`.trim() || "salarié";
  const cnpsTotal = b.cotisations.salariale + b.cotisations.patronale;
  const fdfp = Number(b.fdfp) || 0;
  const lignes = [
    { compte: "661", debit: b.brut + b.indemnites, credit: 0 },
    { compte: "664", debit: b.chargesPatronales - fdfp, credit: 0 },
    // Les taxes FDFP sont des impôts sur salaires, pas des charges sociales.
    { compte: "641", debit: fdfp, credit: 0 },
    { compte: "421", debit: 0, credit: b.net },
    { compte: "431", debit: 0, credit: cnpsTotal + b.cmuEmployeur + b.cmuSalarie },
    { compte: "447", debit: 0, credit: b.its + fdfp },
  ];
  // Les retenues (avances déjà versées) ne créent pas de dette : elles
  // remboursent l'entreprise. Les frais remboursés, eux, sont déjà au
  // crédit du personnel par la note de frais. Le net intègre les deux ;
  // l'écart se rattrape sur le compte de personnel.
  const ecart = lignes.reduce((s, l) => s + l.debit - l.credit, 0);
  if (ecart !== 0) {
    const perso = lignes.find((l) => l.compte === "421");
    perso.credit += ecart;
  }

  return {
    date: mois ? finDeMois(mois) : `${new Date().toISOString().slice(0, 7)}-28`,
    libelle: `Salaire ${mois} — ${nom}`.trim(),
    piece: `PAIE-${mois}`,
    tiers: nom,
    journal: "OD",
    source: "Paie",
    origine: `paie:${mois}:${salarie.matricule || nom}`,
    lignes: lignes.filter((l) => l.debit || l.credit),
  };
};

// ---------------------------------------------------------------------------
// Vue d'ensemble
// ---------------------------------------------------------------------------

/// Le récapitulatif d'un mois de paie sur un ensemble de bulletins.
export const recapitulatif = (bulletins = []) => {
  const somme = (f) => bulletins.reduce((s, b) => s + (Number(b[f]) || 0), 0);
  return {
    effectif: bulletins.length,
    brut: arrondi(somme("brut")),
    net: arrondi(somme("net")),
    cotisations: arrondi(somme("cotisationsSalariales")) + arrondi(bulletins.reduce((s, b) => s + b.cotisations.patronale, 0)),
    chargesPatronales: arrondi(somme("chargesPatronales")),
    its: arrondi(somme("its")),
    coutTotal: arrondi(somme("coutTotal")),
  };
};

/// Montant lisible, dans la devise d'affichage de l'espace.
export { montant as fcfa } from "../../../utils/monnaie.js";

/// Le mois précédent au format AAAA-MM — le mois qu'on paie d'ordinaire.
export const moisParDefaut = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
};

export const SITUATIONS = [
  { id: "celibataire", label: "Célibataire" },
  { id: "marie", label: "Marié(e)" },
  { id: "veuf", label: "Veuf(ve)" },
];
