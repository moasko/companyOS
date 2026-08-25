// Modèle de document de l'éditeur — frontière de persistance typée.
// Le runtime de l'éditeur garde ses objets français ; ce modèle décrit la
// représentation sauvegardée, migrable et partageable. `extras` sert de
// pont sans perte pour les champs runtime non encore typés.

export type DesignId = string;

export type TypeElement = "text" | "image" | "shape" | "line" | "path" | "group";

export type Unite = "px" | "mm" | "cm" | "in";

export type Remplissage =
  | { type: "uni"; couleur: string }
  | { type: "degrade"; angle: number; depuis: string; vers: string };

export type Ombre = { couleur: string; flou: number; x: number; y: number };

export type FiltresImage = {
  luminosite: number;
  contraste: number;
  saturation: number;
  teinte: number;
  flou: number;
  niveauxGris: number;
  sepia: number;
};

export type Guide = { axe: "h" | "v"; position: number };

export type FondPage = { couleur: string; transparent: boolean };

export type BaseElement = {
  id: DesignId;
  name: string;
  type: TypeElement;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  parentId: DesignId | null;
  children: DesignId[];
  extras?: Record<string, unknown>;
};

export type TextElement = BaseElement & {
  type: "text";
  content: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  fill: Remplissage;
  lineHeight: number;
  letterSpacing: number;
  underline: boolean;
  strike: boolean;
  casse: "aucune" | "majuscules" | "minuscules";
};

export type ImageElement = BaseElement & {
  type: "image";
  src: string;
  fit: "cover" | "contain" | "fill";
  flipX: boolean;
  flipY: boolean;
  filters?: FiltresImage;
  shadow?: Ombre;
  blendMode?: string;
};

export type ShapeElement = BaseElement & {
  type: "shape";
  shape: "rectangle" | "ellipse" | "triangle" | "etoile";
  fill: Remplissage;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  cornerRadii?: [number, number, number, number];
  motif?: "aucune" | "points";
  shadow?: Ombre;
  blendMode?: string;
};

export type LineElement = BaseElement & {
  type: "line";
  stroke: string;
  strokeWidth: number;
};

export type PathElement = BaseElement & {
  type: "path";
  sousType: "plume" | "trait";
  stroke: string;
  strokeWidth: number;
  points: { px: number; py: number; ax?: number | null; ay?: number | null; bx?: number | null; by?: number | null }[];
  ferme: boolean;
  rempli?: boolean;
  couleurRempli?: string;
};

export type GroupElement = BaseElement & {
  type: "group";
};

export type DesignElement = TextElement | ImageElement | ShapeElement | LineElement | PathElement | GroupElement;

export type DesignPage = {
  id: DesignId;
  name: string;
  width: number;
  height: number;
  background: FondPage;
  elements: DesignElement[];
  guides: { h: number[]; v: number[] };
  hidden: boolean;
};

export type DesignDocument = {
  id: DesignId;
  name: string;
  version: 1;
  width: number;
  height: number;
  unit: Unite;
  pages: DesignPage[];
  activePageId: DesignId;
  createdAt: string;
  updatedAt: string;
};
