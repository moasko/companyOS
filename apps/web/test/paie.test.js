import test from "node:test";
import assert from "node:assert/strict";

import {
  REGLAGES_DEFAUT,
  anneesDeService,
  bulletin,
  completer,
  ecritureDeBulletin,
  itsBrut,
  tauxDAnciennete,
} from "../src/apps/modules/paie/domaine.js";
import {
  absencesDuMois,
  controles,
  cumulsAnnuels,
  declarations,
  etapeCourante,
  fraisARembourser,
  joursOuvrables,
  modeParDefaut,
  netVersBrut,
  ordreDeVirement,
  paiements,
  prorataDe,
  saisieInitiale,
  statutLigne,
} from "../src/apps/modules/paie/cycle.js";

const somme = (lignes, f) => lignes.reduce((s, l) => s + l[f], 0);

test("barème ITS progressif", () => {
  assert.equal(itsBrut(75000), 0);
  assert.equal(itsBrut(300000), 26400 + 12600);
});

test("ancienneté : 2 % après 2 ans, +1 % par an, plafond 25 %", () => {
  assert.equal(anneesDeService("2022-02-03", "2026-10"), 4);
  assert.equal(anneesDeService("2024-11-15", "2026-10"), 1);
  assert.equal(tauxDAnciennete(1), 0);
  assert.equal(tauxDAnciennete(2), 2);
  assert.equal(tauxDAnciennete(4), 4);
  assert.equal(tauxDAnciennete(40), 25);
  assert.equal(tauxDAnciennete(10, { anciennete: { actif: false } }), 0);
});

test("bulletin complet : absences, heures sup, ancienneté, transport, avance", () => {
  const b = bulletin(
    { salaireBase: 650000, dateEmbauche: "2022-02-03" },
    { mois: "2026-10", situation: "marie", enfants: 2, absences: { injustifiee: 2 }, indemnites: 30000, retenues: 50000, heuresSup: { h15: 6 } },
  );
  assert.equal(b.retenueAbsences, 50000); // 650 000 × 2 / 26
  assert.equal(b.primeAnciennete, 26000); // 4 %
  assert.equal(b.heuresSup, Math.round(6 * (650000 / 173.33) * 1.15));
  assert.equal(b.brut, 650000 - 50000 + 26000 + b.heuresSup);
  assert.equal(b.net, b.brut + 30000 - b.cotisationsSalariales - b.its - 50000);
  // Prestations familiales et AT sur l'assiette plafonnée à 70 000.
  assert.equal(b.cotisations.detail.prestationsFamiliales, Math.round(70000 * 0.0575));
  assert.equal(b.fdfp, Math.round(b.brut * 0.016));
  const codes = b.rubriques.map((r) => r.code);
  assert.deepEqual(codes.slice(0, 5), ["100", "120", "130", "150", "199"]);
});

test("prorata d'entrée et frais remboursés hors impôt", () => {
  const b = bulletin({ salaireBase: 260000 }, { prorata: { jours: 13, sur: 26 }, frais: 28000 });
  assert.equal(b.retenueProrata, 130000);
  assert.equal(b.brut, 130000);
  assert.equal(b.frais, 28000);
  assert.equal(b.coutTotal, b.brut + b.chargesPatronales);
  assert.ok(b.net > b.brut - b.cotisationsSalariales - b.its);
});

test("réglages anciens complétés (et Infinity restauré après JSON)", () => {
  const r = completer(JSON.parse(JSON.stringify({ cnps: { retraiteSalarie: 6.3 }, its: REGLAGES_DEFAUT.its })));
  assert.equal(r.cnps.plafondPrestations, 70000);
  assert.equal(r.its[r.its.length - 1].jusqua, Infinity);
  assert.equal(r.fdfp.apprentissage, 0.4);
});

