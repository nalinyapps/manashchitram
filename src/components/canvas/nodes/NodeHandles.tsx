"use client";

import { Fragment } from "react";
import { Handle, Position } from "@xyflow/react";
import { useUIStore } from "@/store/ui-store";

/**
 * Renders a source AND a target handle on each of the four sides, with ids
 * "top" | "right" | "bottom" | "left". Layout-aware edges reference these ids
 * (e.g. sourceHandle="right", targetHandle="left") so arrows exit/enter from
 * the correct side. Handles are invisible until the node is hovered.
 */
const SIDES: Array<{ id: "top" | "right" | "bottom" | "left"; pos: Position }> = [
  { id: "top", pos: Position.Top },
  { id: "right", pos: Position.Right },
  { id: "bottom", pos: Position.Bottom },
  { id: "left", pos: Position.Left },
];

export function NodeHandles({ color = "#6366f1" }: { color?: string }) {
  const activeTool = useUIStore((s) => s.activeTool);
  const fullSurfaceActive = activeTool === "connector";

  return (
    <>
      <Handle
        type="target"
        id="auto"
        position={Position.Top}
        className="!border-0 !bg-transparent !opacity-0"
        style={{
          width: "100%",
          height: "100%",
          left: 0,
          top: 0,
          transform: "none",
          pointerEvents: fullSurfaceActive ? "all" : "none",
        }}
      />
      <Handle
        type="source"
        id="auto"
        position={Position.Top}
        className="!border-0 !bg-transparent !opacity-0"
        style={{
          width: "100%",
          height: "100%",
          left: 0,
          top: 0,
          transform: "none",
          pointerEvents: fullSurfaceActive ? "all" : "none",
        }}
      />
      {SIDES.map(({ id, pos }) => (
        <Fragment key={id}>
          <Handle
            type="target"
            id={id}
            position={pos}
            className="!h-2 !w-2 !border !border-background !opacity-0"
            style={{ background: color }}
          />
          <Handle
            type="source"
            id={id}
            position={pos}
            className="!h-2 !w-2 !border !border-background !opacity-0"
            style={{ background: color }}
          />
        </Fragment>
      ))}
    </>
  );
}
