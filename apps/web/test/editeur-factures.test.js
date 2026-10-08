import test from "node:test";
import assert from "node:assert/strict";

import { totaux } from "@companyos/shared/facturation";
import {
  chiffres,
  dateSuivante,
  depuisFacturation,
  echeanceSelon,
  factureVide,
  montantEnLettres,
  montantsEcheancier,
  nombreEnLettres,
  problemes,
  recurrencesDues,
  versFacturation,
} from "../src/apps/modules/editeur-factures/domaine.js";

const exemple = () => ({
  ...factureVide(),
  date: "2026-10-08",
  numero: "FAC-2026-0101",
  clientNom: "Cansaas Agency",
  remise: 5,
  livraison: 10000,
  lignes: [
    { id: "a", designation: "Site web", qte: 2, pu: 500000, tva: 18 },
    { id: "b", designation: "Identité visuelle", qte: 1, pu: 250000, tva: 18 },
    { id: "c", designation: "", qte: 1, pu: 0, tva: 18 },
  ],
});

test("échéance selon les conditions de paiement", () => {
  assert.equal(echeanceSelon("reception", "2026-10-08"), "2026-10-08");
  assert.equal(echeanceSelon("net30", "2026-10-08"), "2026-11-07");
  assert.equal(echeanceSelon("finMois", "2026-02-10"), "2026-02-28");
  assert.equal(echeanceSelon("inconnue", "2026-10-08"), "2026-10-08");
});

test("les chiffres sont ceux du modèle partagé de la Facturation", () => {
  const f = exemple();
  const c = chiffres(f);
  assert.equal(c.sousTotal, 1250000);
  assert.equal(c.remise, 62500);
  // TVA sur les articles remisés, pas sur la livraison.
  assert.equal(c.tva, Math.round(1187500 * 0.18));
  assert.equal(c.livraison, 10000);
  assert.equal(c.total, 1187500 + 213750 + 10000);
  assert.equal(c.total, totaux(versFacturation(f)).ttc);
});

test("versFacturation : lignes vides retirées, livraison en ligne sans TVA", () => {
  const doc = versFacturation(exemple());
  assert.equal(doc.lignes.length, 3);
  assert.ok(doc.lignes.every((l) => !("id" in l)));
  const livraison = doc.lignes.find((l) => l.livraison);
  assert.deepEqual([livraison.pu, livraison.tva, livraison.remise], [10000, 0, 0]);
  assert.equal(doc.remiseGlobale, 0);
  assert.equal(doc.echeancier, undefined);
  assert.equal(doc.editeur, true);
});

test("aller-retour Facturation → éditeur sans perte", () => {
  const f = { ...exemple(), mode: "fractionne" };
  const doc = versFacturation(f);
  const retour = depuisFacturation(doc);
  assert.equal(retour.remise, 5);
  assert.equal(retour.livraison, 10000);
  assert.equal(retour.lignes.length, 2);
  assert.equal(retour.mode, "fractionne");
  assert.equal(chiffres(retour).total, chiffres(f).total);
});

test("échéancier : la dernière échéance absorbe l'arrondi", () => {
  const e = montantsEcheancier([{ pourcentage: 33.33 }, { pourcentage: 33.33 }, { pourcentage: 33.34 }], 1000001);
  assert.equal(e.reduce((s, x) => s + x.montant, 0), 1000001);
});

test("récurrences : mois courts et échéances dues", () => {
  assert.equal(dateSuivante("2026-01-31", "mensuel"), "2026-02-28");
  assert.equal(dateSuivante("2026-02-28", "mensuel", 31), "2026-03-31");
  assert.equal(dateSuivante("2026-10-08", "hebdo"), "2026-10-15");
  const dues = recurrencesDues([
    { data: { prochaine: "2026-10-01" } },
    { data: { prochaine: "2026-11-01" } },
    { data: { prochaine: "2026-10-01", actif: false } },
    { data: { prochaine: "2026-10-01", fin: "2026-09-30" } },
  ], "2026-10-08");
  assert.equal(dues.length, 1);
});

test("problèmes bloquants", () => {
  assert.deepEqual(problemes(exemple()), []);
  const vide = { ...factureVide(), numero: "" };
  const p = problemes(vide);
  assert.ok(p.includes("Choisissez le client à facturer."));
  assert.ok(p.includes("Ajoutez au moins un article."));
  const fract = { ...exemple(), mode: "fractionne", echeancier: [{ pourcentage: 50 }, { pourcentage: 40 }] };
  assert.ok(problemes(fract).some((x) => x.includes("90 %")));
});

test("montant en lettres", () => {
  assert.equal(nombreEnLettres(0), "zéro");
  assert.equal(nombreEnLettres(71), "soixante et onze");
  assert.equal(nombreEnLettres(80), "quatre-vingts");
  assert.equal(nombreEnLettres(81), "quatre-vingt-un");
  assert.equal(nombreEnLettres(200), "deux cents");
  assert.equal(nombreEnLettres(80000), "quatre-vingt mille");
  assert.equal(nombreEnLettres(2200000), "deux millions deux cent mille");
  assert.match(montantEnLettres(1569400), /^un million cinq cent soixante-neuf mille quatre cents francs CFA$/i);
});
