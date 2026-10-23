// Le filtre des certificats HTTPS à la demande (install.sh → Caddy) : le
// proxy ne demande un certificat que pour les noms que l'API reconnaît.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET ||= "secret-de-test";
process.env.DOMAINE = "https://ERP.Akwaba.ci/";

const { prisma } = await import("../src/db.js");
const { domaineAutorise } = await import("../src/routes/publics.js");

// Pas de base : deux espaces simulés.
prisma.tenant.findUnique = async ({ where }) => (where.slug === "akwaba" ? { id: "t1" } : null);
prisma.tenant.findFirst = async ({ where }) => (where.domainePublic === "erp.client.ci" ? { id: "t2" } : null);

test("le domaine du serveur et son www sont autorisés (normalisés)", async () => {
  assert.equal(await domaineAutorise("erp.akwaba.ci"), true);
  assert.equal(await domaineAutorise("WWW.erp.akwaba.ci."), true);
});

test("un sous-domaine n'est autorisé que s'il correspond à un espace", async () => {
  assert.equal(await domaineAutorise("akwaba.erp.akwaba.ci"), true);
  assert.equal(await domaineAutorise("inconnu.erp.akwaba.ci"), false);
  // Un seul niveau : pas de x.akwaba.erp…
  assert.equal(await domaineAutorise("x.akwaba.erp.akwaba.ci"), false);
});

test("domaine personnalisé déclaré par un espace : oui ; le reste : non", async () => {
  assert.equal(await domaineAutorise("erp.client.ci"), true);
  assert.equal(await domaineAutorise("evil.com"), false);
  assert.equal(await domaineAutorise(""), false);
  assert.equal(await domaineAutorise("a b.ci"), false);
  assert.equal(await domaineAutorise(undefined), false);
});
