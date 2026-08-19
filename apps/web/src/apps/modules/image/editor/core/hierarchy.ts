import { getSelectionBounds } from "./bounds.ts";
import { getWorldPosition, worldToLocal } from "./coordinates.ts";
import type { EditorDocument, EditorNode, NodeId } from "./types.ts";

const removeId = (ids: readonly NodeId[], id: NodeId): NodeId[] => ids.filter((item) => item !== id);

export const isDescendant = (document: EditorDocument, possibleDescendant: NodeId, ancestor: NodeId): boolean => {
  let current = document.nodes[possibleDescendant];
  const visited = new Set<NodeId>();
  while (current?.parentId) {
    if (current.parentId === ancestor) return true;
    if (visited.has(current.id)) throw new Error("Cycle détecté dans la hiérarchie");
    visited.add(current.id);
    current = document.nodes[current.parentId];
  }
  return false;
};

export const reparentNode = (document: EditorDocument, nodeId: NodeId, parentId: NodeId | null): EditorDocument => {
  const node = document.nodes[nodeId];
  if (!node) throw new Error(`Nœud introuvable : ${nodeId}`);
  if (parentId === nodeId || (parentId && isDescendant(document, parentId, nodeId))) throw new Error("Parentage cyclique interdit");
  const parent = parentId ? document.nodes[parentId] : null;
  if (parentId && (!parent || parent.sceneId !== node.sceneId)) throw new Error("Le parent doit appartenir à la même scène");
  if (parent && parent.type !== "FRAME" && parent.type !== "GROUP") throw new Error("Ce type de nœud ne peut pas contenir d’enfants");

  const world = getWorldPosition(document, nodeId);
  const local = worldToLocal(document, parentId, world);
  const nodes = { ...document.nodes };
  const scene = document.scenes[node.sceneId];
  if (!scene) throw new Error("Scène introuvable");

  if (node.parentId) {
    const oldParent = nodes[node.parentId];
    nodes[node.parentId] = { ...oldParent, children: removeId(oldParent.children, nodeId) };
  }
  nodes[nodeId] = { ...node, parentId, x: local.x, y: local.y };
  if (parentId) nodes[parentId] = { ...nodes[parentId], children: [...nodes[parentId].children, nodeId] };

  return {
    scenes: { ...document.scenes, [scene.id]: { ...scene, rootIds: parentId ? removeId(scene.rootIds, nodeId) : [...removeId(scene.rootIds, nodeId), nodeId] } },
    nodes,
  };
};

export const groupNodes = (document: EditorDocument, nodeIds: readonly NodeId[], groupId: NodeId, name = "Groupe"): EditorDocument => {
  const uniqueIds = [...new Set(nodeIds)];
  if (uniqueIds.length < 2) throw new Error("Un groupe exige au moins deux nœuds");
  const first = document.nodes[uniqueIds[0]];
  if (!first || uniqueIds.some((id) => document.nodes[id]?.sceneId !== first.sceneId)) throw new Error("Les nœuds doivent appartenir à la même scène");
  const commonParent = first.parentId;
  if (uniqueIds.some((id) => document.nodes[id].parentId !== commonParent)) throw new Error("Les nœuds doivent partager le même parent");
  const bounds = getSelectionBounds(document, uniqueIds);
  if (!bounds) throw new Error("Sélection vide");
  const local = worldToLocal(document, commonParent, bounds);
  const group: EditorNode = { id: groupId, sceneId: first.sceneId, parentId: commonParent, children: [], type: "GROUP", name, x: local.x, y: local.y, width: bounds.width, height: bounds.height, rotation: 0, opacity: 1, visible: true, locked: false };
  let next: EditorDocument = { scenes: { ...document.scenes }, nodes: { ...document.nodes, [groupId]: group } };
  const scene = next.scenes[first.sceneId];
  if (commonParent) {
    const parent = next.nodes[commonParent];
    next.nodes[commonParent] = { ...parent, children: [...parent.children.filter((id) => !uniqueIds.includes(id)), groupId] };
  } else {
    next.scenes[first.sceneId] = { ...scene, rootIds: [...scene.rootIds.filter((id) => !uniqueIds.includes(id)), groupId] };
  }
  for (const nodeId of uniqueIds) next = reparentNode(next, nodeId, groupId);
  return next;
};

export const ungroupNode = (document: EditorDocument, groupId: NodeId): EditorDocument => {
  const group = document.nodes[groupId];
  if (!group || group.type !== "GROUP") throw new Error("Groupe introuvable");
  let next = document;
  for (const childId of group.children) next = reparentNode(next, childId, group.parentId);
  const nodes = { ...next.nodes };
  delete nodes[groupId];
  const scene = next.scenes[group.sceneId];
  if (group.parentId) {
    const parent = nodes[group.parentId];
    nodes[group.parentId] = { ...parent, children: removeId(parent.children, groupId) };
  }
  return { scenes: { ...next.scenes, [scene.id]: { ...scene, rootIds: removeId(scene.rootIds, groupId) } }, nodes };
};
