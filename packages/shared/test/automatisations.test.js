import { test } from "node:test";
import assert from "node:assert/strict";

import {
  conditionVraie,
  conditionsVraies,
  declencheurCorrespond,
  RECETTES,
  remplir,
  validerAutomatisation,
  valeurA,
} from "../src/automatisations.js";

const ctx = {
  id: "f1",
  evenement: "modification",
  fiche: {
    libelle: "Flotte",
    montant: 20000,
    etape: "gagnee",
    tags: ["vip"],
    liens: { clientId: "c1" },
  },
  avant: { libelle: "Flotte", montant: 20000, etape: "negociation" },
  lie: { numero: "FAC-1" },
  auteur: { id: "u1", nom: "Awa" },
  maintenant: "2026-10-10T08:00:00.000Z",
};

test("gabarits : champs, dates, type conservé", () => {
  assert.equal(
    remplir("Passation — {{fiche.libelle}} ({{lie.numero}})", ctx),
    "Passation — Flotte (FAC-1)",
  );
  assert.equal(remplir("{{fiche.montant}}", ctx), 20000);
  assert.equal(remplir("{{fiche.liens.clientId}}", ctx), "c1");
  assert.equal(remplir("{{fiche.id}}", ctx), "f1");
  assert.equal(remplir("{{date}}", ctx), "2026-10-10");
  assert.equal(remplir("{{date:+90}}", ctx), "2027-01-08");
  assert.equal(remplir("{{date:-1}}", ctx), "2026-10-09");
  assert.equal(remplir("par {{auteur.nom}}", ctx), "par Awa");
  assert.equal(remplir("{{fiche.inconnu}}x", ctx), "x");
  assert.equal(remplir("{{process.env}}", ctx), "");
});

test("gabarits : jamais le prototype", () => {
  assert.equal(valeurA({ a: 1 }, "__proto__"), undefined);
  assert.equal(valeurA({ a: 1 }, "constructor.name"), undefined);
  assert.equal(remplir("{{fiche.constructor}}", ctx), "");
  assert.equal(remplir("{{fiche.toString}}", ctx), "");
});

test("conditions", () => {
  const c = (champ, operateur, valeur) =>
    conditionVraie({ champ, operateur, valeur }, ctx);
  assert.ok(c("etape", "egal", "GAGNEE"));
  assert.ok(c("etape", "devient", "gagnee"));
  assert.ok(!c("libelle", "devient", "Flotte"), "déjà Flotte avant : ne « devient » pas");
  assert.ok(c("etape", "change"));
  assert.ok(!c("montant", "change"));
  assert.ok(c("montant", "superieur", "1000"));
  assert.ok(c("montant", "inferieur", "{{fiche.montant}}0"));
  assert.ok(!c("montant", "superieur", ""), "comparer à rien n'est jamais vrai");
  assert.ok(c("tags", "contient", "VIP"));
  assert.ok(c("libelle", "contient", "lot"));
  assert.ok(c("absent", "vide"));
  assert.ok(c("libelle", "non-vide"));
  assert.ok(c("etape", "different", "perdue"));
  assert.ok(
    conditionVraie(
      { champ: "etape", operateur: "devient", valeur: "gagnee" },
      { ...ctx, evenement: "creation", avant: null },
    ),
  );
});

test("ET / OU", () => {
  const conds = [
    { champ: "etape", operateur: "egal", valeur: "perdue" },
    { champ: "montant", operateur: "superieur", valeur: "10" },
  ];
  assert.equal(conditionsVraies({ conditions: conds }, ctx), false);
  assert.equal(conditionsVraies({ conditions: conds, toutes: false }, ctx), true);
  assert.equal(conditionsVraies({ conditions: [] }, ctx), true);
});

test("déclencheur : un champ ciblé doit avoir bougé", () => {
  const evt = {
    module: "crm",
    collection: "opportunites",
    evenement: "modification",
    fiche: ctx.fiche,
    avant: ctx.avant,
  };
  assert.ok(
    declencheurCorrespond(
      {
        module: "crm",
        collection: "opportunites",
        evenement: "modification",
        champ: "etape",
      },
      evt,
    ),
  );
  assert.ok(
    !declencheurCorrespond(
      {
        module: "crm",
        collection: "opportunites",
        evenement: "modification",
        champ: "montant",
      },
      evt,
    ),
  );
  assert.ok(
    !declencheurCorrespond(
      { module: "crm", collection: "opportunites", evenement: "creation" },
      evt,
    ),
  );
  assert.ok(
    !declencheurCorrespond(
      { module: "crm", collection: "clients", evenement: "modification" },
      evt,
    ),
  );
});

test("validation : refus explicites", () => {
  const r = validerAutomatisation({
    nom: "",
    declencheur: { module: "CRM!", collection: "x", evenement: "plouf" },
    conditions: [{ champ: "__proto__.x", operateur: "magie" }],
    actions: [
      { type: "webhook", url: "http://interne/" },
      {
        type: "creer",
        module: "crm",
        collection: "activites",
        donnees: { __proto__x: 1, "a b": 2 },
      },
      { type: "inconnu" },
    ],
  });
  assert.equal(r.ok, false);
  for (const attendu of [
    "Nom obligatoire",
    "application ou collection invalide",
    "événement inconnu",
    "opérateur inconnu",
    "https://",
    "nom de champ invalide",
    "type inconnu",
  ]) {
    assert.ok(
      r.erreurs.some((e) => e.includes(attendu)),
      `manque : ${attendu} — ${r.erreurs.join(" | ")}`,
    );
  }
  assert.equal(
    validerAutomatisation({
      nom: "x",
      declencheur: { module: "a", collection: "b", evenement: "creation" },
      actions: [],
    }).ok,
    false,
  );
  const suppr = validerAutomatisation({
    nom: "x",
    declencheur: { module: "a", collection: "b", evenement: "suppression" },
    actions: [{ type: "modifier", champs: { a: 1 } }],
  });
  assert.ok(suppr.erreurs.some((e) => e.includes("supprimée")));
});

test("validation : normalise", () => {
  const r = validerAutomatisation({
    nom: "  Test  ",
    declencheur: {
      module: "crm",
      collection: "clients",
      evenement: "creation",
      champ: "ignoré",
    },
    conditions: [{ champ: "source", operateur: "vide", valeur: "ignorée" }],
    actions: [
      {
        type: "notifier",
        destinataires: { mode: "membres", ids: ["a", "a", "b"] },
        titre: "Salut",
      },
    ],
    pirate: true,
  });
  assert.ok(r.ok, r.erreurs.join());
  assert.equal(r.valeur.nom, "Test");
  assert.equal(r.valeur.declencheur.champ, undefined);
  assert.equal(r.valeur.conditions[0].valeur, undefined);
  assert.deepEqual(r.valeur.actions[0].destinataires.ids, ["a", "b"]);
  assert.equal(r.valeur.pirate, undefined);
});

test("toutes les recettes sont valides", () => {
  assert.ok(RECETTES.length >= 6);
  for (const recette of RECETTES) {
    const r = validerAutomatisation(recette.automatisation);
    assert.ok(r.ok, `${recette.id} : ${r.erreurs.join(" | ")}`);
  }
  assert.equal(new Set(RECETTES.map((r) => r.id)).size, RECETTES.length);
});
