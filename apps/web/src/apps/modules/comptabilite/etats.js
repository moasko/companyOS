// Comptabilité — états financiers au format SYSCOHADA révisé.
//
// Le bilan et le compte de résultat de domaine.js sont des lectures
// « par compte », faites pour comprendre. Ceux-ci suivent la présentation
// officielle du système normal (AUDCIF, 2017) : des rubriques repérées par
// leurs références — TA, RA, XA… pour le résultat, AD, BI, CA… pour le
// bilan, ZA à ZH pour les flux. Ce sont ces références que porte la liasse
// fiscale déposée à la DGI, et que l'expert-comptable recopie.
//
// Chaque rubrique se calcule par **préfixe de compte**, le plus long
// l'emportant : 6031 (variation de stocks) n'est pas un 603 quelconque. Un
// compte ajouté au plan tombe donc tout seul dans la bonne rubrique.

import { classeDe, lignesDe } from "./domaine.js";

const prefixe = (table, compte) => {
  const c = String(compte);
  let meilleur = null;
  let longueur = 0;
  for (const [p, ref] of table) {
    if (c.startsWith(p) && p.length > longueur) {
      meilleur = ref;
      longueur = p.length;
    }
  }
  return meilleur;
};

const soldesParCompte = (ecritures, contexte) => {
  const m = new Map();
  for (const l of lignesDe(ecritures, contexte)) {
    const c = String(l.compte);
    m.set(c, (m.get(c) || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0));
  }
  return m;
};

// ---------------------------------------------------------------------------
// Compte de résultat
// ---------------------------------------------------------------------------

const RUBRIQUES_CR = [
  ["701", "TA"], ["702", "TB"], ["703", "TB"], ["704", "TC"], ["705", "TC"], ["706", "TC"],
  ["707", "TD"], ["73", "TE"], ["72", "TF"], ["71", "TG"], ["75", "TH"], ["7", "TH"],
  ["78", "TI"], ["781", "TI"], ["79", "TJ"], ["77", "TK"], ["797", "TL"], ["787", "TM"],
  ["82", "TN"], ["84", "TO"], ["86", "TO"], ["88", "TO"],
  ["601", "RA"], ["6031", "RB"], ["603", "RB"], ["602", "RC"], ["6032", "RD"], ["60", "RE"],
  ["6033", "RF"], ["61", "RG"], ["62", "RH"], ["63", "RH"], ["64", "RI"], ["65", "RJ"],
  ["6", "RJ"], ["66", "RK"], ["68", "RL"], ["69", "RL"], ["67", "RM"], ["697", "RN"],
  ["81", "RO"], ["83", "RP"], ["85", "RP"], ["8", "RP"], ["87", "RQ"], ["89", "RS"],
];

