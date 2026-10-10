import test from "node:test";
import assert from "node:assert/strict";

import { creerCacheListes, lireToutesLesPages } from "../src/api/listes.js";

test("enchaîne les pages jusqu'à la dernière", async () => {
  const pages = { null: { fiches: [1, 2], suite: "a" }, a: { fiches: [3, 4], suite: "b" }, b: { fiches: [5], suite: null } };
  const vus = [];
  const tout = await lireToutesLesPages(async (c) => {
    vus.push(c);
    return pages[c];
  });
  assert.deepEqual(tout, [1, 2, 3, 4, 5]);
  assert.deepEqual(vus, [null, "a", "b"]);
});

test("s'arrête si le serveur rend deux fois le même curseur, et au plafond", async () => {
  assert.deepEqual(await lireToutesLesPages(async () => ({ fiches: [1], suite: "x" }), { pagesMax: 5 }).then((l) => l.length), 2);
  const avertir = console.warn;
  console.warn = () => {};
  let n = 0;
  const l = await lireToutesLesPages(async () => ({ fiches: [n], suite: `c${++n}` }), { pagesMax: 3 });
  console.warn = avertir;
  assert.equal(l.length, 3);
});

const compteur = () => {
  const appels = [];
  let valeur = 1;
  return {
    appels,
    changer: (v) => (valeur = v),
    charger: async (module, collection, options) => {
      appels.push(`${module}/${collection}${options ? JSON.stringify(options) : ""}`);
      const lue = valeur; // l'état de la base au moment de la lecture
      await new Promise((r) => setTimeout(r, 5));
      return [lue];
    },
  };
};

test("deux lectures simultanées n'en font qu'une", async () => {
  const c = compteur();
  const cache = creerCacheListes({ charger: c.charger });
  const [a, b] = await Promise.all([cache.lire("crm", "clients"), cache.lire("crm", "clients")]);
  assert.deepEqual(a, [1]);
  assert.deepEqual(b, [1]);
  assert.equal(c.appels.length, 1);
  assert.notEqual(a, b, "chaque appelant reçoit son propre tableau");
});

test("le cache expire, et dépend des options", async () => {
  let t = 0;
  const c = compteur();
  const cache = creerCacheListes({ charger: c.charger, dureeMs: 100, maintenant: () => t });
  await cache.lire("crm", "clients");
  await cache.lire("crm", "clients");
  await cache.lire("crm", "clients", { q: "x" });
  assert.equal(c.appels.length, 2);
  t = 500;
  await cache.lire("crm", "clients");
  assert.equal(c.appels.length, 3);
});

test("une écriture invalide la collection, filtres compris, et rien d'autre", async () => {
  const c = compteur();
  const cache = creerCacheListes({ charger: c.charger });
  await cache.lire("crm", "clients");
  await cache.lire("crm", "clients", { q: "x" });
  await cache.lire("crm", "contacts");
  c.changer(2);
  cache.invalider("crm", "clients");
  assert.deepEqual(await cache.lire("crm", "clients"), [2]);
  assert.deepEqual(await cache.lire("crm", "clients", { q: "x" }), [2]);
  assert.deepEqual(await cache.lire("crm", "contacts"), [1]);
});

test("une lecture commencée avant une écriture n'est pas gardée", async () => {
  const c = compteur();
  const cache = creerCacheListes({ charger: c.charger });
  const enCours = cache.lire("crm", "clients");
  c.changer(2);
  cache.invalider("crm", "clients");
  assert.deepEqual(await enCours, [1]);
  assert.deepEqual(await cache.lire("crm", "clients"), [2]);
});

test("une erreur n'est pas mise en cache", async () => {
  let echec = true;
  const cache = creerCacheListes({
    charger: async () => {
      if (echec) throw new Error("panne");
      return [1];
    },
  });
  await assert.rejects(cache.lire("a", "b"), /panne/);
  echec = false;
  assert.deepEqual(await cache.lire("a", "b"), [1]);
});

test("vider oublie tout (déconnexion)", async () => {
  const c = compteur();
  const cache = creerCacheListes({ charger: c.charger });
  await cache.lire("crm", "clients");
  cache.vider();
  await cache.lire("crm", "clients");
  assert.equal(c.appels.length, 2);
});
