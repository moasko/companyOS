// Le stockage S3 d'un espace est réglé par l'administrateur de l'espace :
// il ne doit jamais permettre de joindre le réseau interne (SSRF).
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerPiloteS3, verifierConfigPublique } from "../src/stockage-s3.js";

const base = {
  endpoint: "https://s3.example.com",
  region: "auto",
  bucket: "mon-bucket",
  accessKey: "AK",
  secretKey: "SK",
  pathStyle: true,
  reseauPublic: true,
};

test("refuse http, les IP internes et les adresses avec identifiants", () => {
  for (const endpoint of [
    "http://s3.example.com",
    "https://127.0.0.1",
    "https://169.254.169.254",
    "https://[::1]",
    "https://[::ffff:10.0.0.1]",
    "https://10.1.2.3:9000",
    "https://localhost",
    "https://user:pass@s3.example.com",
    "https://s3.example.com/chemin",
    "pas une url",
  ]) {
    assert.throws(() => verifierConfigPublique({ ...base, endpoint }), endpoint);
  }
  assert.doesNotThrow(() => verifierConfigPublique(base));
});

test("refuse un bucket qui changerait l'hôte visé", () => {
  for (const bucket of ["a@evil.com", "x/y", "UPPER", "", "a"]) {
    assert.throws(() => verifierConfigPublique({ ...base, bucket }), bucket);
  }
});

test("un nom qui se résout en adresse interne est refusé à la connexion", async () => {
  // `localhost.` (avec le point final) échappe au contrôle de forme mais se
  // résout en 127.0.0.1 : c'est la résolution à la connexion qui l'arrête.
  const pilote = creerPiloteS3({ ...base, endpoint: "https://localhost." });
  await assert.rejects(pilote.remove("x"), /injoignable/);
});