/// Les lignes du compte de résultat, dans l'ordre du modèle officiel.
/// `type` : "poste" (une rubrique alimentée par des comptes) ou "solde"
/// (un solde intermédiaire calculé).
export const LIGNES_CR = [
  { ref: "TA", libelle: "Ventes de marchandises" },
  { ref: "RA", libelle: "Achats de marchandises" },
  { ref: "RB", libelle: "Variation de stocks de marchandises" },
  { ref: "XA", libelle: "Marge commerciale", somme: ["TA", "RA", "RB"] },
  { ref: "TB", libelle: "Ventes de produits fabriqués" },
  { ref: "TC", libelle: "Travaux, services vendus" },
  { ref: "TD", libelle: "Produits accessoires" },
  { ref: "XB", libelle: "Chiffre d'affaires", somme: ["TA", "TB", "TC", "TD"] },
  { ref: "TE", libelle: "Production stockée (ou déstockage)" },
  { ref: "TF", libelle: "Production immobilisée" },
  { ref: "TG", libelle: "Subventions d'exploitation" },
  { ref: "TH", libelle: "Autres produits" },
  { ref: "TI", libelle: "Transferts de charges d'exploitation" },
  { ref: "RC", libelle: "Achats de matières premières et fournitures liées" },
  { ref: "RD", libelle: "Variation de stocks de matières premières" },
  { ref: "RE", libelle: "Autres achats" },
  { ref: "RF", libelle: "Variation de stocks d'autres approvisionnements" },
  { ref: "RG", libelle: "Transports" },
  { ref: "RH", libelle: "Services extérieurs" },
  { ref: "RI", libelle: "Impôts et taxes" },
  { ref: "RJ", libelle: "Autres charges" },
  {
    ref: "XC",
    libelle: "Valeur ajoutée",
    somme: ["XA", "TB", "TC", "TD", "TE", "TF", "TG", "TH", "TI", "RC", "RD", "RE", "RF", "RG", "RH", "RI", "RJ"],
  },
  { ref: "RK", libelle: "Charges de personnel" },
  { ref: "XD", libelle: "Excédent brut d'exploitation", somme: ["XC", "RK"] },
  { ref: "TJ", libelle: "Reprises d'amortissements, provisions et dépréciations" },
  { ref: "RL", libelle: "Dotations aux amortissements, provisions et dépréciations" },
  { ref: "XE", libelle: "Résultat d'exploitation", somme: ["XD", "TJ", "RL"] },
  { ref: "TK", libelle: "Revenus financiers et assimilés" },
  { ref: "TL", libelle: "Reprises de provisions financières" },
  { ref: "TM", libelle: "Transferts de charges financières" },
  { ref: "RM", libelle: "Frais financiers et charges assimilées" },
  { ref: "RN", libelle: "Dotations aux provisions financières" },
  { ref: "XF", libelle: "Résultat financier", somme: ["TK", "TL", "TM", "RM", "RN"] },
  { ref: "XG", libelle: "Résultat des activités ordinaires", somme: ["XE", "XF"] },
  { ref: "TN", libelle: "Produits des cessions d'immobilisations" },
  { ref: "TO", libelle: "Autres produits HAO" },
  { ref: "RO", libelle: "Valeurs comptables des cessions d'immobilisations" },
  { ref: "RP", libelle: "Autres charges HAO" },
  { ref: "XH", libelle: "Résultat hors activités ordinaires", somme: ["TN", "TO", "RO", "RP"] },
  { ref: "RQ", libelle: "Participation des travailleurs" },
  { ref: "RS", libelle: "Impôts sur le résultat" },
  { ref: "XI", libelle: "Résultat net", somme: ["XG", "XH", "RQ", "RS"], total: true },
];

/// Compte de résultat SYSCOHADA. Les produits sont positifs, les charges
/// négatives : chaque solde intermédiaire est alors une simple somme, et la
/// lecture « − 2 557 445 » sur une charge est celle du modèle officiel.
///
/// Rend `{ lignes: [{ ref, libelle, montant, comptes, solde }], parRef }`.
export const compteDeResultatSyscohada = (ecritures, contexte) => {
  const soldes = soldesParCompte(ecritures, contexte);
  const parRef = {};
  const comptes = {};
  for (const [compte, solde] of soldes) {
    const classe = classeDe(compte);
    if (classe < 6 || classe > 8) continue;
    const ref = prefixe(RUBRIQUES_CR, compte);
    if (!ref || Math.abs(solde) < 0.5) continue;
    // Solde débiteur = charge : négatif. Créditeur = produit : positif.
    parRef[ref] = (parRef[ref] || 0) - solde;
    (comptes[ref] = comptes[ref] || []).push(compte);
  }
  const lignes = [];
  for (const l of LIGNES_CR) {
    if (l.somme) parRef[l.ref] = l.somme.reduce((s, r) => s + (parRef[r] || 0), 0);
    lignes.push({
      ...l,
      montant: Math.round(parRef[l.ref] || 0),
      comptes: l.somme ? [] : (comptes[l.ref] || []).sort(),
      solde: !!l.somme,
    });
  }
  return { lignes, parRef, resultat: Math.round(parRef.XI || 0) };
};

// ---------------------------------------------------------------------------
// Bilan
// ---------------------------------------------------------------------------

