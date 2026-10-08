// Comptabilité — ce qui reste à faire, et la clôture d'une période.
//
// Deux vues d'une même question. Le **pilotage** demande « qu'est-ce qui
// m'attend aujourd'hui ? » ; l'**assistant de clôture** demande « puis-je
// verrouiller ce mois ? ». Les contrôles sont les mêmes, calculés une fois
// ici : opérations des autres applications non comptabilisées, banque non
// rapprochée, règlements non lettrés, compte d'attente non soldé, TVA non
// déclarée.
//
// Un contrôle est **bloquant** quand verrouiller fausserait les livres
// (journal déséquilibré, compte d'attente non soldé, pièces de la période
// encore en attente). Les autres sont des avertissements : on peut clore
// un mois dont un règlement n'est pas lettré, on ne peut pas clore un mois
// dont on ignore où sont passés 45 000 F.

import { controle, lignesDe, postesOuverts } from "./domaine.js";

const f = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR");

const finDuMois = (aaaaMm) =>
  new Date(Date.UTC(Number(aaaaMm.slice(0, 4)), Number(aaaaMm.slice(5, 7)), 0)).toISOString().slice(0, 10);

export const moisPrecedent = (aaaaMm) => {
  const d = new Date(Date.UTC(Number(aaaaMm.slice(0, 4)), Number(aaaaMm.slice(5, 7)) - 2, 1));
  return d.toISOString().slice(0, 7);
};

export const moisSuivant = (aaaaMm) => {
  const d = new Date(Date.UTC(Number(aaaaMm.slice(0, 4)), Number(aaaaMm.slice(5, 7)), 1));
  return d.toISOString().slice(0, 7);
};

/// « octobre 2026 ».
export const nomMois = (aaaaMm, { annee = true } = {}) =>
  new Date(`${aaaaMm}-15T12:00:00Z`).toLocaleDateString("fr-FR", {
    month: "long",
    ...(annee ? { year: "numeric" } : {}),
  });

/// Le mois à clôturer ensuite : celui qui suit la dernière clôture, ou le
/// mois précédant aujourd'hui si rien n'a jamais été clos.
export const moisAClore = (clotureAu, aujourdhui) => {
  if (clotureAu) return moisSuivant(clotureAu.slice(0, 7));
  return moisPrecedent(aujourdhui.slice(0, 7));
};

const solde = (ecritures, compte, au) =>
  Math.round(
    lignesDe(ecritures, { au })
      .filter((l) => String(l.compte).startsWith(compte))
      .reduce((s, l) => s + (Number(l.debit) || 0) - (Number(l.credit) || 0), 0),
  );

/// Règlements non affectés : postes créditeurs d'un compte client (ou
/// débiteurs d'un compte fournisseur) — de l'argent reçu qu'on ne sait
/// rattacher à aucune facture.
export const reglementsNonLettres = (ecritures, lettres, au) => {
  const ctx = au ? { au } : undefined;
  const clients = postesOuverts(ecritures, "411", ctx, { lettres: lettres?.["411"] }).filter((p) => p.solde < 0);
  const fournisseurs = postesOuverts(ecritures, "401", ctx, { lettres: lettres?.["401"] }).filter((p) => p.solde > 0);
  return { clients, fournisseurs, total: clients.length + fournisseurs.length };
};

