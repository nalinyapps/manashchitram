"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { Node } from "@xyflow/react";
import { useCanvasStore } from "@/store/canvas-store";

interface AutoFitOptions {
  nodeId: string;
  boxRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
}

function lineMetrics(element: HTMLElement): { lineCount: number; lineHeight: number } {
  const computed = window.getComputedStyle(element);
  const fontSize = Number.parseFloat(computed.fontSize) || 14;
  const lineHeight = Number.parseFloat(computed.lineHeight) || fontSize * 1.35;
  const text = element.innerText || element.textContent || "";
  const explicitLines = Math.max(1, text.replace(/\r\n/g, "\n").split("\n").length);
  const rect = element.getBoundingClientRect();
  const height = Math.max(element.scrollHeight, rect.height);
  return {
    lineHeight,
    lineCount: Math.max(explicitLines, Math.ceil(height / Math.max(1, lineHeight))),
  };
}

function numberDimension(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function fallbackSize(node: Node | undefined): { width: number; height: number } {
  if (node?.type === "text") return { width: 240, height: 56 };
  if (node?.type === "sticky") return { width: 180, height: 90 };
  if (node?.type === "shape") {
    const shapeType = ((node.data ?? {}) as Record<string, unknown>).shapeType;
    if (shapeType === "circle" || shapeType === "diamond" || shapeType === "star" || shapeType === "flower") return { width: 120, height: 120 };
    if (shapeType === "leaf") return { width: 160, height: 96 };
    if (["document", "database", "predefinedProcess", "delay", "cloud"].includes(String(shapeType))) {
      return { width: 170, height: 96 };
    }
    return { width: 140, height: 80 };
  }
  return { width: 180, height: 80 };
}

function visualSize(node: Node | undefined): { width: number; height: number } {
  const fallback = fallbackSize(node);
  const style = node?.style as Record<string, unknown> | undefined;
  return {
    width: numberDimension(style?.width, fallback.width),
    height: numberDimension(style?.height, fallback.height),
  };
}

function verticalSafety(node: Node | undefined): number {
  if (node?.type === "sticky") return 58;
  if (node?.type === "text") return 54;
  if (node?.type !== "shape") return 56;
  const shapeType = ((node.data ?? {}) as Record<string, unknown>).shapeType;
  if (shapeType === "triangle") return 92;
  if (shapeType === "diamond" || shapeType === "star" || shapeType === "flower") return 90;
  if (shapeType === "circle") return 78;
  if (shapeType === "callout" || shapeType === "offPageConnector") return 86;
  return 64;
}

function shapeHeightFactor(node: Node | undefined): number {
  if (node?.type !== "shape") return 1;
  const shapeType = ((node.data ?? {}) as Record<string, unknown>).shapeType;
  if (shapeType === "triangle") return 1.55;
  if (shapeType === "diamond" || shapeType === "star") return 1.42;
  if (shapeType === "flower") return 1.7;
  if (shapeType === "circle") return 1.35;
  if (shapeType === "hexagon" || shapeType === "arrow") return 1.2;
  if (["parallelogram", "trapezoid", "document", "database", "predefinedProcess", "delay", "cloud", "leaf"].includes(String(shapeType))) {
    return 1.24;
  }
  return 1;
}

export function useNodeContentAutoFit({ nodeId, boxRef, contentRef }: AutoFitOptions) {
  const fitNodeToContent = useCanvasStore((state) => state.fitNodeToContent);
  const resizeNodeToFitBounds = useCanvasStore((state) => state.resizeNodeToFitBounds);
  const frameRef = useRef(0);

  const measure = useCallback(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;

    const node = useCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId);
    const current = visualSize(node);
    const boxRect = box.getBoundingClientRect();
    if (boxRect.width <= 0 || boxRect.height <= 0) return;
    const scaleX = current.width / boxRect.width;
    const scaleY = current.height / boxRect.height;
    const editor = content.querySelector(".ProseMirror") as HTMLElement | null;
    const contentRect = content.getBoundingClientRect();
    const editorRect = editor?.getBoundingClientRect();
    const contentHeight = Math.ceil(Math.max(
      content.scrollHeight,
      contentRect.height,
      editor?.scrollHeight ?? 0,
      editorRect?.height ?? 0
    ));
    const widthOverflow = Math.max(
      0,
      content.scrollWidth - content.clientWidth,
      editor ? editor.scrollWidth - editor.clientWidth : 0
    );
    const contentWidth = widthOverflow > 2 ? Math.ceil(current.width + widthOverflow * scaleX) : 0;
    if (contentHeight <= 0) return;

    const { lineCount, lineHeight } = lineMetrics(content);
    fitNodeToContent(nodeId, {
      width: contentWidth,
      height: contentHeight * scaleY,
      lineCount,
      lineHeight,
    });
    resizeNodeToFitBounds(nodeId, {
      width: contentWidth || current.width,
      height: contentHeight * scaleY * shapeHeightFactor(node) + verticalSafety(node),
    });
  }, [boxRef, contentRef, fitNodeToContent, nodeId, resizeNodeToFitBounds]);

  const scheduleMeasure = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      measure();
      frameRef.current = requestAnimationFrame(measure);
    });
  }, [measure]);

  useLayoutEffect(() => {
    scheduleMeasure();
    return () => cancelAnimationFrame(frameRef.current);
  }, [scheduleMeasure]);

  useEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, [boxRef, contentRef, scheduleMeasure]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver(scheduleMeasure);
    observer.observe(content, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [contentRef, scheduleMeasure]);
}
