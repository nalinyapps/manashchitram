"use client";

import { memo, useState, useEffect, useRef, useCallback } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { NodeHandles } from "./NodeHandles";
import { getTextStyle, resolveBorderWidth, resolveFillOpacity } from "@/lib/style-utils";
import type { StickyNoteNodeData, InternalFillRegion, BorderLayer } from "@/lib/types";
import { useCanvasStore } from "@/store/canvas-store";
import { useUIStore } from "@/store/ui-store";
import { RichTextEditor } from "../RichTextEditor";
import { InternalFillLayer } from "../InternalFillLayer";
import { BorderLayers } from "../BorderLayers";
import { NodeQuickActions } from "./NodeQuickActions";

const STICKY_PALETTES: Record<string, { bg: string; border: string; shadow: string }> = {
  yellow: { bg: "#fef9c3", border: "#fde047", shadow: "#fef08a" },
  pink:   { bg: "#fce7f3", border: "#f9a8d4", shadow: "#fbcfe8" },
  blue:   { bg: "#dbeafe", border: "#93c5fd", shadow: "#bfdbfe" },
  green:  { bg: "#dcfce7", border: "#86efac", shadow: "#bbf7d0" },
  orange: { bg: "#ffedd5", border: "#fdba74", shadow: "#fed7aa" },
  purple: { bg: "#f3e8ff", border: "#d8b4fe", shadow: "#e9d5ff" },
};

function StickyNoteNodeComponent({ id, data, selected }: NodeProps) {
  const d  = data as StickyNoteNodeData;
  const dd = d as Record<string, unknown>;
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const fitNodeToContent = useCanvasStore((s) => s.fitNodeToContent);
  const pushHistory    = useCanvasStore((s) => s.pushHistory);
  const createChildNode = useCanvasStore((s) => s.createChildNode);

  const drawingModeNodeId   = useUIStore((s) => s.drawingModeNodeId);
  const drawingRegionColor  = useUIStore((s) => s.drawingRegionColor);
  const drawingRegionOpacity = useUIStore((s) => s.drawingRegionOpacity);
  const isDrawing           = drawingModeNodeId === id;

  const palette  = STICKY_PALETTES[d.color ?? "yellow"] ?? STICKY_PALETTES.yellow;
  const bg       = (dd.fillColor as string) ?? palette.bg;
  const border   = (dd.borderColor as string) ?? palette.border;
  const bWidth   = resolveBorderWidth(dd);
  const bStyle   = (dd.borderStyle as string) ?? "solid";
  const bRadius  = typeof dd.borderRadius === "number" ? dd.borderRadius : 8;
  const borderLayers = (dd.borderLayers as BorderLayer[]) ?? [];
  const fillOpacity  = resolveFillOpacity(dd);
  const fillRegions  = (dd.internalFillRegions as InternalFillRegion[]) ?? [];

  const [editing, setEditing] = useState(false);
  const [initialContent] = useState(() => dd.richText as string || d.text || "");
  const editHistoryCaptured = useRef(false);
  const editDirty = useRef(false);

  const captureTextHistory = useCallback(() => {
    if (!editHistoryCaptured.current) {
      pushHistory();
      editHistoryCaptured.current = true;
    }
    editDirty.current = true;
  }, [pushHistory]);

  const finishEditing = useCallback(() => {
    if (editDirty.current) {
      pushHistory();
      editDirty.current = false;
    }
    editHistoryCaptured.current = false;
    setEditing(false);
  }, [pushHistory]);

  useEffect(() => {
    if (!selected && editing) {
      const frame = requestAnimationFrame(finishEditing);
      return () => cancelAnimationFrame(frame);
    }
  }, [selected, editing, finishEditing]);

  return (
    <>
      <NodeResizer minWidth={140} minHeight={80} isVisible={selected && !editing && !isDrawing}
        lineStyle={{ borderColor: border }} handleStyle={{ borderColor: border, backgroundColor: "white" }} />
      <div
        className={cn("group relative h-full w-full p-3 transition-shadow", selected ? "shadow-lg" : "shadow-md")}
        style={{ backgroundColor: bg, border: `${bWidth}px ${bStyle} ${border}`, borderRadius: bRadius }}
        onDoubleClick={() => {
          if (isDrawing) return;
          useCanvasStore.setState((s) => ({
            nodes: s.nodes.map((n) => n.id === id ? { ...n, style: { ...(n.style ?? {}), height: undefined } } : n),
          }));
          editHistoryCaptured.current = false;
          editDirty.current = false;
          setEditing(true);
        }}
      >
        {/* Extra border layers */}
        <BorderLayers layers={borderLayers} primaryWidth={bWidth} baseRadius={bRadius} />

        <NodeHandles color={border} />
        <NodeQuickActions nodeId={id} color={border} selected={selected} />

        {/* Add connected child */}
        {!isDrawing && (
          <button
            className="absolute -right-3.5 -bottom-3.5 z-20 hidden h-7 w-7 items-center justify-center rounded-full border-2 border-background shadow-md transition-transform hover:scale-110 group-hover:flex"
            style={{ backgroundColor: border }}
            onClick={(e) => { e.stopPropagation(); createChildNode(id); }}
            title="Add connected node"
          >
            <Plus className="h-3.5 w-3.5 text-white" />
          </button>
        )}

        {/* Internal fill regions (clipped to node bounds) */}
        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: bRadius }}>
          <InternalFillLayer
            regions={fillRegions}
            isDrawingMode={isDrawing}
            drawingColor={drawingRegionColor}
            drawingOpacity={drawingRegionOpacity}
            fillOpacity={fillOpacity}
            interactive={selected && !isDrawing}
            onRegionAdded={(r) => updateNodeData(id, { internalFillRegions: [...fillRegions, r] })}
            onRegionUpdated={(rid, patch) => updateNodeData(id, {
              internalFillRegions: fillRegions.map((x) => x.id === rid ? { ...x, ...patch } : x),
            })}
          />
        </div>

        {/* Folded-corner decoration */}
        <div className="pointer-events-none absolute bottom-0 right-0 h-5 w-5"
          style={{ borderRadius: `0 0 ${bRadius}px 0`, background: `linear-gradient(225deg, ${palette.shadow} 45%, transparent 45%)` }} />

        <div className={cn("relative z-10 nodrag nopan text-sm", editing && "cursor-text")}
          style={{ color: "#374151", ...getTextStyle(dd) }}>
          <RichTextEditor
            initialContent={initialContent}
            editable={editing}
            placeholder="Double-click to write…"
            blockAlign={dd.textAlign as "left" | "center" | "right" | "justify" | undefined}
            onChange={(html) => {
              captureTextHistory();
              const plain = html.replace(/<[^>]+>/g, "").trim();
              updateNodeData(id, { richText: html, text: plain });
            }}
            onContentSizeChange={(size) => fitNodeToContent(id, size)}
            onBlur={finishEditing}
          />
        </div>
      </div>
    </>
  );
}

export const StickyNoteNode = memo(StickyNoteNodeComponent);
