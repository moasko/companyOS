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

test("une application passe avant un dossier du même nom", () => {
  const resultats = classerResultats(
    [
      { id: "app", titre: "Courrier", mots: "Courrier communication" },
      { id: "dossier", titre: "Courrier", mots: "FOLDER" },
    ],
    "Courrier",
  );
  assert.equal(resultats[0].id, "app");
});