const ACTIF_FIXE = [
  ["21", "AD"], ["281", "AD"], ["291", "AD"],
  ["22", "AI"], ["23", "AI"], ["24", "AI"], ["25", "AI"], ["282", "AI"], ["283", "AI"], ["284", "AI"],
  ["292", "AI"], ["293", "AI"], ["294", "AI"],
  ["26", "AQ"], ["27", "AQ"], ["296", "AQ"], ["297", "AQ"],
  ["3", "BB"],
  ["50", "BQ"], ["51", "BR"],
];
const PASSIF_FIXE = [
  ["101", "CA"], ["102", "CA"], ["103", "CA"], ["104", "CA"], ["109", "CA"], ["105", "CD"],
  ["106", "CE"], ["11", "CF"], ["110", "CH"], ["12", "CH"], ["13", "CJ"], ["14", "CL"], ["15", "CM"],
  ["16", "DA"], ["18", "DA"], ["17", "DB"], ["19", "DC"],
  ["481", "DH"], ["482", "DH"], ["484", "DH"], ["499", "DN"], ["565", "DQ"],
];

/// La place d'un compte au bilan, selon son solde. Les classes 1 à 3 ont un
/// côté fixe (un amortissement réduit l'actif, il ne passe pas au passif) ;
/// les tiers et la trésorerie vont du côté que leur solde désigne.
export const posteBilan = (compte, solde) => {
  const c = String(compte);
  if (c.startsWith("1")) return { cote: "passif", ref: prefixe(PASSIF_FIXE, c) || "DA" };
  if (c.startsWith("2")) return { cote: "actif", ref: prefixe(ACTIF_FIXE, c) || "AI" };
  if (c.startsWith("3")) return { cote: "actif", ref: "BB" };
  if (c.startsWith("565")) return { cote: "passif", ref: "DQ" };
  if (c.startsWith("50")) return { cote: "actif", ref: "BQ" };
  if (c.startsWith("51")) return { cote: "actif", ref: "BR" };
  if (c.startsWith("5")) return solde >= 0 ? { cote: "actif", ref: "BS" } : { cote: "passif", ref: "DR" };
  if (c.startsWith("4")) {
    if (["481", "482", "484"].some((p) => c.startsWith(p))) return { cote: "passif", ref: "DH" };
    if (c.startsWith("499")) return { cote: "passif", ref: "DN" };
    if (c.startsWith("409")) return solde >= 0 ? { cote: "actif", ref: "BH" } : { cote: "passif", ref: "DJ" };
    if (c.startsWith("419")) return solde > 0 ? { cote: "actif", ref: "BI" } : { cote: "passif", ref: "DI" };
    if (c.startsWith("40")) return solde > 0 ? { cote: "actif", ref: "BH" } : { cote: "passif", ref: "DJ" };
    if (c.startsWith("41")) return solde >= 0 ? { cote: "actif", ref: "BI" } : { cote: "passif", ref: "DI" };
    if (solde >= 0) return { cote: "actif", ref: "BJ" };
    return { cote: "passif", ref: /^4[2-4]/.test(c) ? "DK" : "DM" };
  }
  return { cote: solde >= 0 ? "actif" : "passif", ref: solde >= 0 ? "BJ" : "DM" };
};

export const LIGNES_ACTIF = [
  { ref: "AD", libelle: "Immobilisations incorporelles" },
  { ref: "AI", libelle: "Immobilisations corporelles" },
  { ref: "AQ", libelle: "Immobilisations financières" },
  { ref: "AZ", libelle: "Total actif immobilisé", somme: ["AD", "AI", "AQ"] },
  { ref: "BB", libelle: "Stocks et encours" },
  { ref: "BH", libelle: "Fournisseurs, avances versées" },
  { ref: "BI", libelle: "Clients" },
  { ref: "BJ", libelle: "Autres créances" },
  { ref: "BK", libelle: "Total actif circulant", somme: ["BB", "BH", "BI", "BJ"] },
  { ref: "BQ", libelle: "Titres de placement" },
  { ref: "BR", libelle: "Valeurs à encaisser" },
  { ref: "BS", libelle: "Banques, chèques postaux, caisse et assimilés" },
  { ref: "BT", libelle: "Total trésorerie-actif", somme: ["BQ", "BR", "BS"] },
  { ref: "BZ", libelle: "Total général", somme: ["AZ", "BK", "BT"], total: true },
];

