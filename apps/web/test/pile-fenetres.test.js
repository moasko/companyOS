import test from "node:test";
import assert from "node:assert/strict";
import { appliquerMode } from "../src/apps/pileFenetres.js";

const fenetre = () => ({ hide: true, max: null, z: 0, size: "mini" });
const depart = () => ({ hz: 2, a: fenetre(), b: fenetre(), c: fenetre() });
const actives = (s) => Object.entries(s).filter(([k, f]) => k !== "hz" && f.z === s.hz && f.max && !f.hide).map(([k]) => k);

test("barre des tâches : une fenêtre recouverte revient devant au lieu de se réduire", () => {
  let s = appliquerMode(depart(), "a", "full");
  s = appliquerMode(s, "b", "full");
  assert.deepEqual(actives(s), ["b"]);
  s = appliquerMode(s, "a", "togg");
  assert.equal(s.a.max, true);
  assert.deepEqual(actives(s), ["a"]);
});

test("barre des tâches : la fenêtre active se réduit, la suivante devient active", () => {
  let s = appliquerMode(depart(), "a", "full");
  s = appliquerMode(s, "b", "full");
  s = appliquerMode(s, "b", "togg");
  assert.equal(s.b.max, false);
  assert.equal(s.b.hide, false);
  assert.deepEqual(actives(s), ["a"]);
  s = appliquerMode(s, "b", "togg");
  assert.deepEqual(actives(s), ["b"]);
});

test("fermer une fenêtre d'arrière-plan ne crée pas deux fenêtres au même plan", () => {
  let s = appliquerMode(depart(), "a", "full");
  s = appliquerMode(s, "b", "full");
  s = appliquerMode(s, "a", "close");
  s = appliquerMode(s, "c", "full");
  assert.notEqual(s.b.z, s.c.z);
  assert.deepEqual(actives(s), ["c"]);
});

test("fermer ou réduire la fenêtre active rend la main à celle de derrière", () => {
  let s = appliquerMode(depart(), "a", "full");
  s = appliquerMode(s, "b", "full");
  s = appliquerMode(s, "c", "full");
  s = appliquerMode(s, "c", "close");
  assert.deepEqual(actives(s), ["b"]);
  s = appliquerMode(s, "b", "mnmz");
  assert.deepEqual(actives(s), ["a"]);
});
