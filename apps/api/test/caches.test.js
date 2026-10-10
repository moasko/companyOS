// Registre des caches : vidage local et ordre diffusé aux autres instances.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET ||= "secret-de-test";

const { declarerCache, etatCaches, viderCachesLocaux, demarrerCaches } = await import("../src/caches.js");
const { publier } = await import("../src/evenements.js");

const faux = (nom) => {
  const m = new Map([["a", 1], ["b", 2]]);
  declarerCache(nom, { libelle: nom, description: "test", taille: () => m.size, vider: () => m.clear() });
  return m;
};

test("les modules déclarent leurs caches au chargement", async () => {
  await import("../src/espacePublic.js");
  await import("../src/sso.js");
  await import("../src/storage.js");
  const noms = etatCaches().map((c) => c.nom);
  for (const n of ["espaces-publics", "sso", "stockage"]) assert.ok(noms.includes(n), n);
});

test("vider un cache nommé ne touche pas aux autres", async () => {
  const a = faux("test-a");
  const b = faux("test-b");
  const r = await viderCachesLocaux(["test-a", "inconnu"]);
  assert.deepEqual(r.caches, ["test-a"]);
  assert.equal(r.entrees, 2);
  assert.equal(a.size, 0);
  assert.equal(b.size, 2);
});

test("un ordre reçu du bus vide les caches de l'instance", async () => {
  const c = faux("test-c");
  demarrerCaches();
  await publier({ type: "caches", noms: ["test-c"], navigateurs: false });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(c.size, 0);
});

test("un cache qui échoue n'empêche pas les autres de se vider", async () => {
  declarerCache("test-panne", { libelle: "x", description: "x", taille: () => 1, vider: () => { throw new Error("non"); } });
  const d = faux("test-d");
  const r = await viderCachesLocaux(["test-panne", "test-d"]);
  assert.equal(r.caches.length, 2);
  assert.equal(d.size, 0);
});
