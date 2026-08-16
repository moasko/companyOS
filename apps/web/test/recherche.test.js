import assert from "node:assert/strict";
import test from "node:test";
import { classerResultats, normaliserRecherche, scoreRecherche } from "../src/components/start/recherche.js";

test("la recherche ignore les accents et la casse", () => {
  assert.equal(normaliserRecherche("  PRÉSENTATION  "), "presentation");
  assert.ok(scoreRecherche("presentation", "Créer une présentation") > 0);
});

test("un début de nom passe avant une simple occurrence", () => {
  const resultats = classerResultats([{ id: "a", titre: "Nouvelle présentation" }, { id: "b", titre: "Créer une nouvelle présentation" }], "nouvelle");
  assert.equal(resultats[0].id, "a");
});

test("les initiales retrouvent une commande", () => {
  assert.ok(scoreRecherche("nvp", "Nouvelle présentation commerciale") > 0);
});
