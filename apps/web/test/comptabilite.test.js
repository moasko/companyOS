import test from "node:test";
import assert from "node:assert/strict";

import { balanceAgee, postesOuverts } from "../src/apps/modules/comptabilite/domaine.js";
import {
  avecTva,
  chercherComptes,
  controlesPiece,
  ecritureDePiece,
  journalDe,
  prochainNumero,
  soldeSur,
  trousNumerotation,
} from "../src/apps/modules/comptabilite/journaux.js";
import {
  ecritureDeLigne,
  etatRapprochement,
  fusionnerReleve,
  lireMontant,
  lireReleve,
  lignesTresorerie,
  rapprocher,
  regleDe,
} from "../src/apps/modules/comptabilite/banque.js";
import {
  indexLettres,
  lignesLettrage,
  prochaineLettre,
  propositionsLettrage,
  totauxSelection,
} from "../src/apps/modules/comptabilite/lettrage.js";
import {
  bilanSyscohada,
  compteDeResultatSyscohada,
  fluxTresorerie,
  tresorerieParMois,
} from "../src/apps/modules/comptabilite/etats.js";
import { aTraiter, bilanControles, controlesCloture, moisAClore } from "../src/apps/modules/comptabilite/cloture.js";

const E = (id, data) => ({ id, data });

const journal = [
  E("e1", { date: "2026-01-10", libelle: "Apport", journal: "OD", numero: "OD-2026-0001", lignes: [
    { compte: "521", debit: 1000000, credit: 0 }, { compte: "101", debit: 0, credit: 1000000 }] }),
  E("e2", { date: "2026-09-01", libelle: "Facture FAC-1", piece: "FAC-1", tiers: "Cansaas", origine: "facture:f1", echeance: "2026-09-30", lignes: [
    { compte: "411", debit: 590000, credit: 0 }, { compte: "706", debit: 0, credit: 500000 }, { compte: "4431", debit: 0, credit: 90000 }] }),
  E("e3", { date: "2026-09-20", libelle: "Règlement FAC-1", piece: "FAC-1", tiers: "Cansaas", lignes: [
    { compte: "521", debit: 295000, credit: 0 }, { compte: "411", debit: 0, credit: 295000 }] }),
  E("e4", { date: "2026-09-25", libelle: "Salaires", origine: "paie:2026-09:A", lignes: [
    { compte: "661", debit: 200000, credit: 0 }, { compte: "521", debit: 0, credit: 200000 }] }),
  E("e5", { date: "2026-09-26", libelle: "Achat ordinateur", journal: "ACH", numero: "ACH-2026-0003", lignes: [
    { compte: "244", debit: 300000, credit: 0 }, { compte: "521", debit: 0, credit: 300000 }] }),
];

// ---------------------------------------------------------------------------
// Journaux et saisie
// ---------------------------------------------------------------------------

test("journal déduit de l'origine ou des comptes pour les anciennes écritures", () => {
  assert.equal(journalDe(journal[1]), "VTE");
  assert.equal(journalDe(journal[2]), "BQ");
  assert.equal(journalDe(journal[3]), "OD");
  assert.equal(journalDe(journal[4]), "ACH");
});

test("numérotation continue : on repart du plus grand numéro du journal et de l'année", () => {
  assert.equal(prochainNumero(journal, "ACH", "2026-10-01"), "ACH-2026-0004");
  assert.equal(prochainNumero(journal, "VTE", "2026-10-01"), "VTE-2026-0001");
  assert.equal(prochainNumero(journal, "ACH", "2027-01-02"), "ACH-2027-0001");
  assert.deepEqual(trousNumerotation(journal), ["ACH-2026-0001", "ACH-2026-0002"]);
});

test("recherche de compte par numéro, par mot, et compte hors plan accepté", () => {
  assert.equal(chercherComptes("706")[0].code, "706");
  assert.ok(chercherComptes("banc").some((c) => c.code === "631"));
  const hors = chercherComptes("6011");
  assert.equal(hors[0].code, "6011");
  assert.equal(hors[0].horsPlan, true);
});

test("« = » solde la pièce sur la ligne choisie", () => {
  const lignes = [{ compte: "411", debit: "590000" }, { compte: "706", credit: "500000" }, { compte: "4431" }];
  assert.deepEqual(soldeSur(lignes, 2), { debit: 0, credit: 90000 });
});

