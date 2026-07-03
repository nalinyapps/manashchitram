import { StickyNoteNode } from "./StickyNoteNode";
import { TextBlockNode } from "./TextBlockNode";
import { ShapeNode } from "./ShapeNode";
import { SanskritCardNode } from "./SanskritCardNode";
import { ShlokaCardNode } from "./ShlokaCardNode";
import { GrammarCardNode } from "./GrammarCardNode";
import { FrameNode } from "./FrameNode";

export const nodeTypes = {
  // Legacy "mindmap" nodes are migrated to shapes on load; alias to ShapeNode
  // as a safety fallback so any stray mindmap node still renders consistently.
  mindmap: ShapeNode,
  sticky: StickyNoteNode,
  text: TextBlockNode,
  shape: ShapeNode,
  sanskrit: SanskritCardNode,
  shloka: ShlokaCardNode,
  grammar: GrammarCardNode,
  frame: FrameNode,
};

export {
  StickyNoteNode,
  TextBlockNode,
  ShapeNode,
  SanskritCardNode,
  ShlokaCardNode,
  GrammarCardNode,
  FrameNode,
};
