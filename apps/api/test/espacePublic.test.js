// Liens publics : domaine personnalisé et lien de formulaire régénérable.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET ||= "secret-de-test";

const { normaliserDomaine, preuveDomaine, routePublique } = await import("../src/espacePublic.js");
const { signatureFormulaire } = await import("../src/campagnes.js");

test("domaine : normalisé, ou refusé", () => {
  assert.equal(normaliserDomaine("https://Liens.Entreprise.CI/"), "liens.entreprise.ci");
  assert.equal(normaliserDomaine("liens.entreprise.ci/chemin"), "liens.entreprise.ci");
  for (const x of ["", "localhost", "127.0.0.1", "liens entreprise.ci", "-a.ci", "a..ci", "x".repeat(300) + ".ci"]) {
    assert.equal(normaliserDomaine(x), null, x);
  }
});

test("domaine personnalisé : seules les routes publiques y répondent", () => {
  for (const ok of ["/api/public/partages/abc", "/api/campagnes/inscription?e=1", "/api/campagnes/clic?jeton=x", "/api/campagnes/desinscription?jeton=x", "/api/campagnes/image?e=1"]) {
    assert.ok(routePublique(ok), ok);
  }
  for (const ko of ["/api/auth/me", "/api/records/crm/clients", "/api/files", "/api/campagnes/test", "/api/campagnes/formulaire", "/api/evenements", "/"]) {
    assert.equal(routePublique(ko), false, ko);
  }
});

test("preuve de domaine : propre à l'espace et au domaine", () => {
  assert.equal(preuveDomaine("t1", "a.ci"), preuveDomaine("t1", "a.ci"));
  assert.notEqual(preuveDomaine("t1", "a.ci"), preuveDomaine("t2", "a.ci"));
  assert.notEqual(preuveDomaine("t1", "a.ci"), preuveDomaine("t1", "b.ci"));
});

test("formulaire : régénérer change la signature, sans sel l'ancienne reste", () => {
  const origine = signatureFormulaire("t1");
  assert.equal(signatureFormulaire("t1", null), origine);
  assert.notEqual(signatureFormulaire("t1", "sel1"), origine);
  assert.notEqual(signatureFormulaire("t1", "sel1"), signatureFormulaire("t1", "sel2"));
});
