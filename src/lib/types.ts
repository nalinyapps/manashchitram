import type { Node, Edge, Viewport } from "@xyflow/react";

export type ScriptMode = "plain" | "devanagari" | "iast" | "mixed";
export type BoardStorageMode = "local" | "supabase";
export type SanskritDisplayMode = "devanagari" | "iast" | "both-stacked" | "both-side";
export type GrammarCategory =
  | "sandhi"
  | "samasa"
  | "vibhakti"
  | "tinganta"
  | "krdanta"
  | "taddhita"
  | "avyaya"
  | "chandas"
  | "alankara"
  | "other";
export type MemorizationStatus = "new" | "learning" | "memorized";
export type ShapeType =
  | "rectangle"
  | "rounded"
  | "circle"
  | "diamond"
  | "capsule"
  | "callout"
  | "triangle"
  | "hexagon"
  | "star"
  | "arrow";
export type CanvasTool =
  | "select"
  | "pan"
  | "mindmap"
  | "sticky"
  | "text"
  | "shape"
  | "connector"
  | "frame"
  | "pen"
  | "image"
  | "sanskrit"
  | "shloka"
  | "grammar";
export type SaveStatus = "saved" | "saving" | "unsaved" | "error";
export type EdgeCurveStyle = "smooth" | "straight" | "step";

export type LayoutMode =
  | "freeForm"
  | "fromParentFreeForm"
  | "horizontal"
  | "vertical"
  | "list"
  | "topDown"
  | "linear"
  | "radial"
  | "matrix";

export interface BoardSettings {
  background: "dots" | "grid" | "plain";
  theme: "light" | "dark" | "system";
  snapToGrid: boolean;
  defaultScriptMode: ScriptMode;
  defaultNodeColor: string;
  defaultFont: string;
  gridSize?: number;
}

export interface BoardContent {
  version: number;
  nodes: VidyaNode[];
  edges: VidyaEdge[];
  viewport?: Viewport;
  settings: BoardSettings;
}

export interface VidyaBoard {
  id: string;
  userId?: string | null;
  title: string;
  description?: string | null;
  content: BoardContent;
  thumbnailUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  storageMode: BoardStorageMode;
}

export interface BorderLayer {
  id: string;
  color: string;
  width: number;
  /** Gap (px) between this layer and the previous one */
  offset?: number;
  style: "solid" | "dashed" | "dotted";
}

export type InternalFillKind = "free" | "rect" | "circle" | "ellipse" | "diamond" | "triangle";

export interface InternalFillRegion {
  id: string;
  /** Shape kind — defaults to "free" for legacy freeform regions */
  kind?: InternalFillKind;
  /** Freeform path points as 0–100 percentage values of the node's width/height */
  points?: Array<{ x: number; y: number }>;
  /** Bounding box (0–100 percentage) for predefined resizable shapes */
  rect?: { x: number; y: number; w: number; h: number };
  fillColor: string;
  opacity: number;
  createdAt?: string;
}

export interface BaseNodeData extends Record<string, unknown> {
  label?: string;
  color?: string;
  fillColor?: string;
  /** 0–1 opacity applied to fillColor (defaults to a soft ~0.18) */
  fillOpacity?: number;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  borderStyle?: "solid" | "dashed" | "dotted";
  borderLayers?: BorderLayer[];
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: "normal" | "italic";
  fontWeight?: "normal" | "bold";
  textColor?: string;
  textAlign?: "left" | "center" | "right" | "justify";
  internalFillRegions?: InternalFillRegion[];
  tags?: string[];
  notes?: string;
  locked?: boolean;
  // ── Hierarchy / layout metadata ──
  /** Structural parent (source of the parent→child edge). null/undefined = root. */
  parentId?: string | null;
  /** Explicit sibling order (child node ids) for stable layouts. */
  childOrder?: string[];
  /** Layout mode last applied to this node's branch (set on the branch root). */
  layoutMode?: LayoutMode;
}

export interface MindMapNodeData extends BaseNodeData {
  text: string;
  richText?: string;
  scriptMode: ScriptMode;
  collapsed?: boolean;
  parentId?: string;
}

export interface StickyNoteNodeData extends BaseNodeData {
  text: string;
  richText?: string;
}

export interface TextBlockNodeData extends BaseNodeData {
  text?: string;
  richText?: string;
  scriptMode: ScriptMode;
}

export interface ShapeNodeData extends BaseNodeData {
  shapeType: ShapeType;
  text?: string;
}

export interface SanskritCardNodeData extends BaseNodeData {
  title: string;
  source?: string;
  devanagari: string;
  iast: string;
  translation?: string;
  grammarNotes?: string;
  displayMode: SanskritDisplayMode;
}

export interface ShlokaCardNodeData extends BaseNodeData {
  title: string;
  sourceText?: string;
  devanagari: string;
  iast: string;
  padaccheda?: string;
  anvaya?: string;
  padartha?: string;
  translation?: string;
  chandas?: string;
  memorizationStatus: MemorizationStatus;
  collapsedSections?: string[];
}

export interface GrammarCardNodeData extends BaseNodeData {
  topic: string;
  category: GrammarCategory;
  rule: string;
  examples: string[];
  exceptions?: string;
}

export interface FrameNodeData extends BaseNodeData {
  title: string;
  background?: string;
  presentationOrder?: number;
}

export interface VidyaEdgeData extends Record<string, unknown> {
  label?: string;
  color?: string;
  width?: number;
  dashed?: boolean;
  hiddenInMatrix?: boolean;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  curveStyle?: EdgeCurveStyle;
  edgeType?: "normal" | "arrow" | "labeled" | "branch" | "dashed" | "sanskrit";
}

export type VidyaNode = Node<
  | MindMapNodeData
  | StickyNoteNodeData
  | TextBlockNodeData
  | ShapeNodeData
  | SanskritCardNodeData
  | ShlokaCardNodeData
  | GrammarCardNodeData
  | FrameNodeData
>;
export type VidyaEdge = Edge<VidyaEdgeData>;

export interface AppSettings {
  theme: "light" | "dark" | "system";
  defaultScriptMode: ScriptMode;
  defaultDevanagariFont: string;
  defaultIastFont: string;
  autosaveEnabled: boolean;
  defaultGrid: boolean;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: "general" | "sanskrit" | "study" | "planning";
  content: BoardContent;
}

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  background: "dots",
  theme: "system",
  snapToGrid: false,
  defaultScriptMode: "plain",
  defaultNodeColor: "#6366f1",
  defaultFont: "Inter",
  gridSize: 20,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: "system",
  defaultScriptMode: "plain",
  defaultDevanagariFont: "Noto Sans Devanagari",
  defaultIastFont: "Georgia",
  autosaveEnabled: true,
  defaultGrid: true,
};

export const SANSKRIT_TAG_SUGGESTIONS = [
  "सन्धिः",
  "समासः",
  "विभक्तिः",
  "धातुः",
  "तिङन्तम्",
  "कृदन्तम्",
  "तद्धितम्",
  "छन्दः",
  "अलङ्कारः",
  "अन्वयः",
  "पदार्थः",
  "भाष्यम्",
  "काव्यम्",
  "गीता",
  "रामायणम्",
  "भागवतम्",
  "स्मरणम्",
];

export const SANSKRIT_EDGE_LABELS = [
  "कारणम्",
  "उदाहरणम्",
  "विपरीतम्",
  "सम्बन्धः",
  "अन्वयः",
  "विभक्तिः",
  "सन्धिः",
  "समासः",
];
