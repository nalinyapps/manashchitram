"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  useNodes,
  type EdgeProps,
} from "@xyflow/react";
import { Trash2 } from "lucide-react";
import type { VidyaEdgeData } from "@/lib/types";
import { getNodeRect, type NodeRect } from "@/lib/layout";
import { routeLayoutEdge } from "@/lib/layout/edge-routing";
import { useCanvasStore } from "@/store/canvas-store";

const ROUTING_CORRIDOR_PAD = 360;
const MAX_ROUTING_OBSTACLES = 80;

function nearRouteCorridor(rect: NodeRect, source: NodeRect, target: NodeRect): boolean {
  const minX = Math.min(source.x, target.x) - ROUTING_CORRIDOR_PAD;
  const minY = Math.min(source.y, target.y) - ROUTING_CORRIDOR_PAD;
  const maxX = Math.max(source.x + source.width, target.x + target.width) + ROUTING_CORRIDOR_PAD;
  const maxY = Math.max(source.y + source.height, target.y + target.height) + ROUTING_CORRIDOR_PAD;
  return rect.x < maxX && rect.x + rect.width > minX && rect.y < maxY && rect.y + rect.height > minY;
}

function SmartBranchEdgeComponent({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const d = (data ?? {}) as VidyaEdgeData;
  const nodes = useNodes();
  const deleteEdges = useCanvasStore((s) => s.deleteEdges);
  if (d.hiddenInMatrix) return null;

  let path: string;
  let labelX: number;
  let labelY: number;

  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);

  if (sourceNode && targetNode) {
    const sourceRect = getNodeRect(sourceNode);
    const targetRect = getNodeRect(targetNode);
    const obstacles: NodeRect[] = [];
    for (const n of nodes) {
      if (n.id === source || n.id === target) continue;
      if (n.hidden || n.type === "frame") continue;
      const rect = getNodeRect(n);
      if (!nearRouteCorridor(rect, sourceRect, targetRect)) continue;
      obstacles.push(rect);
      if (obstacles.length >= MAX_ROUTING_OBSTACLES) break;
    }

    const routed = routeLayoutEdge(sourceRect, targetRect, d.layoutMode, obstacles);
    if (!routed.path) return null;
    path = routed.path;
    labelX = routed.labelX;
    labelY = routed.labelY;
  } else {
    path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = (sourceY + targetY) / 2;
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={28}
        style={{
          stroke: d.color ?? (selected ? "#6366f1" : "#94a3b8"),
          strokeWidth: d.width ?? 2,
          strokeDasharray: d.dashed ? "6 4" : undefined,
        }}
      />
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            title="Delete connection"
            aria-label="Delete connection"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              deleteEdges([id]);
            }}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY - (d.label ? 24 : 0)}px)`,
              pointerEvents: "all",
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full border bg-background text-destructive shadow-md"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </EdgeLabelRenderer>
      )}
      {d.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="rounded-md border bg-background px-1.5 py-0.5 text-[10px] font-medium shadow-sm"
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const SmartBranchEdge = memo(SmartBranchEdgeComponent);
