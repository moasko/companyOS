import test from "node:test";
import assert from "node:assert/strict";

import { BARRE_VISIBLE, POIGNEE_VISIBLE, bornes, ramener } from "../src/apps/gardeFenetres.js";

test("une fenêtre bien placée n'est pas touchée", () => {
  assert.equal(ramener({ top: 50, left: 80, width: 900, height: 600 }, 1440, 860), null);
});

test("barre de titre au-dessus de l'écran : redescendue à 0", () => {
  assert.deepEqual(ramener({ top: -120, left: 80, width: 900, height: 600 }, 1440, 860), { top: 0, left: 80, width: 900, height: 600 });
});

test("boutons hors de l'écran à droite : la fenêtre revient", () => {
  const r = ramener({ top: 40, left: 900, width: 900, height: 600 }, 1440, 860);
  assert.equal(r.left, 1440 - 900);
});

test("fenêtre plus grande que l'écran (taille minimale de grand écran) : réduite et calée", () => {
  const r = ramener({ top: 30, left: 60, width: 940, height: 580 }, 800, 520);
  assert.deepEqual(r, { top: 0, left: 0, width: 800, height: 520 });
});

test("barre de titre sous le bas de l'écran : remontée", () => {
  const r = ramener({ top: 900, left: 10, width: 400, height: 300 }, 1440, 860);
  assert.equal(r.top, 860 - BARRE_VISIBLE);
});

test("une poignée de barre de titre reste visible à gauche", () => {
  const b = bornes(900, 600, 1440, 860);
  assert.equal(b.minLeft, POIGNEE_VISIBLE - 900);
  const r = ramener({ top: 10, left: -880, width: 900, height: 600 }, 1440, 860);
  assert.equal(r.left, POIGNEE_VISIBLE - 900);
});
