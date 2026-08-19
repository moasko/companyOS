import type { EditorDocument, NodeId, Point, Viewport } from "./types.ts";

export const screenToWorld = (point: Point, viewport: Viewport): Point => ({
  x: viewport.worldOrigin.x + (point.x - viewport.screenOrigin.x) / viewport.scaleX,
  y: viewport.worldOrigin.y + (point.y - viewport.screenOrigin.y) / viewport.scaleY,
});

export const worldToScreen = (point: Point, viewport: Viewport): Point => ({
  x: viewport.screenOrigin.x + (point.x - viewport.worldOrigin.x) * viewport.scaleX,
  y: viewport.screenOrigin.y + (point.y - viewport.worldOrigin.y) * viewport.scaleY,
});

export const getWorldPosition = (document: EditorDocument, nodeId: NodeId): Point => {
  const visited = new Set<NodeId>();
  let current = document.nodes[nodeId];
  if (!current) throw new Error(`Nœud introuvable : ${nodeId}`);
  let x = current.x;
  let y = current.y;
  while (current.parentId) {
    if (visited.has(current.id)) throw new Error("Cycle détecté dans la hiérarchie");
    visited.add(current.id);
    current = document.nodes[current.parentId];
    if (!current) throw new Error("Parent introuvable dans la hiérarchie");
    x += current.x;
    y += current.y;
  }
  return { x, y };
};

export const localToWorld = (document: EditorDocument, parentId: NodeId | null, point: Point): Point => {
  if (!parentId) return point;
  const parent = getWorldPosition(document, parentId);
  return { x: parent.x + point.x, y: parent.y + point.y };
};

export const worldToLocal = (document: EditorDocument, parentId: NodeId | null, point: Point): Point => {
  if (!parentId) return point;
  const parent = getWorldPosition(document, parentId);
  return { x: point.x - parent.x, y: point.y - parent.y };
};
