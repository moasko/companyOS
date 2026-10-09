// Le noyau d'authentification, sans base de données : `prisma.session` est
// remplacé par une table en mémoire. Ce qui est vérifié ici, ce sont les
// règles — sessions côté serveur, cookie et protection CSRF, inactivité,
// double authentification exigée, identité de l'exploitant — que les
// routes se contentent d'appliquer.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET = "secret-de-test";
process.env.PLATFORM_ADMINS = "Vous@CompanyOS.fr, autre@companyos.fr";

const { prisma } = await import("../src/db.js");
const auth = await import("../src/auth.js");

let comptes;
let sessions;
let numero = 0;
prisma.session.create = async ({ data }) => {
  const s = { id: `s${++numero}`, creeLe: new Date(), vuLe: new Date(), revoqueLe: null, ...data };
  sessions.push(s);
  return s;
};
prisma.session.update = async ({ where, data }) => {
  const s = sessions.find((x) => x.id === where.id);
  Object.assign(s, data);
  return s;
};
prisma.session.updateMany = async ({ where, data }) => {
  const visees = sessions.filter(
    (x) => x.userId === where.userId && !x.revoqueLe && (!where.id?.not || x.id !== where.id.not),
  );
  visees.forEach((x) => Object.assign(x, data));
  return { count: visees.length };
};
prisma.session.findUnique = async ({ where }) => {
  const s = sessions.find((x) => x.id === where.id);
  return s ? { ...s, user: comptes.find((c) => c.id === s.userId) } : null;
};

beforeEach(() => {
  sessions = [];
  comptes = [
    {
      id: "u1",
      tenantId: "t1",
      email: "awa@konan.ci",
      role: "MEMBER",
      sessionVersion: 0,
      tenant: { suspendu: false, mfaObligatoire: false },
    },
  ];
});

/// Joue un préhandler comme Fastify le ferait, et rend ce qu'il a répondu.
const jouer = async (handler, request) => {
  const reponse = { code: null, corps: null, entetes: {} };
  const reply = {
    code(c) {
      reponse.code = c;
      return this;
    },
    send(b) {
      reponse.corps = b;
      return this;
    },
    header(k, v) {
      reponse.entetes[k] = v;
      return this;
    },
  };
  await handler({ method: "GET", headers: {}, routeOptions: { url: "/api/x" }, ...request }, reply);
  return reponse;
};

const ouvrir = async (compte = comptes[0], options = {}) => {
  const r = await jouer(async (request, reply) => {
    reply.resultat = await auth.ouvrirSession(request, reply, compte, options);
    reply.send(reply.resultat);
  }, { headers: { "user-agent": "test" } });
  return { token: r.corps.token, cookie: r.entetes["set-cookie"], session: r.corps.session };
};

const requete = (jeton, extra = {}) => ({ headers: { authorization: `Bearer ${jeton}` }, ...extra });

test("une session ouverte donne accès, sa révocation le retire", async () => {
  const { token, session } = await ouvrir();
  const request = requete(token);
  assert.equal((await jouer(auth.authenticate, request)).code, null);

  await auth.revoquerSessions("u1");
  const r = await jouer(auth.authenticate, requete(token));
  assert.equal(r.code, 401);
  assert.ok(sessions.find((x) => x.id === session.id).revoqueLe);
});

test("le navigateur reçoit un cookie HttpOnly SameSite=Strict, pas de Secure en local", async () => {
  const { cookie } = await ouvrir();
  assert.match(cookie, /^cos_session=ey/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api/);
});

test("par cookie, une écriture sans l'en-tête X-CompanyOS est refusée (CSRF)", async () => {
  const { token } = await ouvrir();
  const parCookie = { headers: { cookie: `autre=1; cos_session=${token}` } };
  assert.equal((await jouer(auth.authenticate, { ...parCookie })).code, null);
  assert.equal((await jouer(auth.authenticate, { ...parCookie, method: "POST" })).code, 403);
  const avec = { headers: { ...parCookie.headers, "x-companyos": "1" }, method: "POST" };
  assert.equal((await jouer(auth.authenticate, avec)).code, null);
});

test("une session de navigateur inactive trop longtemps se ferme", async () => {
  const { token, session } = await ouvrir();
  sessions.find((x) => x.id === session.id).vuLe = new Date(Date.now() - 13 * 3600 * 1000);
  assert.equal((await jouer(auth.authenticate, requete(token))).code, 401);
});

test("un jeton sans session (ancien format) ou d'un autre compte est refusé", async () => {
  const jwt = (await import("jsonwebtoken")).default;
  const ancien = jwt.sign({ sub: "u1", tenantId: "t1", ver: 0 }, "secret-de-test");
  assert.equal((await jouer(auth.authenticate, requete(ancien))).code, 401);
  const { session } = await ouvrir();
  const vole = jwt.sign({ sub: "u2", sid: session.id, ver: 0 }, "secret-de-test");
  assert.equal((await jouer(auth.authenticate, requete(vole))).code, 401);
});

test("un jeton signé avec un autre secret ou un autre algorithme est refusé", async () => {
  const jwt = (await import("jsonwebtoken")).default;
  const { session } = await ouvrir();
  const forge = jwt.sign({ sub: "u1", sid: session.id, ver: 0 }, "pas-le-bon-secret");
  assert.equal((await jouer(auth.authenticate, requete(forge))).code, 401);
  assert.equal(auth.idDuJeton(requete(forge)), null);
  const hs512 = jwt.sign({ sub: "u1", sid: session.id, ver: 0 }, "secret-de-test", { algorithm: "HS512" });
  assert.equal((await jouer(auth.authenticate, requete(hs512))).code, 401);
  const none = jwt.sign({ sub: "u1", sid: session.id, ver: 0 }, null, { algorithm: "none" });
  assert.equal((await jouer(auth.authenticate, requete(none))).code, 401);
});

test("double authentification exigée : la session ne sert qu'à la configurer", async () => {
  comptes[0].tenant.mfaObligatoire = true;
  const { token } = await ouvrir();
  const r = await jouer(auth.authenticate, requete(token));
  assert.equal(r.code, 403);
  assert.equal(r.corps.mfaAConfigurer, true);
  const config = await jouer(auth.authenticate, requete(token, { routeOptions: { url: "/api/auth/mfa/preparer" } }));
  assert.equal(config.code, null);
  const avecMfa = await ouvrir(comptes[0], { mfa: true });
  assert.equal((await jouer(auth.authenticate, requete(avecMfa.token))).code, null);
});

test("l'exploitant doit toujours avoir la double authentification", async () => {
  comptes[0].email = "vous@companyos.fr";
  const { token } = await ouvrir();
  assert.equal((await jouer(auth.authenticate, requete(token))).code, 403);
});

test("un espace suspendu est fermé, sauf pour l'exploitant", async () => {
  comptes[0].tenant.suspendu = true;
  const r = await jouer(auth.authenticate, requete((await ouvrir()).token));
  assert.equal(r.code, 403);
  assert.equal(r.corps.suspendu, true);

  comptes[0].email = "vous@companyos.fr";
  const r2 = await jouer(auth.authenticate, requete((await ouvrir(comptes[0], { mfa: true })).token));
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

test("la limitation de débit lit le compte dans le jeton ou le cookie", async () => {
  const { token } = await ouvrir();
  assert.equal(auth.idDuJeton(requete(token)), "u1");
  assert.equal(auth.idDuJeton({ headers: { cookie: `cos_session=${token}` } }), "u1");
  assert.equal(auth.idDuJeton({ headers: {} }), null);
});