/// Les contrôles de clôture d'un mois.
///
/// `releves` : { [compte]: { lignes: [{ date, ecriture? }] } }.
/// `tvaDeclarees` : { "AAAA-MM": { le, montant } }.
export const controlesCloture = ({
  mois,
  ecritures = [],
  suggerees = [],
  releves = {},
  lettres = {},
  tvaDeclarees = {},
  comptesBancaires = ["521", "531"],
}) => {
  const au = finDuMois(mois);
  const out = [];

  const equ = controle(ecritures.filter((e) => String((e.data || e).date) <= au));
  out.push({
    id: "equilibre",
    titre: "Journal équilibré",
    ok: equ.equilibre,
    bloquant: true,
    detail: equ.equilibre
      ? "Le total des débits égale celui des crédits"
      : `Écart de ${f(Math.abs(equ.ecart))} F entre débits et crédits`,
  });

  const enAttente = suggerees.filter((s) => String(s.date) <= au);
  const parSource = {};
  for (const s of enAttente) parSource[s.source || "Autre"] = (parSource[s.source || "Autre"] || 0) + 1;
  out.push({
    id: "reprises",
    titre: "Opérations des autres apps comptabilisées",
    ok: !enAttente.length,
    bloquant: true,
    detail: enAttente.length
      ? `${enAttente.length} en attente : ${Object.entries(parSource).map(([k, v]) => `${v} ${k}`).join(", ")}`
      : "Factures, tickets, bulletins, achats et notes de frais sont au journal",
    action: enAttente.length ? { label: "Comptabiliser", section: "atraiter" } : null,
  });

  const nonPointees = [];
  const sansReleve = [];
  for (const compte of comptesBancaires) {
    const r = releves[compte];
    const mouvemente = lignesDe(ecritures, { au }).some((l) => String(l.compte) === compte);
    if (!r?.lignes?.length) {
      if (mouvemente) sansReleve.push(compte);
      continue;
    }
    nonPointees.push(...r.lignes.filter((l) => l.date <= au && !l.ecriture));
  }
  out.push({
    id: "banque",
    titre: "Banques rapprochées",
    ok: !nonPointees.length && !sansReleve.length,
    bloquant: false,
    detail: nonPointees.length
      ? `${nonPointees.length} ligne(s) de relevé non rapprochée(s)`
      : sansReleve.length
        ? `Aucun relevé importé pour ${sansReleve.join(", ")}`
        : `Relevés pointés au ${au.slice(8, 10)}/${au.slice(5, 7)}`,
    action: nonPointees.length || sansReleve.length ? { label: "Rapprocher", section: "banque" } : null,
  });

  const decl = tvaDeclarees[mois];
  out.push({
    id: "tva",
    titre: "Déclaration de TVA préparée",
    ok: !!decl,
    bloquant: false,
    detail: decl
      ? `Déclarée le ${decl.le.split("-").reverse().join("/")} : ${f(decl.montant)} F`
      : `Dépôt avant le 15 ${nomMois(moisSuivant(mois))}`,
    action: decl ? null : { label: "Préparer", section: "tva" },
  });

  const nl = reglementsNonLettres(ecritures, lettres, au);
  out.push({
    id: "lettrage",
    titre: "Comptes de tiers lettrés",
    ok: !nl.total,
    bloquant: false,
    detail: nl.total
      ? `${nl.total} règlement(s) restent à affecter à une facture`
      : "Chaque règlement est rattaché à sa facture",
    action: nl.total ? { label: "Lettrer", section: "tiers" } : null,
  });

  const attente = solde(ecritures, "471", au);
  out.push({
    id: "attente",
    titre: "Compte d'attente 471 soldé",
    ok: !attente,
    bloquant: true,
    detail: attente
      ? `${f(Math.abs(attente))} F à imputer — la période ne se verrouille pas sans`
      : "Rien n'attend d'être imputé",
    action: attente ? { label: "Imputer", section: "saisie", compte: "471" } : null,
  });

  const finExercice = mois.endsWith("-12");
  const annee = mois.slice(0, 4);
  const dotations = lignesDe(ecritures, { du: `${annee}-01-01`, au }).some((l) =>
    /^68|^69/.test(String(l.compte)),
  );
  out.push({
    id: "inventaire",
    titre: "Écritures d'inventaire",
    ok: !finExercice || dotations,
    bloquant: false,
    detail: !finExercice
      ? "À passer à la clôture de l'exercice, en décembre"
      : dotations
        ? "Dotations de l'exercice passées"
        : "Dotations aux amortissements, charges à payer, variation de stock",
    action: finExercice && !dotations ? { label: "Saisir", section: "saisie", journal: "OD" } : null,
  });

  return out;
};

/// Synthèse d'une liste de contrôles.
export const bilanControles = (controles) => {
  const ok = controles.filter((c) => c.ok).length;
  const bloquants = controles.filter((c) => !c.ok && c.bloquant);
  return { ok, total: controles.length, bloquants, verrouillable: !bloquants.length };
};

