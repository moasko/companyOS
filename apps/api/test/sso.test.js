// Authentification unique : configuration, URL d'autorisation et surtout
// vérification de l'id_token, avec un faux fournisseur (clé générée ici).

import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET ||= "secret-de-test";

const sso = await import("../src/sso.js");

const EMETTEUR = "https://idp.exemple.ci";
const CLIENT = "client-companyos";
const decouverte = { jwks_uri: `${EMETTEUR}/jwks`, authorization_endpoint: `${EMETTEUR}/authorize`, token_endpoint: `${EMETTEUR}/token` };
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
sso.amorcerCache(`jwks:${decouverte.jwks_uri}`, { keys: [jwk] });

const jeton = (revendications = {}, { emetteur = EMETTEUR, audience = CLIENT, expire = "5m", cle = privateKey } = {}) =>
  new SignJWT({ email: "awa@entreprise.ci", email_verified: true, name: "Awa Koné", nonce: "n1", ...revendications })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(emetteur)
    .setAudience(audience)
    .setSubject("sub-123")
    .setIssuedAt()
    .setExpirationTime(expire)
    .sign(cle);

const verifier = (t, nonce = "n1") => sso.verifierIdToken(t, { decouverte, emetteur: EMETTEUR, clientId: CLIENT, nonce });

test("un id_token valide donne l'identité", async () => {
  const id = await verifier(await jeton());
  assert.deepEqual(id, { email: "awa@entreprise.ci", nom: "Awa Koné", sujet: "sub-123" });
});

test("refusés : mauvaise audience, émetteur, nonce, expiré, e-mail non vérifié, mauvaise signature", async () => {
  await assert.rejects(verifier(await jeton({}, { audience: "autre-client" })));
  await assert.rejects(verifier(await jeton({}, { emetteur: "https://pirate.exemple" })));
  await assert.rejects(verifier(await jeton(), "autre-nonce"), /Nonce/);
  await assert.rejects(verifier(await jeton({}, { expire: Math.floor(Date.now() / 1000) - 3600 })));
  await assert.rejects(verifier(await jeton({ email_verified: false })), /non vérifiée/);
  const { privateKey: autre } = await generateKeyPair("RS256");
  await assert.rejects(verifier(await jeton({}, { cle: autre })));
  await assert.rejects(verifier(await jeton({ email: undefined, preferred_username: undefined })), /adresse/);
});

test("configuration : validée et normalisée", () => {
  assert.equal(sso.validerConfigSso({ emetteur: "http://idp.exemple.ci", clientId: "x", domaines: "a.ci" }).ok, false);
  assert.equal(sso.validerConfigSso({ emetteur: EMETTEUR, clientId: "", domaines: "a.ci" }).ok, false);
  assert.equal(sso.validerConfigSso({ emetteur: EMETTEUR, clientId: "x", domaines: "pas un domaine" }).ok, false);
  const r = sso.validerConfigSso({ emetteur: `${EMETTEUR}/`, clientId: " x ", domaines: "@Entreprise.ci, filiale.ci entreprise.ci", obligatoire: true });
  assert.ok(r.ok);
  assert.deepEqual(r.valeur, { actif: true, emetteur: EMETTEUR, clientId: "x", domaines: ["entreprise.ci", "filiale.ci"], obligatoire: true, creerComptes: false });
});

test("URL d'autorisation : PKCE S256, state, nonce, login_hint", () => {
  const verificateur = sso.aleatoire(32);
  const u = new URL(sso.urlAutorisation(decouverte, { clientId: CLIENT, redirection: "https://api.exemple/retour", etat: "e", nonce: "n", defi: sso.defiPkce(verificateur), email: "awa@entreprise.ci" }));
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("code_challenge").length, 43);
  assert.equal(u.searchParams.get("scope"), "openid email profile");
  assert.equal(u.searchParams.get("login_hint"), "awa@entreprise.ci");
  assert.equal(sso.domaineDe("Awa@Entreprise.CI"), "entreprise.ci");
});
