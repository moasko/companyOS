// Messagerie : les gardes qui ne dépendent pas de la base.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgresql://test@localhost:1/test";
process.env.JWT_SECRET ||= "secret-de-test";

const { creerClientImap, PORTS_IMAP } = await import("../src/courrielsSync.js");
const { nettoyerHtml } = await import("../src/courriels.js");

test("IMAP : seuls les ports IMAP sont admis", async () => {
  assert.deepEqual(PORTS_IMAP, [993, 143]);
  await assert.rejects(creerClientImap({ host: "imap.exemple.ci", port: 22, user: "a", pass: "b" }), /Port IMAP non autorisé/);
});

test("IMAP : une adresse du réseau interne est refusée", async () => {
  delete process.env.AUTORISER_RESEAU_PRIVE;
  for (const host of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "localhost"]) {
    await assert.rejects(creerClientImap({ host, port: 993, user: "a", pass: "b" }), /adresse publique/, host);
  }
});

test("HTML reçu : scripts, gestionnaires, iframes et liens javascript retirés", () => {
  const propre = nettoyerHtml(
    '<p onclick="voler()">Bonjour<script>voler()</script></p><iframe src="https://x"></iframe>' +
      '<a href="javascript:alert(1)">piège</a><a href="https://ok.ci">ok</a>' +
      '<img src="https://pixel.example/p.gif" onerror="x()"><form action="https://x"><input name="mdp"></form>' +
      '<div style="width:expression(alert(1))">s</div>',
  );
  assert.doesNotMatch(propre, /script|onclick|onerror|iframe|javascript:|<form|<input|expression/i);
  assert.match(propre, /<a href="https:\/\/ok.ci" target="_blank" rel="noopener noreferrer nofollow">ok<\/a>/);
  assert.match(propre, /<img src="https:\/\/pixel.example\/p.gif"/);
});
