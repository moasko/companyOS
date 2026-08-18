import test from "node:test";
import assert from "node:assert/strict";

import { familleDe } from "../src/apps/fileTypes.js";

test("un fichier DOCX est associé à la fenêtre réelle du traitement de texte", () => {
  const famille = familleDe({
    type: "FILE",
    name: "Contrat.DOCX",
    mimeType: "application/octet-stream",
  });

  assert.equal(famille?.genre, "document");
  assert.equal(famille?.app, "winWord");
  assert.equal(famille?.action, "WORDAPP");
});

test("le MIME Word ouvre aussi le traitement de texte sans extension exploitable", () => {
  const famille = familleDe({
    type: "FILE",
    name: "document",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  assert.equal(famille?.app, "winWord");
});
