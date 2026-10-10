import { test } from "node:test";
import assert from "node:assert/strict";
import { refusMotDePasse } from "../src/motsDePasse.js";

test("politique de mot de passe", () => {
  assert.match(refusMotDePasse("court"), /10 caractères/);
  assert.match(refusMotDePasse("motdepasse123"), /plus utilisés/);
  assert.match(refusMotDePasse("Password123"), /plus utilisés/);
  assert.match(refusMotDePasse("aaaaaaaaaaaa"), /répété/);
  assert.match(refusMotDePasse("awa.kone-2026!", { email: "awa.kone@exemple.ci" }), /adresse/);
  assert.match(refusMotDePasse("Kouassi-Bureau-77", { nom: "Jean Kouassi" }), /nom/);
  assert.equal(refusMotDePasse("Trois-Chats-Bleus-77", { email: "awa@exemple.ci", nom: "Awa Koné" }), null);
  assert.match(refusMotDePasse("x".repeat(201)), /200/);
});
