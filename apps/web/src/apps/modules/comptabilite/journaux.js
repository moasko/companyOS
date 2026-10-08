// Comptabilité — journaux, numérotation et saisie par pièce.
//
// Les logiciels de référence (Sage, Ciel, Odoo, Pennylane) tiennent tous la
// même discipline, parce que c'est elle que l'administration fiscale
// contrôle :
//
//   - **une pièce = une écriture équilibrée**, rangée dans un journal ;
//   - **une numérotation continue** par journal et par exercice, sans trou
//     ni doublon : VTE-2026-0001, VTE-2026-0002… Un trou dans la suite est
//     la première chose que cherche un vérificateur ;
//   - **un justificatif** derrière chaque pièce saisie à la main.
//
// La saisie libre au compte ne remplace pas les « opérations guidées »
// (domaine.js) : elle s'adresse au comptable, qui connaît son plan et veut
// aller vite au clavier. Les deux produisent la même écriture.

import { classeDe, intitule, PLAN, totauxEcriture } from "./domaine.js";

/// Les journaux d'une PME. `tresorerie` est le compte que le journal
/// mouvemente toujours — il sert à deviner le journal d'une écriture
/// ancienne qui n'en porte pas.
export const JOURNAUX = [
  { code: "VTE", label: "Ventes" },
  { code: "ACH", label: "Achats" },
  { code: "BQ", label: "Banque", tresorerie: "521" },
  { code: "MM", label: "Mobile Money", tresorerie: "531" },
  { code: "CAI", label: "Caisse", tresorerie: "571" },
  { code: "OD", label: "Opérations diverses" },
];

export const libelleJournal = (code) =>
  JOURNAUX.find((j) => j.code === code)?.label || "Opérations diverses";

const PREFIXES_ORIGINE = [
  ["facture:", "VTE"],
  ["achat-facture:", "ACH"],
  ["achats:", "ACH"],
  ["caisse:", "CAI"],
  ["paie:", "OD"],
  ["frais:", "OD"],
];

/// Le journal d'une écriture : celui qu'elle porte, sinon celui que son
/// origine ou ses comptes désignent. Les écritures antérieures aux journaux
/// restent ainsi classées sans migration.
export const journalDe = (ecriture) => {
  const d = ecriture?.data || ecriture || {};
  if (d.journal) return d.journal;
  const origine = String(d.origine || "");
  for (const [prefixe, code] of PREFIXES_ORIGINE) {
    if (origine.startsWith(prefixe)) return code;
  }
  const comptes = (d.lignes || []).map((l) => String(l.compte));
  for (const j of JOURNAUX) {
    if (j.tresorerie && comptes.some((c) => c.startsWith(j.tresorerie))) return j.code;
  }
  if (comptes.some((c) => c.startsWith("70"))) return "VTE";
  if (comptes.some((c) => c.startsWith("60") || c.startsWith("401"))) return "ACH";
  return "OD";
};

const RE_NUMERO = /^([A-Z]+)-(\d{4})-(\d+)$/;

/// Le prochain numéro d'un journal pour l'année de `date`.
///
/// On part du plus grand numéro existant, pas du nombre de pièces : une
/// pièce contre-passée garde son numéro, et la suivante ne doit jamais le
/// réutiliser.
export const prochainNumero = (ecritures, journal, date) => {
  const annee = String(date || "").slice(0, 4) || String(new Date().getFullYear());
  let max = 0;
  for (const e of ecritures) {
    const m = RE_NUMERO.exec((e.data || e).numero || "");
    if (m && m[1] === journal && m[2] === annee) max = Math.max(max, Number(m[3]));
  }
  return `${journal}-${annee}-${String(max + 1).padStart(4, "0")}`;
};

