"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  useViewport,
  ReactFlowProvider,
  type Connection,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
  ConnectionMode,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { nodeTypes } from "./nodes";
import { edgeTypes } from "./edges/VidyaEdge";
import { useCanvasStore } from "@/store/canvas-store";
import { useUIStore } from "@/store/ui-store";
import { generateId } from "@/lib/utils";
import { updateBoard } from "@/lib/storage/board-store";
import { AUTOSAVE_DELAY_MS } from "@/lib/config";
import type { BoardContent } from "@/lib/types";
import { debounce } from "@/lib/utils";
import { resolveInsertedNodeCollisions, routeForMode, type LayoutMode } from "@/lib/layout";

// ── Alignment guide types ──────────────────────────────────────────────────
interface Guides { h: number[]; v: number[] }

const GUIDE_THRESHOLD = 6; // px in flow coords

function calcGuides(
  dragged: { x: number; y: number; w: number; h: number },
  others:  Array<{ x: number; y: number; w: number; h: number }>
): Guides {
  const h: number[] = [];
  const v: number[] = [];
  const { x: dx, y: dy, w: dw, h: dh } = dragged;
  const dL = dx, dR = dx + dw, dCX = dx + dw / 2;
  const dT = dy, dB = dy + dh, dCY = dy + dh / 2;

  for (const o of others) {
    const oL = o.x, oR = o.x + o.w, oCX = o.x + o.w / 2;
    const oT = o.y, oB = o.y + o.h, oCY = o.y + o.h / 2;
    const snap = GUIDE_THRESHOLD;

    if (Math.abs(dL  - oL)  < snap) v.push(oL);
    if (Math.abs(dR  - oR)  < snap) v.push(oR);
    if (Math.abs(dCX - oCX) < snap) v.push(oCX);
    if (Math.abs(dR  - oL)  < snap) v.push(oL);
    if (Math.abs(dL  - oR)  < snap) v.push(oR);

    if (Math.abs(dT  - oT)  < snap) h.push(oT);
    if (Math.abs(dB  - oB)  < snap) h.push(oB);
    if (Math.abs(dCY - oCY) < snap) h.push(oCY);
    if (Math.abs(dB  - oT)  < snap) h.push(oT);
    if (Math.abs(dT  - oB)  < snap) h.push(oB);
  }
  return { h, v };
}

