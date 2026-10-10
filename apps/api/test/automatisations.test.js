// Push et webhooks : les gardes qui ne dépendent pas de la base.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET ||= "secret-de-test";

const { endpointAccepte, chargeNotification } = await import("../src/push.js");
const { signer, secretWebhook, ecritureInterdite } = await import("../src/moteurAutomatisations.js");
const { clientDe } = await import("../src/evenements.js");

test("push : seuls les grands services de push sont acceptés", () => {
  for (const ok of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QGx",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
  ]) {
    assert.ok(endpointAccepte(ok), ok);
  }
  for (const ko of [
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com:8443/x",
    "https://127.0.0.1/x",
    "https://169.254.169.254/latest/meta-data",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evil.example/fcm.googleapis.com",
    "https://user:pass@fcm.googleapis.com/x",
    "pas une adresse",
    null,
  ]) {
    assert.equal(endpointAccepte(ko), false, String(ko));
  }
});

test("push : la charge est bornée", () => {
  const c = JSON.parse(chargeNotification({ titre: "x".repeat(500), message: "y".repeat(1000), lien: { app: "crm" } }));
  assert.equal(c.titre.length, 140);
  assert.equal(c.message.length, 300);
  assert.deepEqual(c.lien, { app: "crm" });
});

test("webhook : signature HMAC vérifiable par le destinataire", () => {
  const secret = secretWebhook("auto1");
  assert.equal(secret, secretWebhook("auto1"), "stable");
  assert.notEqual(secret, secretWebhook("auto2"), "propre à chaque automatisation");
  const corps = JSON.stringify({ a: 1 });
  const attendu = `sha256=${createHmac("sha256", secret).update(`1700000000.${corps}`).digest("hex")}`;
  assert.equal(signer(secret, "1700000000", corps), attendu);
});

test("moteur : jamais d'écriture dans les collections exécutées", () => {
  assert.ok(ecritureInterdite("campagnes", "campagnes"));
  assert.ok(ecritureInterdite("courrier", "relances"));
  assert.ok(ecritureInterdite("entreprise", "profil"));
  assert.equal(ecritureInterdite("crm", "activites"), false);
});

test("bus : l'identifiant d'onglet est filtré", () => {
  assert.equal(clientDe({ headers: { "x-client-id": "abcdEFGH1234" } }), "abcdEFGH1234");
  assert.equal(clientDe({ headers: { "x-client-id": "<script>" } }), null);
  assert.equal(clientDe({ headers: { "x-client-id": "x".repeat(100) } }), null);
  assert.equal(clientDe({ headers: {} }), null);
});
