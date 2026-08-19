import test from "node:test";
import assert from "node:assert/strict";
import { getSelectionBounds, getWorldPosition, groupNodes, localToWorld, reparentNode, screenToWorld, ungroupNode, worldToLocal, worldToScreen } from "../src/apps/modules/image/editor/core/index.ts";
import { assertNodeStore, createNodeStore, listNodeStore, replaceNodeStore } from "../src/apps/modules/image/editor/state/node-store.ts";

const node = (id, x, y, parentId = null) => ({ id, sceneId: "s1", parentId, children: [], type: "RECTANGLE", name: id, x, y, width: 20, height: 10, rotation: 0, opacity: 1, visible: true, locked: false });
const documentFixture = () => ({ scenes: { s1: { id: "s1", name: "Scène", width: 1000, height: 800, background: null, rootIds: ["frame", "b"] } }, nodes: { frame: { ...node("frame", 400, 200), type: "FRAME", width: 200, height: 160, children: ["a"] }, a: node("a", 20, 30, "frame"), b: node("b", 100, 80) } });

test("les conversions écran/monde sont réversibles avec le zoom", () => {
  const viewport = { screenOrigin: { x: 100, y: 50 }, worldOrigin: { x: -20, y: 30 }, scaleX: 2, scaleY: 2 };
  const world = screenToWorld({ x: 300, y: 250 }, viewport);
  assert.deepEqual(world, { x: 80, y: 130 });
  assert.deepEqual(worldToScreen(world, viewport), { x: 300, y: 250 });
});

test("les coordonnées locales suivent leur parent", () => {
  const document = documentFixture();
  assert.deepEqual(getWorldPosition(document, "a"), { x: 420, y: 230 });
  assert.deepEqual(localToWorld(document, "frame", { x: 20, y: 30 }), { x: 420, y: 230 });
  assert.deepEqual(worldToLocal(document, "frame", { x: 450, y: 260 }), { x: 50, y: 60 });
});

test("le changement de parent conserve la position visuelle", () => {
  const document = documentFixture();
  const before = getWorldPosition(document, "b");
  const result = reparentNode(document, "b", "frame");
  assert.deepEqual(getWorldPosition(result, "b"), before);
  assert.equal(result.nodes.b.parentId, "frame");
});

test("les bounds de sélection englobent tous les nœuds", () => {
  const bounds = getSelectionBounds(documentFixture(), ["a", "b"]);
  assert.deepEqual(bounds, { x: 100, y: 80, width: 340, height: 160 });
});

test("grouper puis dégrouper conserve les positions globales", () => {
  const document = documentFixture();
  const beforeA = getWorldPosition(document, "frame");
  const beforeB = getWorldPosition(document, "b");
  const grouped = groupNodes(document, ["frame", "b"], "g1");
  assert.equal(grouped.nodes.frame.parentId, "g1");
  assert.deepEqual(getWorldPosition(grouped, "frame"), beforeA);
  const ungrouped = ungroupNode(grouped, "g1");
  assert.deepEqual(getWorldPosition(ungrouped, "frame"), beforeA);
  assert.deepEqual(getWorldPosition(ungrouped, "b"), beforeB);
  assert.equal(ungrouped.nodes.g1, undefined);
});

test("un parent ne peut pas entrer dans son descendant", () => {
  assert.throws(() => reparentNode(documentFixture(), "frame", "a"), /cyclique/);
});

test("le magasin normalisé conserve l’ordre sans dupliquer les objets", () => {
  const store = createNodeStore([{ id: "a", name: "A" }, { id: "b", name: "B" }], "s1");
  assert.deepEqual(store.rootIds, ["a", "b"]);
  assert.deepEqual(listNodeStore(store).map((item) => item.name), ["A", "B"]);
  const next = replaceNodeStore(store, [...listNodeStore(store)].reverse());
  assert.deepEqual(next.order, ["b", "a"]);
  assert.doesNotThrow(() => assertNodeStore(next));
});
