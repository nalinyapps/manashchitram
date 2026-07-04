"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  useEdges,
  useNodes,
  type EdgeProps,
} from "@xyflow/react";
import type { VidyaEdgeData } from "@/lib/types";
import { getNodeRect, type NodeRect } from "@/lib/layout";
import { routeRectilinearEdge, type Segment } from "@/lib/layout/edge-routing";

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
  const edges = useEdges();
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
      obstacles.push(getNodeRect(n));
    }

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const peerSegments: Segment[] = [];
    for (const edge of edges) {
      if (edge.id === id || edge.hidden) continue;
      const edgeData = (edge.data ?? {}) as VidyaEdgeData;
      if (edgeData.hiddenInMatrix) continue;
      const s = byId.get(edge.source);
      const t = byId.get(edge.target);
      if (!s || !t) continue;
      const sr = getNodeRect(s);
      const tr = getNodeRect(t);
      peerSegments.push({
        a: { x: sr.x + sr.width / 2, y: sr.y + sr.height / 2 },
        b: { x: tr.x + tr.width / 2, y: tr.y + tr.height / 2 },
      });
    }

    const routed = routeRectilinearEdge(sourceRect, targetRect, obstacles, peerSegments);
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