test("écriture de paie équilibrée, FDFP en 641", () => {
  const b = bulletin({ salaireBase: 500000 }, { indemnites: 30000, frais: 10000, retenues: 20000 });
  const e = ecritureDeBulletin(b, { prenom: "A", nom: "B", matricule: "M1" }, "2026-10");
  assert.equal(somme(e.lignes, "debit"), somme(e.lignes, "credit"));
  assert.equal(e.lignes.find((l) => l.compte === "641").debit, b.fdfp);
  assert.equal(e.date, "2026-10-31");
});

test("jours ouvrables et prorata", () => {
  assert.equal(joursOuvrables("2026-10-01", "2026-10-31"), 27);
  const p = prorataDe({ dateEmbauche: "2026-10-14" }, "2026-10");
  assert.equal(p.jours, 16);
  assert.equal(p.sur, 27);
  assert.equal(prorataDe({ dateEmbauche: "2020-01-01" }, "2026-10"), null);
});

test("absences de Congés comptées dans le mois seulement", () => {
  const absences = [
    { id: "a1", data: { salarieId: "s1", type: "injustifiee", etat: "approuve", du: "2026-10-12", au: "2026-10-13" } },
    { id: "a2", data: { salarieId: "s1", type: "conge", etat: "approuve", du: "2026-09-28", au: "2026-10-03" } },
    { id: "a3", data: { salarieId: "s1", type: "conge", etat: "demande", du: "2026-10-20", au: "2026-10-22" } },
  ];
  const a = absencesDuMois(absences, "s1", "2026-10");
  assert.equal(a.injustifiee, 2);
  assert.equal(a.conge, 3);
  assert.equal(a.liste.length, 2);
});

test("frais approuvés seulement, et moyen de paiement par défaut", () => {
  const notes = [
    { id: "n1", data: { salarieId: "s1", etat: "approuvee", montant: 28000 } },
    { id: "n2", data: { salarieId: "s1", etat: "remboursee", montant: 5000 } },
    { id: "n3", data: { salarieId: "s1", etat: "soumise", montant: 9000 } },
  ];
  assert.deepEqual(fraisARembourser(notes, "s1"), { total: 28000, ids: ["n1"] });
  assert.equal(modeParDefaut({ banque: "SGBCI" }), "virement");
  assert.equal(modeParDefaut({ telephone: "07" }), "mobile");
  assert.equal(modeParDefaut({}), "especes");
});

test("saisie initiale : reprend le mois précédent, les absences et le transport", () => {
  const salarie = { id: "s1", data: { matricule: "M1", salaireBase: 300000, banque: "NSIA" } };
  const bulletins = [{ id: "b0", data: { mois: "2026-09", matricule: "M1", saisie: { situation: "marie", enfants: 3, indemnites: 25000 } } }];
  const absences = [{ id: "a1", data: { salarieId: "s1", type: "sansSolde", etat: "approuve", du: "2026-10-05", au: "2026-10-05" } }];
  const s = saisieInitiale({ salarie, mois: "2026-10", bulletins, absences });
  assert.equal(s.situation, "marie");
  assert.equal(s.enfants, 3);
  assert.equal(s.indemnites, 25000);
  assert.equal(s.absences.sansSolde, 1);
  assert.equal(s.modePaiement, "virement");
  const neuf = saisieInitiale({ salarie, mois: "2026-10" });
  assert.equal(neuf.indemnites, 30000);
});

test("contrôles et statut des lignes", () => {
  const ligne = (id, data, saisie, calcul, enregistre = true) => ({ salarie: { id, data }, saisie: { mois: "2026-10", ...saisie }, calcul, enregistre });
  const lignes = [
    ligne("s1", { matricule: "M1", salaireBase: 500000, numeroCnps: "1" }, { modePaiement: "virement" }, { net: 400000, brut: 500000 }),
    ligne("s2", { matricule: "M2", salaireBase: 500000, banque: "X", numeroCnps: "2" }, { modePaiement: "virement" }, { net: 560000, brut: 600000 }),
    ligne("s3", { matricule: "M3", salaireBase: 100000, banque: "X", numeroCnps: "3" }, { modePaiement: "virement" }, { net: -10, brut: 0 }),
  ];
  const c = controles({ lignes, precedents: new Map([["M2", { net: 400000 }]]) });
  assert.equal(c[0].code, "netNegatif");
  assert.ok(c.some((x) => x.cle === "M1" && x.code === "sansBanque"));
  assert.ok(c.some((x) => x.cle === "M2" && x.code === "variation" && x.pourcent === 40));
  assert.equal(statutLigne("M3", c), "bloque");
  assert.equal(statutLigne("M1", c), "verifier");
});