/// Les trous d'une numérotation : numéros manquants entre le premier et le
/// dernier d'un journal, année par année.
export const trousNumerotation = (ecritures) => {
  const vus = new Map(); // "VTE-2026" → Set(numéros)
  for (const e of ecritures) {
    const m = RE_NUMERO.exec((e.data || e).numero || "");
    if (!m) continue;
    const cle = `${m[1]}-${m[2]}`;
    if (!vus.has(cle)) vus.set(cle, new Set());
    vus.get(cle).add(Number(m[3]));
  }
  const out = [];
  for (const [cle, set] of vus) {
    const liste = [...set].sort((a, b) => a - b);
    for (let n = 1; n < liste[liste.length - 1]; n += 1) {
      if (!set.has(n)) out.push(`${cle}-${String(n).padStart(4, "0")}`);
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Recherche de compte
// ---------------------------------------------------------------------------

const sansAccents = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/// Comptes proposés pendant la frappe : par début de numéro d'abord, puis
/// par mot de l'intitulé. Un numéro tapé qui n'est pas au plan reste
/// proposé tel quel — le plan d'une PME s'étend, il ne se bloque pas.
export const chercherComptes = (requete, { max = 8 } = {}) => {
  const q = String(requete || "").trim();
  if (!q) return PLAN.slice(0, max);
  const parCode = PLAN.filter((c) => c.code.startsWith(q));
  const mots = sansAccents(q).split(/\s+/).filter(Boolean);
  // Un intitulé dont un mot *commence* par la frappe passe devant celui qui
  // la contient seulement : « serv » donne « Services vendus » avant
  // « Réserve légale ».
  const debutDeMot = (label, m) => sansAccents(label).split(/[^a-z0-9]+/).some((w) => w.startsWith(m));
  const parMot = /^\d+$/.test(q)
    ? []
    : PLAN.filter((c) => !parCode.includes(c) && mots.every((m) => sansAccents(c.label).includes(m))).sort(
        (a, b) =>
          Number(mots.every((m) => debutDeMot(b.label, m))) - Number(mots.every((m) => debutDeMot(a.label, m))),
      );
  const out = [...parCode, ...parMot].slice(0, max);
  if (/^[1-8]\d{1,7}$/.test(q) && !out.some((c) => c.code === q)) {
    out.unshift({ code: q, label: intitule(q), horsPlan: !PLAN.some((c) => c.code === q) });
  }
  return out.slice(0, max);
};

export const estTiers = (compte) => /^4(0|1)/.test(String(compte || ""));

// ---------------------------------------------------------------------------
// Lignes de saisie
// ---------------------------------------------------------------------------

const n = (v) => Math.round(Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0);

/// Lignes utiles d'une saisie : un compte et un montant.
export const lignesUtiles = (lignes) =>
  (lignes || [])
    .map((l) => ({ ...l, debit: n(l.debit), credit: n(l.credit) }))
    .filter((l) => l.compte && (l.debit || l.credit));

/// Le montant qui solde la pièce sur la ligne `rang` — la touche « = » des
/// logiciels comptables. Renvoie `{ debit, credit }`.
export const soldeSur = (lignes, rang) => {
  const autres = lignesUtiles(lignes.filter((_, i) => i !== rang));
  const { ecart } = totauxEcriture({ lignes: autres });
  return ecart > 0 ? { debit: 0, credit: ecart } : { debit: -ecart, credit: 0 };
};

/// Compte de TVA d'une ligne de base, ou null si elle n'en appelle pas.
export const compteTvaPour = (compte) => {
  const c = String(compte || "");
  if (c.startsWith("7")) return "4431";
  if (c.startsWith("2")) return "4451";
  if (c.startsWith("60") || c.startsWith("61") || c.startsWith("62") || c.startsWith("63")) {
    return "4452";
  }
  return null;
};

/// Recalcule les lignes de TVA automatiques d'une saisie.
///
/// Chaque ligne de produit (7) ou de charge et d'immobilisation (2, 60 à
/// 63) porte sa taxe au taux choisi, sur une ligne marquée `auto` que
/// l'utilisateur voit mais n'a pas à taper. Les lignes `auto` sont toujours
/// recalculées : modifier le hors-taxe met la TVA à jour.
export const avecTva = (lignes, taux) => {
  const base = (lignes || []).filter((l) => !l.auto);
  if (!Number(taux)) return base;
  const parCompte = new Map();
  for (const l of base) {
    const compte = compteTvaPour(l.compte);
    if (!compte) continue;
    const ht = n(l.debit) - n(l.credit);
    if (!ht) continue;
    parCompte.set(compte, (parCompte.get(compte) || 0) + ht);
  }
  const auto = [...parCompte.entries()].map(([compte, ht]) => {
    const t = Math.round((ht * Number(taux)) / 100);
    return {
      compte,
      libelle: `TVA ${taux} %`,
      debit: t > 0 ? t : 0,
      credit: t < 0 ? -t : 0,
      auto: true,
    };
  });
  return [...base, ...auto];
};

/// Les contrôles d'une pièce, chacun avec son verdict — affichés en
/// permanence pendant la saisie, comme dans le design : on voit ce qui
/// manque avant de cliquer, pas après.
export const controlesPiece = (piece, { clotureAu, numero, taux } = {}) => {
  const lignes = lignesUtiles(piece.lignes);
  const { debit, credit, ecart } = totauxEcriture({ lignes });
  const out = [];

  out.push({
    id: "equilibre",
    titre: "Débit = crédit",
    ok: lignes.length >= 2 && Math.abs(ecart) < 1,
    bloquant: true,
    detail:
      lignes.length < 2
        ? "Une pièce demande au moins deux lignes"
        : Math.abs(ecart) < 1
          ? `${debit} au débit, ${credit} au crédit`
          : `Il manque ${Math.abs(ecart)} au ${ecart > 0 ? "crédit" : "débit"}`,
  });

  const close = !!clotureAu && !!piece.date && String(piece.date) <= clotureAu;
  out.push({
    id: "periode",
    titre: "Période ouverte",
    ok: !!piece.date && !close,
    bloquant: true,
    detail: !piece.date
      ? "La date manque"
      : close
        ? `La période est verrouillée jusqu'au ${clotureAu}`
        : "La date tombe dans une période ouverte",
  });

  out.push({
    id: "numero",
    titre: "Numérotation continue",
    ok: true,
    bloquant: false,
    detail: numero ? `${numero} suit la dernière pièce du journal` : "Attribuée à l'enregistrement",
  });

  const sansTiers = lignes.filter((l) => estTiers(l.compte) && !String(l.tiers || piece.tiers || "").trim());
  out.push({
    id: "tiers",
    titre: "Tiers renseigné",
    ok: !sansTiers.length,
    bloquant: true,
    detail: sansTiers.length
      ? `Le compte ${sansTiers[0].compte} exige un client ou un fournisseur`
      : "Chaque compte de tiers porte son client ou fournisseur",
  });

  const doubles = lignes.filter((l) => l.debit && l.credit);
  if (doubles.length) {
    out.push({
      id: "sens",
      titre: "Un seul sens par ligne",
      ok: false,
      bloquant: true,
      detail: `Le compte ${doubles[0].compte} porte un débit et un crédit`,
    });
  }

  const horsPlan = lignes.filter((l) => !PLAN.some((c) => c.code === String(l.compte)));
  const classesInvalides = lignes.filter((l) => !(classeDe(l.compte) >= 1 && classeDe(l.compte) <= 8));
  out.push({
    id: "comptes",
    titre: "Comptes valides",
    ok: !classesInvalides.length,
    bloquant: true,
    detail: classesInvalides.length
      ? `« ${classesInvalides[0].compte} » n'est pas un compte des classes 1 à 8`
      : horsPlan.length
        ? `${horsPlan.map((l) => l.compte).join(", ")} hors de l'extrait du plan — accepté`
        : "Tous les comptes sont au plan SYSCOHADA",
  });

  const lignesTva = lignes.filter((l) => /^44(31|51|52)$/.test(String(l.compte)));
  if (lignesTva.length && Number(taux)) {
    const attendu = Math.abs(
      Math.round(
        (lignes
          .filter((l) => compteTvaPour(l.compte))
          .reduce((s, l) => s + (l.debit - l.credit), 0) *
          Number(taux)) /
          100,
      ),
    );
    const porte = Math.abs(lignesTva.reduce((s, l) => s + (l.debit - l.credit), 0));
    out.push({
      id: "tva",
      titre: "TVA cohérente",
      ok: Math.abs(attendu - porte) <= lignesTva.length,
      bloquant: false,
      detail: `${taux} % de la base = ${attendu}, ${porte} porté en TVA`,
    });
  }

  return out;
};

/// L'écriture à enregistrer à partir d'une saisie par pièce.
export const ecritureDePiece = (piece, numero) => {
  const lignes = lignesUtiles(piece.lignes).map((l) => {
    const out = { compte: String(l.compte), debit: l.debit, credit: l.credit };
    if (l.libelle?.trim()) out.libelle = l.libelle.trim();
    if (l.tiers?.trim()) out.tiers = l.tiers.trim();
    if (l.auto) out.auto = true;
    return out;
  });
  const tiers = piece.tiers?.trim() || lignes.find((l) => l.tiers)?.tiers || "";
  const e = {
    journal: piece.journal || "OD",
    numero,
    date: piece.date,
    libelle: piece.libelle?.trim() || lignes[0]?.libelle || "Pièce",
    piece: piece.reference?.trim() || numero,
    tiers,
    lignes,
  };
  if (piece.reference?.trim()) e.reference = piece.reference.trim();
  if (piece.echeance) e.echeance = piece.echeance;
  if (piece.axe) e.axe = piece.axe;
  if (piece.justificatif?.id) e.justificatif = piece.justificatif;
  return e;
};