export const LIGNES_PASSIF = [
  { ref: "CA", libelle: "Capital" },
  { ref: "CD", libelle: "Primes liées au capital social" },
  { ref: "CE", libelle: "Écarts de réévaluation" },
  { ref: "CF", libelle: "Réserves" },
  { ref: "CH", libelle: "Report à nouveau" },
  { ref: "CJ", libelle: "Résultat net de l'exercice" },
  { ref: "CL", libelle: "Subventions d'investissement" },
  { ref: "CM", libelle: "Provisions réglementées" },
  { ref: "CP", libelle: "Total capitaux propres", somme: ["CA", "CD", "CE", "CF", "CH", "CJ", "CL", "CM"] },
  { ref: "DA", libelle: "Emprunts et dettes financières diverses" },
  { ref: "DB", libelle: "Dettes de location-acquisition" },
  { ref: "DC", libelle: "Provisions pour risques et charges" },
  { ref: "DD", libelle: "Total dettes financières", somme: ["DA", "DB", "DC"] },
  { ref: "DF", libelle: "Total ressources stables", somme: ["CP", "DD"] },
  { ref: "DH", libelle: "Dettes circulantes HAO" },
  { ref: "DI", libelle: "Clients, avances reçues" },
  { ref: "DJ", libelle: "Fournisseurs d'exploitation" },
  { ref: "DK", libelle: "Dettes fiscales et sociales" },
  { ref: "DM", libelle: "Autres dettes" },
  { ref: "DN", libelle: "Provisions pour risques à court terme" },
  { ref: "DP", libelle: "Total passif circulant", somme: ["DH", "DI", "DJ", "DK", "DM", "DN"] },
  { ref: "DQ", libelle: "Banques, crédits d'escompte" },
  { ref: "DR", libelle: "Banques, établissements financiers et crédits de trésorerie" },
  { ref: "DT", libelle: "Total trésorerie-passif", somme: ["DQ", "DR"] },
  { ref: "DZ", libelle: "Total général", somme: ["DF", "DP", "DT"], total: true },
];

/// Bilan SYSCOHADA à la date `au`.
///
/// Les comptes de bilan (classes 1 à 5) se lisent en cumul depuis
/// l'origine. Le résultat de l'exercice (du `du` au `au`) va en CJ ; celui
/// des exercices antérieurs, qui n'a pas encore été affecté par une
/// écriture d'à-nouveau, va en report à nouveau (CH). C'est ce qui garde le
/// bilan équilibré même quand l'affectation n'a pas été passée.
export const bilanSyscohada = (ecritures, { du, au, axe } = {}) => {
  const soldes = soldesParCompte(ecritures, { au, axe });
  const parRef = {};
  const comptes = {};
  const ajouter = (ref, montant, compte) => {
    parRef[ref] = (parRef[ref] || 0) + montant;
    if (compte) (comptes[ref] = comptes[ref] || []).push(compte);
  };
  for (const [compte, solde] of soldes) {
    if (Math.abs(solde) < 0.5) continue;
    const classe = classeDe(compte);
    if (classe < 1 || classe > 5) continue;
    const { cote, ref } = posteBilan(compte, solde);
    ajouter(ref, cote === "actif" ? solde : -solde, compte);
  }
  const exercice = compteDeResultatSyscohada(ecritures, { du, au, axe }).resultat;
  const total = compteDeResultatSyscohada(ecritures, { au, axe }).resultat;
  ajouter("CJ", exercice);
  if (Math.abs(total - exercice) >= 0.5) ajouter("CH", total - exercice);

  const calculer = (lignes) =>
    lignes.map((l) => {
      if (l.somme) parRef[l.ref] = l.somme.reduce((s, r) => s + (parRef[r] || 0), 0);
      return {
        ...l,
        montant: Math.round(parRef[l.ref] || 0),
        comptes: l.somme ? [] : (comptes[l.ref] || []).sort(),
        solde: !!l.somme,
      };
    });
  const actif = calculer(LIGNES_ACTIF);
  const passif = calculer(LIGNES_PASSIF);
  const totalActif = Math.round(parRef.BZ || 0);
  const totalPassif = Math.round(parRef.DZ || 0);
  return { actif, passif, totalActif, totalPassif, equilibre: Math.abs(totalActif - totalPassif) < 1, resultat: exercice };
};

// ---------------------------------------------------------------------------
// Flux de trésorerie
// ---------------------------------------------------------------------------

