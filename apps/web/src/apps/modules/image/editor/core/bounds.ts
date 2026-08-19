import type { Bounds, EditorDocument, NodeId } from "./types.ts";
import { getWorldPosition } from "./coordinates.ts";

export const unionBounds = (bounds: readonly Bounds[]): Bounds | null => {
  if (!bounds.length) return null;
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

export const getWorldBounds = (document: EditorDocument, nodeId: NodeId): Bounds => {
  const node = document.nodes[nodeId];
  if (!node) throw new Error(`Nœud introuvable : ${nodeId}`);
  const point = getWorldPosition(document, nodeId);
  return { ...point, width: node.width, height: node.height };
};

export const getSelectionBounds = (document: EditorDocument, nodeIds: readonly NodeId[]): Bounds | null =>
  unionBounds(nodeIds.map((nodeId) => getWorldBounds(document, nodeId)));
