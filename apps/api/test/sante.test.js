// Sauvegardes et journal des erreurs : les règles, sans base de données.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET ||= "secret-de-test";

const { prisma } = await import("../src/db.js");
const { empreinteDe, gestionnaireErreurs } = await import("../src/erreurs.js");
const { adressePgDump, estDue } = await import("../src/sauvegardes.js");

const consignees = [];
prisma.erreurApp.findUnique = async () => null;
prisma.erreurApp.create = async ({ data }) => consignees.push(data);

test("la même erreur garde la même empreinte, une autre non", () => {
  const pile = "TypeError\n    at Facture (http://app/assets/index.js:12:5)";
  const a = empreinteDe({ source: "web", message: "Facture 1042 introuvable", pile });
  const b = empreinteDe({ source: "web", message: "Facture 2077 introuvable", pile });
  const c = empreinteDe({
    source: "web",
    message: "Facture 1042 introuvable",
    pile: "TypeError\n    at Stock (http://app/assets/index.js:80:1)",
  });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, empreinteDe({ source: "api", message: "Facture 1042 introuvable", pile }));
});

/// Une réponse Fastify minimale.
const reponse = () => {
  const r = { code: null, corps: null };
  return {
    r,
    reply: {
      code(c) {
        r.code = c;
        return this;
      },
      send(b) {
        r.corps = b;
        return this;
      },
    },
  };
};
const requete = { method: "GET", url: "/api/x", log: { error() {} }, routeOptions: {} };

test("une 500 est consignée, et son détail ne sort pas", async () => {
  const { r, reply } = reponse();
  const err = new Error("Invalid `prisma.user.findMany()` invocation: table users ...");
  await gestionnaireErreurs(err, requete, reply);
  assert.equal(r.code, 500);
  assert.doesNotMatch(r.corps.message, /prisma|users/);
  assert.equal(consignees.at(-1).source, "api");
  assert.match(consignees.at(-1).message, /prisma/);
});

test("une 4xx est renvoyée telle quelle, sans être consignée", async () => {
  const avant = consignees.length;
  const { r, reply } = reponse();
  await gestionnaireErreurs(
    { statusCode: 429, error: "Too Many Requests", message: "Trop de requêtes." },
    requete,
    reply,
  );
  assert.equal(r.code, 429);
  assert.equal(r.corps.message, "Trop de requêtes.");
  assert.equal(consignees.length, avant);
});

test("l'adresse de la base est nettoyée des paramètres propres à Prisma", () => {
  const u = adressePgDump(
    "postgresql://u:p@db:5432/cos?schema=public&connection_limit=5&sslmode=require",
  );
  assert.equal(u, "postgresql://u:p@db:5432/cos?sslmode=require");
});

test("une sauvegarde est due à l'heure prévue, ou en rattrapage", () => {
  const JOUR = 24 * 3600_000;
  const a = (iso) => new Date(iso);
  // Jamais sauvegardé : tout de suite.
  assert.equal(estDue(null, JOUR, 2), true);
  // Hier 2 h, il est 2 h 10 : due.
  assert.equal(estDue(a("2026-10-07T02:00Z"), JOUR, 2, a("2026-10-08T02:10Z")), true);
  // Hier 2 h, il est 1 h : pas encore.
  assert.equal(estDue(a("2026-10-07T02:00Z"), JOUR, 2, a("2026-10-08T01:00Z")), false);
  // Ce matin 2 h, il est 14 h : déjà fait.
  assert.equal(estDue(a("2026-10-08T02:00Z"), JOUR, 2, a("2026-10-08T14:00Z")), false);
  // Avant-hier : rattrapage, quelle que soit l'heure.
  assert.equal(estDue(a("2026-10-06T02:00Z"), JOUR, 2, a("2026-10-08T01:00Z")), true);
});
