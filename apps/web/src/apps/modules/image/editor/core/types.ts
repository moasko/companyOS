export type NodeId = string;
export type SceneId = string;

export type EditorNodeType = "FRAME" | "GROUP" | "RECTANGLE" | "ELLIPSE" | "TEXT" | "IMAGE";

export type Point = Readonly<{ x: number; y: number }>;
export type Bounds = Readonly<{ x: number; y: number; width: number; height: number }>;

export type EditorNode = {
  id: NodeId;
  sceneId: SceneId;
  parentId: NodeId | null;
  children: NodeId[];
  type: EditorNodeType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
  clipContent?: boolean;
  text?: string;
  imageUrl?: string;
};

export type Scene = {
  id: SceneId;
  name: string;
  width: number;
  height: number;
  background: string | null;
  rootIds: NodeId[];
};

export type EditorDocument = {
  scenes: Record<SceneId, Scene>;
  nodes: Record<NodeId, EditorNode>;
};

export type Viewport = {
  screenOrigin: Point;
  worldOrigin: Point;
  scaleX: number;
  scaleY: number;
};