test("TVA automatique : recalculée à chaque changement, du bon côté", () => {
  const vente = avecTva([{ compte: "411", debit: 590000 }, { compte: "706", credit: 500000 }], 18);
  assert.deepEqual(vente[2], { compte: "4431", libelle: "TVA 18 %", debit: 0, credit: 90000, auto: true });
  const achat = avecTva([...vente.slice(0, 1), { compte: "605", debit: 100000 }, { auto: true, compte: "4431" }], 18);
  assert.equal(achat.length, 3);
  assert.equal(achat[2].compte, "4452");
  assert.equal(achat[2].debit, 18000);
  assert.equal(avecTva(vente, 0).length, 2);
});

test("contrôles d'une pièce : équilibre, période, tiers", () => {
  const piece = {
    date: "2026-09-10",
    lignes: [{ compte: "411", debit: 590000 }, { compte: "706", credit: 500000 }, { compte: "4431", credit: 90000, auto: true }],
  };
  const c = controlesPiece(piece, { clotureAu: "2026-09-30", taux: 18 });
  const par = Object.fromEntries(c.map((x) => [x.id, x]));
  assert.equal(par.equilibre.ok, true);
  assert.equal(par.periode.ok, false);
  assert.equal(par.tiers.ok, false);
  assert.equal(par.tva.ok, true);
  const ok = controlesPiece({ ...piece, date: "2026-10-02", tiers: "Cansaas" }, { clotureAu: "2026-09-30" });
  assert.ok(ok.filter((x) => x.bloquant).every((x) => x.ok));
});

test("écriture d'une pièce : lignes vides écartées, référence en pièce", () => {
  const e = ecritureDePiece(
    { journal: "VTE", date: "2026-10-02", libelle: "Facture", reference: "FAC-9", tiers: "Cansaas", lignes: [
      { compte: "411", debit: "1 000" }, { compte: "706", credit: "1000" }, { compte: "", debit: "" }] },
    "VTE-2026-0001",
  );
  assert.equal(e.lignes.length, 2);
  assert.equal(e.lignes[0].debit, 1000);
  assert.equal(e.piece, "FAC-9");
  assert.equal(e.numero, "VTE-2026-0001");
});

// ---------------------------------------------------------------------------
// Banque
// ---------------------------------------------------------------------------

test("montants à la française", () => {
  assert.equal(lireMontant("1 234 567,50"), 1234567.5);
  assert.equal(lireMontant("-6 500"), -6500);
  assert.equal(lireMontant("6.500,00"), 6500);
  assert.equal(lireMontant("(48 300)"), -48300);
});

test("relevé CSV : en-tête décalé, colonnes débit et crédit, solde", () => {
  const csv = [
    "SGBCI - Compte courant;;;;",
    "Date opération;Libellé;Débit;Crédit;Solde",
    "05/10/2026;VIR RECU CANSAAS FAC-1;;295 000;800 000",
    "02/10/2026;PRLV CIE ELECTRICITE;48 300;;505 000",
    "01/10/2026;FRAIS TENUE DE COMPTE;6 500;;553 300",
  ].join("\n");
  const r = lireReleve(csv, "releve.csv");
  assert.equal(r.lignes.length, 3);
  assert.equal(r.lignes[0].date, "2026-10-01");
  assert.equal(r.lignes[0].montant, -6500);
  assert.equal(r.lignes[2].montant, 295000);
  assert.equal(r.du, "2026-10-01");
  assert.equal(typeof r.lignes[0].id, "string");
  // Réimporter n'ajoute rien.
  assert.equal(fusionnerReleve(r.lignes, lireReleve(csv).lignes).ajoutees, 0);
});

test("relevé OFX", () => {
  const ofx = `<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261002<TRNAMT>-48300.00<FITID>A1<NAME>PRLV CIE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005<TRNAMT>295000<FITID>A2<NAME>VIR CANSAAS</STMTTRN></BANKTRANLIST>
<LEDGERBAL><BALAMT>800000</LEDGERBAL></OFX>`;
  const r = lireReleve(ofx, "x.ofx");
  assert.equal(r.lignes.length, 2);
  assert.equal(r.solde, 800000);
  assert.equal(r.lignes[0].reference, "A1");
});

test("règles : mot entier, règles de l'utilisateur d'abord", () => {
  assert.equal(regleDe("PRLV CIE ELECTRICITE").compte, "605");
  assert.equal(regleDe("VIR AGENCIER"), null);
  assert.equal(regleDe("FRAIS TENUE", [{ contient: "TENUE", compte: "6318" }]).compte, "6318");
});