/// Tableau des flux de trésorerie, présentation simplifiée du modèle
/// SYSCOHADA (ZA à ZH).
///
/// Chaque écriture qui touche la trésorerie (classe 5) est rangée selon sa
/// contrepartie principale : immobilisations (2) → investissement ;
/// capitaux propres (10 à 14) ou emprunts (16 à 18) → financement ; tout le
/// reste → activités opérationnelles. Un virement entre deux comptes de
/// trésorerie (caisse vers banque) ne change pas la trésorerie et
/// n'apparaît pas.
export const fluxTresorerie = (ecritures, { du, au, axe } = {}) => {
  const tresoAvant = [...soldesParCompte(ecritures, du ? { au: veille(du), axe } : { au: "0000-00-00" })]
    .filter(([c]) => classeDe(c) === 5)
    .reduce((s, [, v]) => s + v, 0);
  const flux = { ZB: 0, ZC: 0, ZD: 0, ZE: 0 };
  const encaissements = { ZB: 0, ZC: 0, ZD: 0, ZE: 0 };
  const decaissements = { ZB: 0, ZC: 0, ZD: 0, ZE: 0 };
  for (const e of ecritures) {
    const d = e.data || e;
    if ((du && d.date < du) || (au && d.date > au) || (axe && d.axe !== axe)) continue;
    const lignes = d.lignes || [];
    const mvt = lignes
      .filter((l) => classeDe(l.compte) === 5)
      .reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
    if (Math.abs(mvt) < 0.5) continue;
    const contreparties = lignes
      .filter((l) => classeDe(l.compte) !== 5)
      .sort((a, b) => (Number(b.debit) || 0) + (Number(b.credit) || 0) - (Number(a.debit) || 0) - (Number(a.credit) || 0));
    const c = String(contreparties[0]?.compte || "");
    const cat = c.startsWith("2")
      ? "ZC"
      : /^1[0-4]/.test(c)
        ? "ZD"
        : /^1[6-8]/.test(c)
          ? "ZE"
          : "ZB";
    flux[cat] += mvt;
    if (mvt > 0) encaissements[cat] += mvt;
    else decaissements[cat] -= mvt;
  }
  const ZF = flux.ZD + flux.ZE;
  const ZG = flux.ZB + flux.ZC + ZF;
  const r = Math.round;
  return {
    lignes: [
      { ref: "ZA", libelle: "Trésorerie nette au début de la période", montant: r(tresoAvant), solde: true },
      { ref: "ZB", libelle: "Flux de trésorerie provenant des activités opérationnelles", montant: r(flux.ZB), detail: { entrees: r(encaissements.ZB), sorties: r(decaissements.ZB) } },
      { ref: "ZC", libelle: "Flux de trésorerie provenant des activités d'investissement", montant: r(flux.ZC), detail: { entrees: r(encaissements.ZC), sorties: r(decaissements.ZC) } },
      { ref: "ZD", libelle: "Flux provenant des capitaux propres", montant: r(flux.ZD) },
      { ref: "ZE", libelle: "Flux provenant des capitaux étrangers", montant: r(flux.ZE) },
      { ref: "ZF", libelle: "Flux de trésorerie provenant des activités de financement", montant: r(ZF), solde: true },
      { ref: "ZG", libelle: "Variation de la trésorerie nette de la période", montant: r(ZG), solde: true },
      { ref: "ZH", libelle: "Trésorerie nette à la fin de la période", montant: r(tresoAvant + ZG), solde: true, total: true },
    ],
  };
};

const veille = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/// Trésorerie en fin de mois sur les `n` derniers mois jusqu'à `mois`
/// (AAAA-MM) — pour la courbe du pilotage.
export const tresorerieParMois = (ecritures, mois, n = 6) => {
  const out = [];
  const [a, m] = mois.split("-").map(Number);
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    const aaaaMm = d.toISOString().slice(0, 7);
    const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const total = lignesDe(ecritures, { au: fin })
      .filter((l) => classeDe(l.compte) === 5)
      .reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0);
    out.push({ mois: aaaaMm, fin, total: Math.round(total) });
  }
  return out;
};

/// Les lignes du journal qui composent une rubrique — pour descendre d'un
/// montant des états jusqu'à la pièce.
export const lignesDeRubrique = (ecritures, comptes, contexte) => {
  const set = new Set(comptes);
  return lignesDe(ecritures, contexte)
    .filter((l) => set.has(String(l.compte)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
};
