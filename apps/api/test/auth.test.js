// Le noyau d'authentification, sans base de données : `prisma.user` est
// remplacé par une table en mémoire. Ce qui est vérifié ici, ce sont les
// règles — révocation des sessions, identité de l'exploitant, adresse
// normalisée — que les routes se contentent d'appliquer.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET = "secret-de-test";
process.env.PLATFORM_ADMINS = "Vous@CompanyOS.fr, autre@companyos.fr";

const { prisma } = await import("../src/db.js");
const auth = await import("../src/auth.js");

let comptes;
prisma.user.findUnique = async ({ where }) => comptes.find((c) => c.id === where.id) || null;

beforeEach(() => {
  comptes = [
    {
      id: "u1",
      tenantId: "t1",
      email: "awa@konan.ci",
      role: "MEMBER",
      sessionVersion: 0,
      tenant: { suspendu: false },
    },
  ];
});

/// Joue un préhandler comme Fastify le ferait, et rend ce qu'il a répondu.
const jouer = async (handler, request) => {
  const reponse = { code: null, corps: null };
  const reply = {
    code(c) {
      reponse.code = c;
      return this;
    },
    send(b) {
      reponse.corps = b;
      return this;
    },
  };
  await handler(request, reply);
  return reponse;
};

const requete = (jeton) => ({ headers: { authorization: `Bearer ${jeton}` } });

test("un jeton valide ouvre la session", async () => {
  const request = requete(auth.signToken(comptes[0]));
  const r = await jouer(auth.authenticate, request);
  assert.equal(r.code, null);
  assert.equal(request.user.id, "u1");
  assert.equal(request.tenantId, "t1");
});

test("incrémenter la version de session rend les anciens jetons caducs", async () => {
  const ancien = auth.signToken(comptes[0]);
  comptes[0].sessionVersion = 1;
  assert.equal((await jouer(auth.authenticate, requete(ancien))).code, 401);
  const neuf = auth.signToken(comptes[0]);
  assert.equal((await jouer(auth.authenticate, requete(neuf))).code, null);
});

test("un jeton émis avant le compteur (sans `ver`) vaut version 0", async () => {
  const jwt = (await import("jsonwebtoken")).default;
  const historique = jwt.sign({ sub: "u1", tenantId: "t1" }, "secret-de-test");
  assert.equal((await jouer(auth.authenticate, requete(historique))).code, null);
  comptes[0].sessionVersion = 1;
  assert.equal((await jouer(auth.authenticate, requete(historique))).code, 401);
});

test("un jeton signé avec un autre secret est refusé", async () => {
  const jwt = (await import("jsonwebtoken")).default;
  const forge = jwt.sign({ sub: "u1", ver: 0 }, "pas-le-bon-secret");
  assert.equal((await jouer(auth.authenticate, requete(forge))).code, 401);
  assert.equal(auth.idDuJeton(requete(forge)), null);
});

test("un espace suspendu est fermé, sauf pour l'exploitant", async () => {
  comptes[0].tenant.suspendu = true;
  const r = await jouer(auth.authenticate, requete(auth.signToken(comptes[0])));
  assert.equal(r.code, 403);
  assert.equal(r.corps.suspendu, true);

  comptes[0].email = "vous@companyos.fr";
  const r2 = await jouer(auth.authenticate, requete(auth.signToken(comptes[0])));
  assert.equal(r2.code, null);
});

test("l'exploitant est reconnu à son adresse exacte, en minuscules", () => {
  assert.equal(auth.estExploitant("vous@companyos.fr"), true);
  assert.equal(auth.estExploitant("autre@companyos.fr"), true);
  // Un compte enregistré en majuscules à côté du vrai n'hérite de rien.
  assert.equal(auth.estExploitant("VOUS@companyos.fr"), false);
  assert.equal(auth.estExploitant("vous@companyos.fr "), false);
  assert.equal(auth.estExploitant(""), false);
  assert.equal(auth.estExploitant(undefined), false);
});

test("la console refuse quiconque n'est pas exploitant", async () => {
  const membre = await jouer(auth.exigerExploitant, { user: comptes[0] });
  assert.equal(membre.code, 403);
  const exploitant = await jouer(auth.exigerExploitant, {
    user: { email: "vous@companyos.fr" },
  });
  assert.equal(exploitant.code, null);
});

test("les adresses sont normalisées", () => {
  assert.equal(auth.normaliserEmail("  Awa@Konan.CI "), "awa@konan.ci");
  assert.equal(auth.normaliserEmail(undefined), "");
});

test("la hiérarchie des rôles", async () => {
  assert.equal(auth.auMoins("OWNER", "ADMIN"), true);
  assert.equal(auth.auMoins("ADMIN", "ADMIN"), true);
  assert.equal(auth.auMoins("MEMBER", "ADMIN"), false);
  assert.equal(auth.auMoins(undefined, "MEMBER"), false);
  const r = await jouer(auth.exigerRole("ADMIN"), { user: comptes[0] });
  assert.equal(r.code, 403);
});

test("la limitation de débit lit le compte dans le jeton", () => {
  assert.equal(auth.idDuJeton(requete(auth.signToken(comptes[0]))), "u1");
  assert.equal(auth.idDuJeton({ headers: {} }), null);
});

test("un jeton signé avec un autre algorithme est refusé", async () => {
  const jwt = (await import("jsonwebtoken")).default;
  const hs512 = jwt.sign({ sub: "u1", tenantId: "t1", ver: 0 }, "secret-de-test", { algorithm: "HS512" });
  const r = await jouer(auth.authenticate, requete(hs512));
  assert.equal(r.code, 401);
  const none = jwt.sign({ sub: "u1", tenantId: "t1", ver: 0 }, null, { algorithm: "none" });
  assert.equal((await jouer(auth.authenticate, requete(none))).code, 401);
});