/** Renders guide lines in SCREEN coordinates using the live ReactFlow viewport */
function AlignmentGuides({ guides }: { guides: Guides }) {
  const vp = useViewport();
  if (!guides.h.length && !guides.v.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 9998 }}>
      {guides.h.map((fy, i) => (
        <div key={`h${i}`} className="absolute left-0 right-0"
          style={{ top: fy * vp.zoom + vp.y, height: 1, background: "#ef4444", opacity: 0.85 }} />
      ))}
      {guides.v.map((fx, i) => (
        <div key={`v${i}`} className="absolute top-0 bottom-0"
          style={{ left: fx * vp.zoom + vp.x, width: 1, background: "#ef4444", opacity: 0.85 }} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function VidyaCanvasInner({ boardId }: { boardId: string }) {
  // Targeted selectors — each only re-renders when its slice changes
  const nodes       = useCanvasStore((s) => s.nodes);
  const edges       = useCanvasStore((s) => s.edges);
  const settings    = useCanvasStore((s) => s.settings);
  const saveStatus  = useCanvasStore((s) => s.saveStatus);
  const setNodes    = useCanvasStore((s) => s.setNodes);
  const setEdges    = useCanvasStore((s) => s.setEdges);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const setSelectedNodeIds = useCanvasStore((s) => s.setSelectedNodeIds);
  const activeTool  = useUIStore((s) => s.activeTool);

  const { screenToFlowPosition, fitView, zoomIn, zoomOut } = useReactFlow();
  const [spacePressed, setSpacePressed] = useState(false);
  const [guides, setGuides] = useState<Guides>({ h: [], v: [] });

  // Debounced autosave — reads state directly, no subscriptions
  const debouncedSave = useMemo(
    () => debounce(async () => {
      const s = useCanvasStore.getState();
      if (!s.board || s.saveStatus === "saved") return;
      s.setSaveStatus("saving");
      try {
        await updateBoard(boardId, {
          title: s.board.title,
          content: {
            version: s.board.content.version,
            nodes: s.nodes,
            edges: s.edges,
            viewport: s.viewport,
            settings: s.settings,
          } as BoardContent,
        });
        useCanvasStore.getState().setSaveStatus("saved");
      } catch {
        useCanvasStore.getState().setSaveStatus("error");
      }
    }, AUTOSAVE_DELAY_MS),
    [boardId]
  );

  useEffect(() => {
    if (saveStatus === "unsaved") debouncedSave();
  }, [saveStatus, debouncedSave]);

  // Fit the view after an auto-layout is applied (dispatched from LayoutPanel).
  useEffect(() => {
    const handler = () => fitView({ padding: 0.2, duration: 400 });
    window.addEventListener("vidya:fitview", handler);
    return () => window.removeEventListener("vidya:fitview", handler);
  }, [fitView]);

  // ── onNodesChange ──────────────────────────────────────────────────
  // KEY DESIGN:
  // - "dimensions" and "select" changes come from React Flow internally on
  //   every render/layout pass. They must NOT set saveStatus:"unsaved" or
  //   they trigger an endless re-render cascade that crashes Chrome.
  // - "position" (dragging) also fires many times per second — same rule.
  // - Only "add" / "remove" are real user edits that mark the board dirty.
  // - Drag-end history is pushed by onNodeDragStop (fires once on mouse-up).
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const isStructural = changes.some((c) => c.type === "remove" || c.type === "add");

      if (isStructural) {
        useCanvasStore.getState().pushHistory();
        // Structural changes mark the board dirty via setNodes
        setNodes((nds) => applyNodeChanges(changes, nds));
      } else {
        // Dimension / position / select — update nodes WITHOUT touching saveStatus
        useCanvasStore.setState((state) => ({
          nodes: applyNodeChanges(changes, state.nodes),
        }));
      }

      // Keep selectedNodeIds in sync (only when selection actually changed)
      if (changes.some((c) => c.type === "select")) {
        const nodes = useCanvasStore.getState().nodes;
        setSelectedNodeIds(nodes.filter((n) => n.selected).map((n) => n.id));
      }
    },
    [setNodes, setSelectedNodeIds]
  );

  // Alignment guides — live during drag
  const onNodeDrag = useCallback((_: MouseEvent | TouchEvent, draggedNode: Node) => {
    const allNodes = useCanvasStore.getState().nodes;
    const dw = (draggedNode.measured?.width  ?? 150) as number;
    const dh = (draggedNode.measured?.height ?? 60)  as number;
    const dragged = { x: draggedNode.position.x, y: draggedNode.position.y, w: dw, h: dh };
    const others  = allNodes
      .filter((n) => n.id !== draggedNode.id)
      .map((n) => ({
        x: n.position.x,
        y: n.position.y,
        w: (n.measured?.width  ?? 150) as number,
        h: (n.measured?.height ?? 60)  as number,
      }));
    setGuides(calcGuides(dragged, others));
  }, []);

  // Push history when a drag ends (safe: fires once, not on every frame)
  const onNodeDragStop = useCallback(() => {
    setGuides({ h: [], v: [] });
    useCanvasStore.getState().pushHistory();
    useCanvasStore.getState().setSaveStatus("unsaved");
  }, []);

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      if (changes.some((c) => c.type === "remove" || c.type === "add")) {
        useCanvasStore.getState().pushHistory();
      }
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [setEdges]
  );

  const onConnect = useCallback(
    (connection: {
      source: string; target: string;
      sourceHandle?: string | null; targetHandle?: string | null;
    }) => {
      const cs = useCanvasStore.getState();
      cs.pushHistory();
      const source = cs.nodes.find((n) => n.id === connection.source);
      const targetNode = cs.nodes.find((n) => n.id === connection.target);
      const mode = ((source?.data as { layoutMode?: LayoutMode } | undefined)?.layoutMode ?? "freeForm") as LayoutMode;
      const route = source && targetNode ? routeForMode(mode, source, targetNode) : null;
      const hiddenInMatrix = mode === "matrix";
      const newEdge: Edge = {
        id: generateId(),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? route?.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? route?.targetHandle ?? undefined,
        type: "branch",
        hidden: hiddenInMatrix,
        reconnectable: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" },
        data: { edgeType: "branch", curveStyle: route?.curveStyle ?? "smooth", hiddenInMatrix },
      };
      // Record parent→child relationship if the target has no parent yet.
      const hasParent = targetNode && (targetNode.data as { parentId?: string | null }).parentId;
      if (targetNode && !hasParent) {
        cs.updateNodeData(connection.target, { parentId: connection.source });
      }
      setEdges((eds) => [...eds, newEdge]);
    },
    [setEdges]
  );

  const onReconnect = useCallback((oldEdge: Edge, connection: Connection) => {
    const cs = useCanvasStore.getState();
    const source = cs.nodes.find((n) => n.id === connection.source);
    const target = cs.nodes.find((n) => n.id === connection.target);
    if (!source || !target || source.id === target.id) return;

    cs.pushHistory();
    const mode = ((source.data as { layoutMode?: LayoutMode } | undefined)?.layoutMode ?? "freeForm") as LayoutMode;
    const route = routeForMode(mode, source, target);
    const hiddenInMatrix = mode === "matrix";

    const nextEdges = cs.edges.map((edge) => {
      if (edge.id !== oldEdge.id) return edge;
      return {
        ...edge,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? route.sourceHandle,
        targetHandle: connection.targetHandle ?? route.targetHandle,
        hidden: hiddenInMatrix,
        reconnectable: true,
        markerEnd: edge.markerEnd ?? { type: MarkerType.ArrowClosed, color: "#6366f1" },
        data: { ...(edge.data ?? {}), edgeType: "branch", curveStyle: route.curveStyle, hiddenInMatrix },
      };
    });

    const nextNodes = cs.nodes.map((node) => {
      const data = node.data as Record<string, unknown>;
      if (node.id === oldEdge.target && oldEdge.target !== connection.target) {
        return { ...node, data: { ...data, parentId: null } };
      }
      if (node.id === oldEdge.source || node.id === connection.source) {
        const withoutOldTarget = ((data.childOrder as string[] | undefined) ?? []).filter((id) => id !== oldEdge.target);
        if (node.id !== connection.source) return { ...node, data: { ...data, childOrder: withoutOldTarget } };
        return {
          ...node,
          data: {
            ...data,
            childOrder: withoutOldTarget.includes(connection.target) ? withoutOldTarget : [...withoutOldTarget, connection.target],
          },
        };
      }
      if (node.id === connection.target) {
        return { ...node, data: { ...data, parentId: connection.source } };
      }
      return node;
    });

    useCanvasStore.setState({ nodes: nextNodes, edges: nextEdges, saveStatus: "unsaved" });
  }, []);

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      const tool = useUIStore.getState().activeTool;
      if (tool === "select" || tool === "pan") return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      useCanvasStore.getState().pushHistory();

      let newNode: Node | null = null;
      const id = generateId();

      switch (tool) {
        case "mindmap":
          newNode = { id, type: "shape", position,
            data: { shapeType: "rounded", text: "New Idea", scriptMode: "plain", color: "#818cf8", tags: [] },
            style: { width: 180 } };
          break;
        case "sticky":
          newNode = { id, type: "sticky", position,
            data: { text: "", color: "yellow", tags: [] },
            style: { width: 180 } };
          break;
        case "text":
          newNode = { id, type: "text", position,
            data: { text: "", scriptMode: "plain", tags: [] },
            style: { width: 240 } };
          break;
        case "shape": {
          const sv = useUIStore.getState().shapeVariant ?? "rounded";
          newNode = { id, type: "shape", position,
            data: { shapeType: sv, text: "", color: "#4262ff", tags: [] },
            style: { width: sv === "circle" ? 100 : 140, height: sv === "circle" ? 100 : 80 } };
          break;
        }
        case "frame":
          newNode = { id, type: "frame", position,
            data: { title: "Frame", color: "#6366f1", background: "#6366f108", tags: [] },
            style: { width: 400, height: 300 }, zIndex: -1 };
          break;
        case "sanskrit":
          newNode = { id, type: "sanskrit", position,
            data: { title: "Sanskrit Card", devanagari: "", iast: "", displayMode: "both-stacked", tags: [] } };
          break;
        case "shloka":
          newNode = { id, type: "shloka", position,
            data: { title: "Śloka", devanagari: "", iast: "", memorizationStatus: "new", tags: [] } };
          break;
        case "grammar":
          newNode = { id, type: "grammar", position,
            data: { topic: "Grammar Rule", category: "sandhi", rule: "", examples: [], tags: ["सन्धिः"] } };
          break;
      }

      if (newNode) {
        setNodes((nds) => {
          const next = [...nds, newNode!];
          const placements = resolveInsertedNodeCollisions(next, newNode!.id);
          return next.map((n) => placements[n.id] ? { ...n, position: placements[n.id] } : n);
        });
        useUIStore.getState().setActiveTool("select");
      }
    },
    [screenToFlowPosition, setNodes]  // stable deps
  );

  // ── Keyboard shortcuts ─────────────────────────────────────────────
  // CRITICAL FIX: use getState() instead of subscribing to `store`
  // so this effect only runs once (fitView/zoom are stable from useReactFlow)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (e.code === "Space") { setSpacePressed(true); e.preventDefault(); return; }

      const mod = e.metaKey || e.ctrlKey;
      const cs  = useCanvasStore.getState();
      const ui  = useUIStore.getState();

      if (mod && e.shiftKey && e.key === "z") { e.preventDefault(); cs.redo(); }
      else if (mod && e.key === "z")           { e.preventDefault(); cs.undo(); }
      else if (mod && e.key === "s")           { e.preventDefault(); debouncedSave(); cs.setSaveStatus("unsaved"); }
      else if (mod && e.key === "c")           { cs.copySelected(); }
      else if (mod && e.key === "v")           { e.preventDefault(); cs.paste(); }
      else if (mod && e.key === "d")           { e.preventDefault(); cs.duplicateSelected(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && !mod) { cs.deleteSelected(); }
      else if (e.key === "Tab")                { e.preventDefault(); if (cs.selectedNodeIds[0]) cs.createChildNode(cs.selectedNodeIds[0]); }
      else if (e.key === "Enter" && !e.shiftKey) {
        if (cs.selectedNodeIds[0]) { e.preventDefault(); cs.createSiblingNode(cs.selectedNodeIds[0]); }
      }
      else if (e.key === "f" || e.key === "F") { fitView({ padding: 0.2 }); }
      else if (e.key === "+" || e.key === "=") { zoomIn(); }
      else if (e.key === "-")                  { zoomOut(); }
      else if (!mod && !e.shiftKey && e.key.length === 1) {
        const shortcuts: Record<string, string> = { v:"select", h:"pan", m:"mindmap", s:"sticky", t:"text", c:"connector", r:"shape" };
        const t = shortcuts[e.key.toLowerCase()];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (t) ui.setActiveTool(t as any);
      }

      if (mod && e.key === "k") { e.preventDefault(); ui.setCommandPaletteOpen(true); }
      if (mod && e.key === "f" && !e.shiftKey) { e.preventDefault(); ui.setSearchPanelOpen(true); }
    };

    const handleKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") setSpacePressed(false); };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [fitView, zoomIn, zoomOut, debouncedSave]);  // No `store` dep — stable!

  const bgVariant =
    settings.background === "grid"  ? BackgroundVariant.Lines :
    settings.background === "dots"  ? BackgroundVariant.Dots  : undefined;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onReconnect={onReconnect}
      onPaneClick={onPaneClick}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      connectionMode={ConnectionMode.Loose}
      edgesReconnectable
      reconnectRadius={14}
      minZoom={0.05}
      maxZoom={4}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 2 }}
      snapToGrid={settings.snapToGrid}
      snapGrid={[settings.gridSize ?? 20, settings.gridSize ?? 20]}
      panOnDrag={activeTool === "pan" || spacePressed ? [0, 1, 2] : [1, 2]}
      selectionOnDrag={activeTool === "select"}
      panOnScroll
      zoomOnScroll
      deleteKeyCode={null}
      defaultEdgeOptions={{
        type: "branch",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6366f1" },
      }}
      onMoveEnd={(_, viewport) => setViewport(viewport)}
      className="vidya-canvas-bg"
    >
      {bgVariant !== undefined && (
        <Background variant={bgVariant} gap={settings.gridSize ?? 24}
          size={bgVariant === BackgroundVariant.Dots ? 1.5 : 1} color="var(--canvas-dot)" />
      )}
      <AlignmentGuides guides={guides} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap nodeColor={(n) => (n.data as { color?: string })?.color ?? "#6366f1"}
        maskColor="rgba(0,0,0,0.06)" position="bottom-right" pannable zoomable />
    </ReactFlow>
  );
}

export function VidyaCanvas({ boardId }: { boardId: string }) {
  return (
    <ReactFlowProvider>
      <div className="h-full w-full">
        <VidyaCanvasInner boardId={boardId} />
      </div>
    </ReactFlowProvider>
  );
}