test("rapprochement : même montant, mots communs, une seule fois chacun", () => {
  const releve = [
    { id: "r1", date: "2026-09-21", libelle: "VIR RECU CANSAAS", montant: 295000 },
    { id: "r2", date: "2026-10-01", libelle: "FRAIS TENUE DE COMPTE", montant: -6500 },
    { id: "r3", date: "2026-09-25", libelle: "VIREMENT SALAIRES", montant: -200000, ecriture: "e4#1" },
  ];
  const comptables = lignesTresorerie(journal, "521");
  const p = rapprocher({ releve, comptables, pointees: new Set(["e4#1"]) });
  assert.equal(p.length, 2);
  assert.equal(p[0].type, "correspondance");
  assert.equal(p[0].comptable.cle, "e3#0");
  assert.match(p[0].raison, /CANSAAS/);
  assert.equal(p[1].type, "creer");
  assert.equal(p[1].regle.compte, "631");

  const e = ecritureDeLigne({ ligne: releve[1], compteBanque: "521", compte: "631" });
  assert.deepEqual(e.lignes, [{ compte: "631", debit: 6500, credit: 0 }, { compte: "521", debit: 0, credit: 6500 }]);

  const etat = etatRapprochement({ releve, soldeReleve: 790000, ecritures: journal, compte: "521" });
  assert.equal(etat.pointees, 1);
  assert.equal(etat.soldeComptable, 795000);
  assert.equal(etat.ecart, -5000);
});

// ---------------------------------------------------------------------------
// Lettrage et postes ouverts
// ---------------------------------------------------------------------------

test("lettrage : implicite par pièce, manuel total, lettre suivante", () => {
  const solde = [...journal, E("e6", { date: "2026-09-28", libelle: "Solde FAC-1", piece: "FAC-1", tiers: "Cansaas", lignes: [
    { compte: "521", debit: 295000, credit: 0 }, { compte: "411", debit: 0, credit: 295000 }] })];
  const l = lignesLettrage(solde, "411");
  assert.ok(l.every((x) => x.lettre === "auto"));

  const virement = E("e7", { date: "2026-10-02", libelle: "Virement reçu", tiers: "Cansaas", lignes: [
    { compte: "521", debit: 295000, credit: 0 }, { compte: "411", debit: 0, credit: 295000, tiers: "Cansaas" }] });
  const avec = [...journal, virement];
  const sans = lignesLettrage(avec, "411");
  assert.ok(sans.every((x) => !x.lettre));
  // Le virement isolé fait un poste créditeur : 295 000 restent sur FAC-1.
  assert.equal(postesOuverts(avec, "411").length, 2);

  const lettrages = [{ id: "L1", data: { compte: "411", lettre: "A", lignes: ["e2#0", "e3#1", "e7#1"] } }];
  assert.equal(postesOuverts(avec, "411", undefined, { lettres: indexLettres(lettrages, "411") }).length, 0);
  assert.equal(prochaineLettre(lettrages, "411"), "B");
  assert.equal(prochaineLettre([], "411"), "A");
  const t = totauxSelection(sans);
  assert.equal(t.total, true);
});

test("propositions de lettrage : seulement les couples sans ambiguïté", () => {
  const lignes = [
    { cle: "a", tiers: "Yao", debit: 147500, credit: 0, piece: "FAC-5" },
    { cle: "b", tiers: "Yao", debit: 0, credit: 147500, libelle: "Virement", date: "2026-09-23" },
    { cle: "c", tiers: "Koné", debit: 100, credit: 0 },
    { cle: "d", tiers: "Koné", debit: 100, credit: 0 },
    { cle: "e", tiers: "Koné", debit: 0, credit: 100 },
  ];
  const p = propositionsLettrage(lignes);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].lignes, ["a", "b"]);
});

test("balance âgée comptée depuis l'échéance", () => {
  const b = balanceAgee(journal, "411", undefined, "2026-10-10");
  assert.equal(b[0].total, 295000);
  assert.equal(b[0].j30, 295000); // échéance 30/09 : 10 jours de retard
});

// ---------------------------------------------------------------------------
// États SYSCOHADA
// ---------------------------------------------------------------------------

