// Une base par entreprise : quelle base sert quelle adresse.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET ||= "secret-de-test";
process.env.DOMAINE = "erp.akwaba.ci";

const { principal, urlDeBase, dansBase, baseCourante } = await import("../src/db.js");
const { baseDuNom, oublierAiguillage } = await import("../src/aiguillage.js");

const filiale = { slug: "filiale", nomBase: "cos_filiale", domaine: "liens.filiale.ci" };
principal.baseEspace.findUnique = async ({ where }) => (where.slug === "filiale" || where.domaine === "liens.filiale.ci" ? filiale : null);

test("le domaine du serveur et les autres noms vont à la base principale", async () => {
  oublierAiguillage();
  assert.equal(await baseDuNom("erp.akwaba.ci"), null);
  assert.equal(await baseDuNom("www.erp.akwaba.ci"), null);
  assert.equal(await baseDuNom("localhost:4000"), null);
  assert.equal(await baseDuNom("10.0.0.5"), null);
});

test("un sous-domaine connu va à la base de son entreprise, un inconnu nulle part", async () => {
  oublierAiguillage();
  assert.equal(await baseDuNom("filiale.erp.akwaba.ci"), filiale);
  assert.equal(await baseDuNom("FILIALE.erp.akwaba.ci:443"), filiale);
  assert.equal(await baseDuNom("inconnue.erp.akwaba.ci"), undefined);
  assert.equal(await baseDuNom("x.filiale.erp.akwaba.ci"), undefined);
});

test("le domaine personnalisé d'une entreprise va à sa base", async () => {
  oublierAiguillage();
  assert.equal(await baseDuNom("liens.filiale.ci"), filiale);
});

test("adresse d'une autre base : même serveur, autre nom, connexions plafonnées", () => {
  const u = new URL(urlDeBase("cos_filiale", "postgresql://u:p@postgres:5432/companyos?schema=public"));
  assert.equal(u.pathname, "/cos_filiale");
  assert.equal(u.host, "postgres:5432");
  assert.equal(u.searchParams.get("connection_limit"), "5");
});

test("le contexte de base suit les appels asynchrones et ne fuit pas", async () => {
  assert.equal(baseCourante(), null);
  await dansBase(filiale, async () => {
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(baseCourante(), filiale);
  });
  assert.equal(baseCourante(), null);
  assert.throws(() => dansBase({ slug: "x", nomBase: "x; DROP" }, () => {}), /invalide/);
});
