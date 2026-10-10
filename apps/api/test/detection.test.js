import test from "node:test";
import assert from "node:assert/strict";
import { Fenetre, appareilDe, dureeBlocage, motifSuspect } from "../src/detection.js";

test("sondes reconnues dans le chemin, quelle que soit la session", () => {
  assert.equal(motifSuspect("/.env"), "fichier caché de configuration");
  assert.equal(motifSuspect("/api/../../etc/passwd"), "remontée de répertoire");
  assert.equal(motifSuspect("/api/%2e%2e%2fsecret"), "remontée de répertoire");
  assert.equal(motifSuspect("/wp-login.php"), "WordPress");
  assert.equal(motifSuspect("/phpmyadmin/index"), "console de base de données");
  assert.equal(motifSuspect("/.git/config", { anonyme: false }), "fichier caché de configuration");
});

test("injections cherchées seulement dans les requêtes anonymes", () => {
  const sql = "/api/public/formulaire?q=1' OR '1'='1";
  assert.equal(motifSuspect(sql), "injection SQL");
  assert.equal(motifSuspect(sql, { anonyme: false }), null);
  assert.equal(motifSuspect("/api/records?x=%3Cscript%3Ealert(1)%3C/script%3E"), "injection de script");
  assert.equal(motifSuspect("/api/x?u=${jndi:ldap://a/b}"), "Log4Shell");
  // Un salarié qui cherche « union select » dans le CRM n'est pas un attaquant.
  assert.equal(motifSuspect("/api/records/crm/clients?recherche=union+select", { anonyme: false }), null);
});

test("pas de faux positif sur les routes de l'application", () => {
  for (const url of [
    "/api/files?parentId=abc",
    "/api/records/crm/clients?limit=50&cursor=xyz",
    "/api/auth/login",
    "/api/public/partages/AbC-123_x",
    "/api/files/abc/download",
    "/api/campagnes/clic/abc?u=https%3A%2F%2Fexemple.ci%2Fpage",
    "/api/evenements",
  ]) {
    assert.equal(motifSuspect(url), null, url);
  }
});

test("blocages : paliers croissants à chaque récidive", () => {
  const h = 3600_000;
  assert.equal(dureeBlocage(0), h);
  assert.equal(dureeBlocage(1), 6 * h);
  assert.equal(dureeBlocage(2), 24 * h);
  assert.equal(dureeBlocage(9), 7 * 24 * h);
});

test("fenêtre glissante : les anciens évènements sortent", () => {
  const f = new Fenetre(1000);
  assert.equal(f.noter("a", 0), 1);
  assert.equal(f.noter("a", 500), 2);
  assert.equal(f.noter("a", 1600), 1);
  assert.equal(f.noter("b", 1600), 1);
});

test("appareil lisible", () => {
  assert.equal(appareilDe("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537"), "Chrome · Windows");
  assert.equal(appareilDe(""), "appareil inconnu");
});