/// La liste « À traiter » du pilotage, par ordre d'urgence.
export const aTraiter = ({
  suggerees = [],
  releves = {},
  ecritures = [],
  lettres = {},
  tvaDeclarees = {},
  aujourdhui,
  clientsEnRetard = [],
}) => {
  const out = [];

  if (suggerees.length) {
    const parSource = {};
    for (const s of suggerees) parSource[s.source || "Autre"] = (parSource[s.source || "Autre"] || 0) + 1;
    out.push({
      id: "reprises",
      n: suggerees.length,
      ton: "vert",
      titre: `${suggerees.length} opération(s) prêtes à comptabiliser`,
      detail: Object.entries(parSource)
        .map(([k, v]) => `${v} ${k}`)
        .join(" · "),
      action: "Vérifier et valider",
      section: "atraiter",
    });
  }

  const nonPointees = Object.entries(releves).flatMap(([compte, r]) =>
    (r.lignes || []).filter((l) => !l.ecriture).map((l) => ({ ...l, compte })),
  );
  if (nonPointees.length) {
    out.push({
      id: "banque",
      n: nonPointees.length,
      ton: "bleu",
      titre: `${nonPointees.length} ligne(s) de relevé à rapprocher`,
      detail: "Des correspondances sont proposées automatiquement",
      action: "Rapprocher",
      section: "banque",
    });
  }

  const nl = reglementsNonLettres(ecritures, lettres);
  if (nl.total) {
    const noms = [...new Set([...nl.clients, ...nl.fournisseurs].map((p) => p.tiers).filter(Boolean))];
    out.push({
      id: "lettrage",
      n: nl.total,
      ton: "orange",
      titre: `${nl.total} règlement(s) non lettré(s)`,
      detail: noms.length ? noms.slice(0, 3).join(", ") + (noms.length > 3 ? "…" : "") : "Sans tiers",
      action: "Lettrer",
      section: "tiers",
    });
  }

  const attente = solde(ecritures, "471");
  if (attente) {
    out.push({
      id: "attente",
      n: "471",
      ton: "rouge",
      titre: "Compte d'attente 471 non soldé",
      detail: `${f(Math.abs(attente))} F à imputer avant la clôture`,
      action: "Imputer",
      section: "saisie",
      compte: "471",
    });
  }

  const precedent = moisPrecedent(aujourdhui.slice(0, 7));
  if (!tvaDeclarees[precedent]) {
    const enRetard = Number(aujourdhui.slice(8, 10)) > 15;
    out.push({
      id: "tva",
      n: "TVA",
      ton: enRetard ? "rouge" : "gris",
      titre: `Déclaration de TVA de ${nomMois(precedent, { annee: false })}`,
      detail: enRetard
        ? "Le dépôt était dû le 15 : à régulariser au plus vite"
        : `À déposer avant le 15 ${nomMois(aujourdhui.slice(0, 7))}`,
      action: "Préparer",
      section: "tva",
      mois: precedent,
    });
  }

  if (clientsEnRetard.length) {
    const total = clientsEnRetard.reduce((s, c) => s + c.montant, 0);
    out.push({
      id: "relances",
      n: clientsEnRetard.length,
      ton: "orange",
      titre: `${clientsEnRetard.length} client(s) en retard de paiement`,
      detail: `${f(total)} F échus depuis plus de 30 jours`,
      action: "Relancer",
      section: "tiers",
    });
  }

  const sansJustif = ecritures.filter((e) => {
    const d = e.data || e;
    return !d.origine && !d.contrepasse && !d.justificatif && d.numero && ["ACH", "OD"].includes(d.journal);
  });
  if (sansJustif.length) {
    out.push({
      id: "justificatifs",
      n: sansJustif.length,
      ton: "gris",
      titre: `${sansJustif.length} pièce(s) sans justificatif`,
      detail: "Achats et opérations diverses saisis sans facture jointe",
      action: "Joindre",
      section: "journal",
      filtre: "sansJustificatif",
    });
  }

  return out;
};