test("compte de résultat SYSCOHADA : rubriques et soldes intermédiaires", () => {
  const cr = compteDeResultatSyscohada(journal, { du: "2026-01-01", au: "2026-12-31" });
  const v = Object.fromEntries(cr.lignes.map((l) => [l.ref, l.montant]));
  assert.equal(v.TC, 500000);
  assert.equal(v.XB, 500000);
  assert.equal(v.RK, -200000);
  assert.equal(v.XD, 300000);
  assert.equal(v.XI, 300000);
  assert.deepEqual(cr.lignes.find((l) => l.ref === "RK").comptes, ["661"]);
});

test("bilan SYSCOHADA équilibré, résultat en CJ", () => {
  const b = bilanSyscohada(journal, { du: "2026-01-01", au: "2026-12-31" });
  const a = Object.fromEntries(b.actif.map((l) => [l.ref, l.montant]));
  const p = Object.fromEntries(b.passif.map((l) => [l.ref, l.montant]));
  assert.equal(a.AI, 300000);
  assert.equal(a.BI, 295000);
  assert.equal(a.BS, 795000);
  assert.equal(p.CA, 1000000);
  assert.equal(p.CJ, 300000);
  assert.equal(p.DK, 90000);
  assert.equal(b.equilibre, true);
  assert.equal(b.totalActif, 1390000);
});

test("résultat d'un exercice antérieur non affecté : en report à nouveau", () => {
  const b = bilanSyscohada(journal, { du: "2027-01-01", au: "2027-12-31" });
  const p = Object.fromEntries(b.passif.map((l) => [l.ref, l.montant]));
  assert.equal(p.CJ, 0);
  assert.equal(p.CH, 300000);
  assert.equal(b.equilibre, true);
});

test("flux de trésorerie : opérationnel, investissement, financement", () => {
  const f = fluxTresorerie(journal, { du: "2026-01-01", au: "2026-12-31" });
  const v = Object.fromEntries(f.lignes.map((l) => [l.ref, l.montant]));
  assert.equal(v.ZA, 0);
  assert.equal(v.ZB, 95000);
  assert.equal(v.ZC, -300000);
  assert.equal(v.ZD, 1000000);
  assert.equal(v.ZH, 795000);
  const sep = fluxTresorerie(journal, { du: "2026-09-01", au: "2026-09-30" });
  assert.equal(sep.lignes[0].montant, 1000000);
});

test("trésorerie en fin de mois", () => {
  const t = tresorerieParMois(journal, "2026-09", 3);
  assert.deepEqual(t.map((x) => x.total), [1000000, 1000000, 795000]);
});

// ---------------------------------------------------------------------------
// Clôture et pilotage
// ---------------------------------------------------------------------------

test("clôture : le 471 et les reprises en attente bloquent, le lettrage avertit", () => {
  const attente = [...journal, E("e8", { date: "2026-09-29", libelle: "Inconnu", lignes: [
    { compte: "471", debit: 45000, credit: 0 }, { compte: "521", debit: 0, credit: 45000 }] })];
  const c = controlesCloture({
    mois: "2026-09",
    ecritures: attente,
    suggerees: [{ date: "2026-09-15", source: "Caisse" }, { date: "2026-10-02", source: "Caisse" }],
    releves: {},
  });
  const par = Object.fromEntries(c.map((x) => [x.id, x]));
  assert.equal(par.attente.ok, false);
  assert.equal(par.reprises.ok, false);
  assert.match(par.reprises.detail, /1 en attente/);
  assert.equal(par.banque.ok, false);
  const s = bilanControles(c);
  assert.equal(s.verrouillable, false);

  const propre = controlesCloture({ mois: "2026-09", ecritures: journal, tvaDeclarees: { "2026-09": { le: "2026-10-10", montant: 1 } }, releves: { 521: { lignes: [{ date: "2026-09-20", ecriture: "e3#0" }] } } });
  assert.equal(bilanControles(propre).verrouillable, true);
});

test("mois à clore et liste à traiter", () => {
  assert.equal(moisAClore("2026-08-31", "2026-10-08"), "2026-09");
  assert.equal(moisAClore("", "2026-10-08"), "2026-09");
  const t = aTraiter({
    suggerees: [{ source: "Facturation" }, { source: "Facturation" }, { source: "Paie" }],
    releves: { 521: { lignes: [{ date: "2026-10-01" }] } },
    ecritures: journal,
    aujourdhui: "2026-10-08",
  });
  assert.deepEqual(t.map((x) => x.id), ["reprises", "banque", "tva", "justificatifs"]);
  assert.equal(t[0].detail, "2 Facturation · 1 Paie");
});
