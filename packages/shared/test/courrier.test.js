import test from "node:test";
import assert from "node:assert/strict";
import {
  analyserAdresse,
  citation,
  dateListe,
  filDe,
  formaterAdresse,
  htmlDeTexte,
  listeAdresses,
  nomAffiche,
  repondreATous,
  sujetNormalise,
  sujetReponse,
  sujetTransfert,
  texteDeHtml,
} from "../src/courrier.js";

test("adresses « Nom <email> »", () => {
  assert.deepEqual(analyserAdresse("Awa Koné <AWA@konan.ci>"), { nom: "Awa Koné", email: "awa@konan.ci" });
  assert.deepEqual(analyserAdresse('"Koné, Awa" <awa@konan.ci>'), { nom: "Koné, Awa", email: "awa@konan.ci" });
  assert.deepEqual(analyserAdresse("kofi@konan.ci"), { nom: "", email: "kofi@konan.ci" });
  assert.deepEqual(
    listeAdresses('"Koné, Awa" <awa@konan.ci>, kofi@konan.ci; awa@konan.ci').map((x) => x.email),
    ["awa@konan.ci", "kofi@konan.ci"],
  );
  assert.equal(formaterAdresse({ nom: "Koné, Awa", email: "a@b.ci" }), '"Koné, Awa" <a@b.ci>');
  assert.equal(nomAffiche({ email: "awa.kone@konan.ci" }), "Awa Kone");
});

test("sujets de réponse et de transfert", () => {
  assert.equal(sujetNormalise("RE: Re : TR: Fwd: Devis 12"), "Devis 12");
  assert.equal(sujetReponse("Re: Devis"), "Re : Devis");
  assert.equal(sujetTransfert("Devis"), "Tr : Devis");
});

test("répondre à tous sans soi-même ni doublon", () => {
  const m = {
    deNom: "Client",
    deEmail: "client@x.ci",
    a: [{ email: "moi@konan.ci" }, { email: "collegue@konan.ci" }],
    cc: [{ email: "client@x.ci" }, { email: "compta@x.ci" }],
  };
  const r = repondreATous(m, ["moi@konan.ci"]);
  assert.deepEqual(r.a.map((x) => x.email), ["client@x.ci", "collegue@konan.ci"]);
  assert.deepEqual(r.cc.map((x) => x.email), ["compta@x.ci"]);
});

test("HTML ↔ texte, citation", () => {
  assert.equal(texteDeHtml("<p>Bonjour&nbsp;<b>Awa</b></p><script>x()</script><p>À bientôt</p>"), "Bonjour Awa\nÀ bientôt");
  assert.match(htmlDeTexte("a <b>\n\nvoir https://x.ci"), /<p>a &lt;b&gt;<\/p><p>voir <a href="https:\/\/x.ci">/);
  const c = citation({ deNom: "Awa", deEmail: "a@b.ci", date: "2026-10-01T10:00:00Z", texte: "ligne 1\nligne 2" });
  assert.match(c.texte, /a écrit :\n> ligne 1\n> ligne 2/);
  assert.match(c.html, /<blockquote/);
});

test("fil retrouvé par In-Reply-To puis References", async () => {
  const connus = { "<b@x>": "fil-1" };
  const trouver = async (id) => connus[id] || null;
  assert.equal(await filDe({ inReplyTo: "<c@x>", references: ["<a@x>", "<b@x>"] }, trouver), "fil-1");
  assert.equal(await filDe({ inReplyTo: "<z@x>", references: [] }, trouver), null);
});

test("date de liste", () => {
  const maintenant = new Date("2026-10-10T15:00:00");
  assert.match(dateListe("2026-10-10T09:05:00", maintenant), /09:05/);
  assert.equal(dateListe("2026-10-09T09:05:00", maintenant), "hier");
});
