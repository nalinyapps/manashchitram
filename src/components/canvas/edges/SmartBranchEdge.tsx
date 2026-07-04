"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useNodes,
  Position,
  type EdgeProps,
} from "@xyflow/react";
import type { VidyaEdgeData } from "@/lib/types";
import { getNodeRect, type NodeRect } from "@/lib/layout";
import { routeOrthogonalEdge, type Side } from "@/lib/layout/edge-routing";

function toSide(p: Position): Side {
  switch (p) {
    case Position.Top: return "top";
    case Position.Right: return "right";
    case Position.Bottom: return "bottom";
    case Position.Left: return "left";
    default: return "right";
  }
}

function SmartBranchEdgeComponent({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const d = (data ?? {}) as VidyaEdgeData;
  const curveStyle = d.curveStyle ?? "smooth";
  const nodes = useNodes();

  let path: string;
  let labelX: number;
  let labelY: number;

  if (curveStyle === "smooth") {
    // Curved routing for radial / free-form - clean bezier, no obstacle solve.
    [path, labelX, labelY] = getBezierPath({
      sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    });
  } else {
    // Structured layouts -> orthogonal routing that avoids other node boxes.
    const obstacles: NodeRect[] = [];
    for (const n of nodes) {
      if (n.id === source || n.id === target) continue;
      obstacles.push(getNodeRect(n));
    }
    const routed = routeOrthogonalEdge(
      { x: sourceX, y: sourceY },
      { x: targetX, y: targetY },
      toSide(sourcePosition),
      toSide(targetPosition),
      obstacles
    );
    path = routed.path;
    labelX = routed.labelX;
    labelY = routed.labelY;
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: d.color ?? (selected ? "#6366f1" : "#94a3b8"),
          strokeWidth: d.width ?? 2,
          strokeDasharray: d.dashed ? "6 4" : undefined,
        }}
      />
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
