import assert from "node:assert/strict";
import test from "node:test";

import {
  MODELES_PRESENTATION,
  diaporamaVierge,
} from "../src/apps/modules/presentation/gabarit.js";

test("la galerie propose une entrée vierge et trois récits professionnels", () => {
  assert.deepEqual(
    MODELES_PRESENTATION.map(({ id }) => id),
    ["vierge", "pitch", "rapport", "projet"],
  );
});

test("les modèles produisent de vrais fichiers PowerPoint", async () => {
  for (const id of ["vierge", "pitch"]) {
    const contenu = await diaporamaVierge(id);
    assert.ok(contenu instanceof Uint8Array);
    assert.equal(contenu[0], 0x50);
    assert.equal(contenu[1], 0x4b);
    assert.ok(contenu.byteLength > 10_000);
  }
});
