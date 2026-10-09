import { test } from "node:test";
import assert from "node:assert/strict";
import { personnaliser, liensDe } from "../src/campagnes-blocs.js";

test("une variable ne fabrique pas de lien", () => {
  const c = { sujet: "Bonjour {{nom}}", blocs: [{ type: "texte", texte: "Bonjour {{nom}}, [notre site](https://ex.com)" }] };
  const p = personnaliser(c, { nom: "[Cliquez](https://evil.example)" });
  assert.equal(liensDe(p).length, 1);
  assert.equal(liensDe(p)[0].url, "https://ex.com");
  assert.match(p.blocs[0].texte, /\(Cliquez\)\(https:\/\/evil\.example\)/);
});
