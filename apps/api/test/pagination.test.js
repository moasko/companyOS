// La lecture page par page des fiches, sans base de données.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  couperPage,
  encoderCurseur,
  ErreurPagination,
  LIMITE_DEFAUT,
  LIMITE_MAX,
  lireCurseur,
  lireFiltre,
  lireLimite,
  lireRecherche,
} from "../src/pagination.js";

test("limite : défaut, plafond, refus", () => {
  assert.equal(lireLimite(undefined), LIMITE_DEFAUT);
  assert.equal(lireLimite("20"), 20);
  assert.equal(lireLimite("999999"), LIMITE_MAX);
  for (const x of ["0", "-1", "1.5", "abc"]) assert.throws(() => lireLimite(x), ErreurPagination);
});

test("curseur : aller-retour, et refus de tout le reste", () => {
  const c = encoderCurseur("2026-10-09 12:30:00.123", "cmv19ncxr00037d922wntvkba");
  assert.deepEqual(lireCurseur(c), { createdAt: "2026-10-09 12:30:00.123", id: "cmv19ncxr00037d922wntvkba" });
  assert.equal(lireCurseur(undefined), null);
  for (const x of ["xxx", encoderCurseur("hier", "a"), encoderCurseur("2026-10-09 12:30:00", "a'; drop"), "a".repeat(300)]) {
    assert.throws(() => lireCurseur(x), ErreurPagination);
  }
});

test("recherche : les jokers de LIKE sont pris au pied de la lettre", () => {
  assert.equal(lireRecherche(" Koné "), "%Koné%");
  assert.equal(lireRecherche("100%_x\\"), "%100\\%\\_x\\\\%");
  assert.equal(lireRecherche("   "), null);
  assert.equal(lireRecherche("x".repeat(500)).length, 102);
});

test("filtre : égalités sur des champs simples", () => {
  assert.deepEqual(lireFiltre('{"etape":"gagne","n":3,"ok":true}'), [["etape", "gagne"], ["n", "3"], ["ok", "true"]]);
  assert.deepEqual(lireFiltre(undefined), []);
  for (const x of ["[1]", "pas du json", '{"a b":1}', '{"a":{"b":1}}', '{"a":null}', JSON.stringify(Object.fromEntries([..."abcdef"].map((k) => [k, 1])))]) {
    assert.throws(() => lireFiltre(x), ErreurPagination);
  }
});

const ligne = (i, taille = 10) => ({ id: `id${i}`, createdAt: `2026-10-09 12:00:0${i}`, taille });

test("page pleine : un curseur sur la dernière fiche rendue", () => {
  const p = couperPage([ligne(1), ligne(2), ligne(3)], 2, 1e9);
  assert.deepEqual(p.ids, ["id1", "id2"]);
  assert.deepEqual(lireCurseur(p.suite), { createdAt: "2026-10-09 12:00:02", id: "id2" });
});

test("dernière page : pas de suite", () => {
  assert.equal(couperPage([ligne(1), ligne(2)], 2, 1e9).suite, null);
});

test("budget d'octets : la page s'arrête plus tôt, sans rien perdre", () => {
  const p = couperPage([ligne(1, 60), ligne(2, 60), ligne(3, 60)], 10, 100);
  assert.deepEqual(p.ids, ["id1"]);
  assert.ok(p.suite, "la suite reprend après la fiche coupée");
  // Une fiche plus grosse que le budget part quand même seule.
  assert.deepEqual(couperPage([ligne(1, 500)], 10, 100).ids, ["id1"]);
});
