import type { NodeId, SceneId } from "../core/types.ts";

export type IdentifiedNode = { id: NodeId; parentId?: NodeId | null; children?: NodeId[]; sceneId?: SceneId };
export type StoredNode<T extends IdentifiedNode> = T & { parentId: NodeId | null; children: NodeId[]; sceneId: SceneId };

export type NodeStore<T extends IdentifiedNode> = {
  sceneId: SceneId;
  nodes: Record<NodeId, StoredNode<T>>;
  rootIds: NodeId[];
  order: NodeId[];
};

export const createNodeStore = <T extends IdentifiedNode>(items: readonly T[], sceneId: SceneId): NodeStore<T> => {
  const nodes: Record<NodeId, StoredNode<T>> = {};
  const order: NodeId[] = [];
  for (const item of items) {
    if (!item?.id || nodes[item.id]) continue;
    nodes[item.id] = { ...item, sceneId, parentId: item.parentId ?? null, children: [...(item.children ?? [])] };
    order.push(item.id);
  }
  const rootIds = order.filter((nodeId) => nodes[nodeId].parentId === null);
  return { sceneId, nodes, rootIds, order };
};

export const listNodeStore = <T extends IdentifiedNode>(store: NodeStore<T>): StoredNode<T>[] =>
  store.order.map((nodeId) => store.nodes[nodeId]).filter(Boolean);

export const replaceNodeStore = <T extends IdentifiedNode>(store: NodeStore<T>, items: readonly T[]): NodeStore<T> =>
  createNodeStore(items, store.sceneId);

export const assertNodeStore = <T extends IdentifiedNode>(store: NodeStore<T>): void => {
  const ids = new Set(store.order);
  if (ids.size !== store.order.length) throw new Error("Ordre de nœuds dupliqué");
  for (const node of Object.values(store.nodes)) {
    if (node.sceneId !== store.sceneId) throw new Error("Nœud rattaché à une mauvaise scène");
    if (node.parentId && !store.nodes[node.parentId]) throw new Error("Parent de nœud introuvable");
    if (node.parentId === node.id) throw new Error("Un nœud ne peut pas être son propre parent");
  }
};