test("paiements, déclarations, ordre de virement, DISA", () => {
  const b1 = bulletin({ salaireBase: 500000 }, {});
  const b2 = bulletin({ salaireBase: 200000 }, {});
  const lignes = [
    { salarie: { data: { matricule: "M1", prenom: "A", nom: "B", banque: "SGBCI" } }, saisie: { modePaiement: "virement" }, calcul: b1 },
    { salarie: { data: { matricule: "M2", prenom: "C", nom: "D" } }, saisie: { modePaiement: "mobile" }, calcul: b2 },
  ];
  const p = paiements(lignes);
  assert.equal(p.virement.total, b1.net);
  assert.equal(p.mobile.liste.length, 1);
  const d = declarations([b1, b2], "2026-10");
  assert.equal(d.its.montant, b1.its + b2.its);
  assert.equal(d.cnps.echeance, "2026-11-15");
  assert.equal(d.cnps.montant, b1.cotisations.salariale + b1.cotisations.patronale + b2.cotisations.salariale + b2.cotisations.patronale);
  const ov = ordreDeVirement(lignes, "2026-10");
  assert.equal(ov.length, 2);
  assert.equal(ov[1][3], b1.net);
  const disa = cumulsAnnuels([
    { data: { mois: "2026-09", matricule: "M1", calcul: b1 } },
    { data: { mois: "2026-10", matricule: "M1", calcul: b1 } },
    { data: { mois: "2025-12", matricule: "M1", calcul: b1 } },
  ], 2026);
  assert.equal(disa[0].mois, 2);
  assert.equal(disa[0].brut, b1.brut * 2);
});

test("simulateur net → brut retrouve le brut", () => {
  const b = bulletin({ salaireBase: 700000 }, { situation: "marie", enfants: 2, personnesCmu: 1 });
  const brut = netVersBrut(b.net, { situation: "marie", enfants: 2 });
  assert.ok(Math.abs(brut - 700000) <= 2);
});

test("étape courante du cycle", () => {
  assert.equal(etapeCourante(null, 0, false), "variables");
  assert.equal(etapeCourante(null, 2, true), "controles");
  assert.equal(etapeCourante(null, 0, true), "validation");
  assert.equal(etapeCourante({ etat: "valide" }, 0, true), "paiement");
  assert.equal(etapeCourante({ etat: "declare" }, 0, true), "termine");
});

test("textes : chaque clé existe en français et en anglais, et chaque t() est traduit", async () => {
  const { TEXTES } = await import("../src/apps/modules/paie/textes.js");
  const fs = await import("node:fs");
  const fr = Object.keys(TEXTES.fr).sort();
  const en = Object.keys(TEXTES.en).sort();
  assert.deepEqual(fr.filter((k) => !TEXTES.en[k]), []);
  assert.deepEqual(en.filter((k) => !TEXTES.fr[k]), []);
  const dossier = new URL("../src/apps/modules/paie/", import.meta.url);
  const utilisees = new Set();
  for (const f of fs.readdirSync(dossier).filter((x) => x.endsWith(".jsx"))) {
    const src = fs.readFileSync(new URL(f, dossier), "utf8");
    for (const m of src.matchAll(/\bt\("([A-Za-z_]+)"/g)) utilisees.add(m[1]);
  }
  assert.deepEqual([...utilisees].filter((k) => !TEXTES.fr[k]), []);
});
