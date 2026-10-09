// Les secrets de production : un secret faible ou une étiquette GCM
// tronquée doivent être refusés.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET ||= "secret-de-test";

const demarrer = (env) =>
  spawnSync(process.execPath, ["-e", "import('./src/env.js').then(()=>console.log('ok'))"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

test("en production, un JWT_SECRET faible empêche le démarrage", () => {
  for (const s of ["changez-moi-en-production", "court"]) {
    const r = demarrer({ NODE_ENV: "production", JWT_SECRET: s });
    assert.notEqual(r.status, 0, s);
    assert.match(r.stderr, /JWT_SECRET trop faible/);
  }
  const ok = demarrer({ NODE_ENV: "production", JWT_SECRET: "x".repeat(48) });
  assert.equal(ok.stdout.trim(), "ok");
});

test("une étiquette GCM tronquée est refusée", async () => {
  const { chiffrer, dechiffrer } = await import("../src/chiffrement.js");
  const paquet = chiffrer("clé-secrète");
  assert.equal(dechiffrer(paquet), "clé-secrète");
  const [v, iv, tag, c] = paquet.split(".");
  const court = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
  assert.equal(dechiffrer([v, iv, court, c].join(".")), null);
});
