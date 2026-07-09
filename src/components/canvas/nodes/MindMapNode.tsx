"use client";

import { memo, useState, useEffect, useRef, useCallback } from "react";
import { Handle, Position, NodeResizer, type NodeProps } from "@xyflow/react";
import { Plus, ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getTextStyle, resolveFillColor, resolveBorderColor,
  resolveBorderWidth, resolveNodeBorderRadius, resolveFillOpacity,
} from "@/lib/style-utils";
import type { MindMapNodeData, InternalFillRegion, BorderLayer } from "@/lib/types";
import { useCanvasStore } from "@/store/canvas-store";
import { useUIStore } from "@/store/ui-store";
import { RichTextEditor } from "../RichTextEditor";
import { InternalFillLayer } from "../InternalFillLayer";
import { BorderLayers } from "../BorderLayers";
import { NodeQuickActions } from "./NodeQuickActions";

function MindMapNodeComponent({ id, data, selected }: NodeProps) {
  const d  = data as MindMapNodeData;
  const dd = d as Record<string, unknown>;
  const updateNodeData  = useCanvasStore((s) => s.updateNodeData);
  const fitNodeToContent = useCanvasStore((s) => s.fitNodeToContent);
  const createChildNode = useCanvasStore((s) => s.createChildNode);
  const pushHistory     = useCanvasStore((s) => s.pushHistory);

  const drawingModeNodeId   = useUIStore((s) => s.drawingModeNodeId);
  const drawingRegionColor  = useUIStore((s) => s.drawingRegionColor);
  const drawingRegionOpacity = useUIStore((s) => s.drawingRegionOpacity);
  const isDrawing           = drawingModeNodeId === id;

  const nodeColor    = d.color ?? "#6366f1";
  const fillColor    = resolveFillColor(dd);
  const borderColor  = resolveBorderColor(dd);
  const borderWidth  = resolveBorderWidth(dd);
  const borderRadius = resolveNodeBorderRadius(dd, 16);
  const bStyle       = (dd.borderStyle as string) ?? "solid";
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

  const startEditing = () => {
    if (d.locked || isDrawing) return;
    useCanvasStore.setState((s) => ({
      nodes: s.nodes.map((n) => n.id === id ? { ...n, style: { ...(n.style ?? {}), height: undefined } } : n),
    }));
    editHistoryCaptured.current = false;
    editDirty.current = false;
    setEditing(true);
  };

  const commitEdit = useCallback(() => {
    if (editDirty.current) {
      pushHistory();
      editDirty.current = false;
    }
    editHistoryCaptured.current = false;
    setEditing(false);
  }, [pushHistory]);

  useEffect(() => {
    if (!selected && editing) {
      const frame = requestAnimationFrame(commitEdit);
      return () => cancelAnimationFrame(frame);
    }
  }, [selected, editing, commitEdit]);

  return (
    <>
      <NodeResizer minWidth={120} minHeight={40} isVisible={selected && !editing && !isDrawing} />
      <div
        className={cn(
          "group relative h-full w-full px-4 py-3 shadow-md transition-shadow",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg",
          d.locked && "opacity-75"
        )}
        style={{
          backgroundColor: fillColor,
          border: `${borderWidth}px ${bStyle} ${borderColor ?? nodeColor}`,
          borderRadius,
        }}
        onDoubleClick={startEditing}
      >
        {/* Extra border layers — expand outward, not clipped */}
        <BorderLayers layers={borderLayers} primaryWidth={borderWidth} baseRadius={borderRadius} />
        <NodeQuickActions nodeId={id} color={borderColor ?? nodeColor} selected={selected} />

        <Handle type="target" position={Position.Left}
          className="!h-3 !w-3 !rounded-full !border-2 !border-background !opacity-0 group-hover:!opacity-100 transition-opacity"
          style={{ background: nodeColor }} />
        <Handle type="source" position={Position.Right}
          className="!h-3 !w-3 !rounded-full !border-2 !border-background !opacity-0 group-hover:!opacity-100 transition-opacity"
          style={{ background: nodeColor }} />

        {/* Internal fill regions (below text, clipped to node bounds) */}
        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius }}>
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

        {d.locked && <Lock className="absolute right-2 top-2 h-3 w-3 text-muted-foreground" />}

        <div className={cn("relative z-10 nodrag nopan text-sm font-medium", editing && "cursor-text")}
          style={getTextStyle(dd)}>
          <RichTextEditor
            initialContent={initialContent}
            editable={editing}
            placeholder="Double-click to edit…"
            blockAlign={dd.textAlign as "left" | "center" | "right" | "justify" | undefined}
            onChange={(html) => {
              captureTextHistory();
              const plain = html.replace(/<[^>]+>/g, "").trim();
              updateNodeData(id, { richText: html, text: plain });
            }}
            onContentSizeChange={(size) => fitNodeToContent(id, size)}
            onBlur={commitEdit}
          />
        </div>

        {d.tags && d.tags.length > 0 && (
          <div className="relative z-10 mt-1.5 flex flex-wrap gap-1">
            {d.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: `${nodeColor}25`, color: nodeColor }}>{tag}</span>
            ))}
          </div>
        )}

        {!d.locked && !isDrawing && (
          <button
            className="absolute -right-3.5 -bottom-3.5 hidden h-7 w-7 items-center justify-center rounded-full border-2 border-background shadow-md transition-transform hover:scale-110 group-hover:flex"
            style={{ backgroundColor: nodeColor }}
            onClick={(e) => { e.stopPropagation(); createChildNode(id); }}>
            <Plus className="h-3.5 w-3.5 text-white" />
          </button>
        )}

        {d.collapsed !== undefined && (
          <button
            className="absolute -left-3 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full bg-muted shadow-sm"
            onClick={() => updateNodeData(id, { collapsed: !d.collapsed })}>
            {d.collapsed ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
          </button>
        )}
      </div>
    </>
  );
}

export const MindMapNode = memo(MindMapNodeComponent);
