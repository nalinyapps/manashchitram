import type { NodeRect } from "./index";

export type Side = "top" | "right" | "bottom" | "left";
type Pt = { x: number; y: number };
export type Segment = { a: Pt; b: Pt };

export const EDGE_OBSTACLE_PADDING = 24;

// -- Geometry helpers ---------------------------------------------------------

function inflate(r: NodeRect, pad: number): NodeRect {
  return { id: r.id, x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
}

/** Does segment (p1->p2) intersect an axis-aligned rect? (segments are orthogonal) */
function segIntersectsRect(p1: Pt, p2: Pt, r: NodeRect): boolean {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  // Bounding-box overlap test is sufficient for axis-aligned segments.
  return maxX > r.x && minX < r.x + r.width && maxY > r.y && minY < r.y + r.height;
}

function pathIntersections(points: Pt[], obstacles: NodeRect[]): number {
  let count = 0;
  for (let i = 0; i < points.length - 1; i++) {
    for (const o of obstacles) {
      if (segIntersectsRect(points[i], points[i + 1], o)) count++;
    }
  }
  return count;
}

function orientation(a: Pt, b: Pt, c: Pt): number {
  return Math.sign((b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y));
}

function segmentsCross(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const aMinX = Math.min(a1.x, a2.x);
  const aMaxX = Math.max(a1.x, a2.x);
  const aMinY = Math.min(a1.y, a2.y);
  const aMaxY = Math.max(a1.y, a2.y);
  const bMinX = Math.min(b1.x, b2.x);
  const bMaxX = Math.max(b1.x, b2.x);
  const bMinY = Math.min(b1.y, b2.y);
  const bMaxY = Math.max(b1.y, b2.y);
  if (aMaxX < bMinX || bMaxX < aMinX || aMaxY < bMinY || bMaxY < aMinY) return false;

  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  if (o1 === 0 && o2 === 0 && o3 === 0 && o4 === 0) return true;
  return o1 !== o2 && o3 !== o4;
}

function edgeCrossings(points: Pt[], peerSegments: Segment[]): number {
  let count = 0;
  for (let i = 0; i < points.length - 1; i++) {
    for (const segment of peerSegments) {
      if (segmentsCross(points[i], points[i + 1], segment.a, segment.b)) count++;
    }
  }
  return count;
}

function pathLength(points: Pt[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
  }
  return len;
}

/** A small stub segment off the connection point so the line leaves the node cleanly. */
function stub(p: Pt, side: Side, d = 20): Pt {
  switch (side) {
    case "top": return { x: p.x, y: p.y - d };
    case "bottom": return { x: p.x, y: p.y + d };
    case "left": return { x: p.x - d, y: p.y };
    case "right": return { x: p.x + d, y: p.y };
  }
}

// -- Candidate orthogonal paths -----------------------------------------------

function buildCandidates(s: Pt, t: Pt, ss: Side, ts: Side, obstacles: NodeRect[]): Pt[][] {
  const s1 = stub(s, ss);
  const t1 = stub(t, ts);
  const candidates: Pt[][] = [];

  // HV and VH elbows between the stubs
  candidates.push([s, s1, { x: t1.x, y: s1.y }, t1, t]);
  candidates.push([s, s1, { x: s1.x, y: t1.y }, t1, t]);

  // Mid doglegs (route around obstacles between the two nodes)
  const midX = (s1.x + t1.x) / 2;
  const midY = (s1.y + t1.y) / 2;
  candidates.push([s, s1, { x: midX, y: s1.y }, { x: midX, y: t1.y }, t1, t]);
  candidates.push([s, s1, { x: s1.x, y: midY }, { x: t1.x, y: midY }, t1, t]);

  // Wider doglegs above/below/left/right, to escape a blocking box
  const escapes = [80, 180];
  for (const e of escapes) {
    candidates.push([s, s1, { x: s1.x, y: Math.min(s1.y, t1.y) - e }, { x: t1.x, y: Math.min(s1.y, t1.y) - e }, t1, t]);
    candidates.push([s, s1, { x: s1.x, y: Math.max(s1.y, t1.y) + e }, { x: t1.x, y: Math.max(s1.y, t1.y) + e }, t1, t]);
    candidates.push([s, s1, { x: Math.min(s1.x, t1.x) - e, y: s1.y }, { x: Math.min(s1.x, t1.x) - e, y: t1.y }, t1, t]);
    candidates.push([s, s1, { x: Math.max(s1.x, t1.x) + e, y: s1.y }, { x: Math.max(s1.x, t1.x) + e, y: t1.y }, t1, t]);
  }

  // Obstacle-derived detours. These let the route clear large or manually moved
  // boxes without guessing a fixed offset that might still run through them.
  const corridor = {
    x: Math.min(s1.x, t1.x),
    y: Math.min(s1.y, t1.y),
    width: Math.abs(t1.x - s1.x),
    height: Math.abs(t1.y - s1.y),
  };
  const near = obstacles.filter((o) => {
    const ox2 = o.x + o.width;
    const oy2 = o.y + o.height;
    return ox2 >= corridor.x - 80 &&
      o.x <= corridor.x + corridor.width + 80 &&
      oy2 >= corridor.y - 80 &&
      o.y <= corridor.y + corridor.height + 80;
  });

  const yEscapes = new Set<number>();
  const xEscapes = new Set<number>();
  for (const o of near) {
    yEscapes.add(o.y - EDGE_OBSTACLE_PADDING);
    yEscapes.add(o.y + o.height + EDGE_OBSTACLE_PADDING);
    xEscapes.add(o.x - EDGE_OBSTACLE_PADDING);
    xEscapes.add(o.x + o.width + EDGE_OBSTACLE_PADDING);
  }
  for (const y of yEscapes) {
    candidates.push([s, s1, { x: s1.x, y }, { x: t1.x, y }, t1, t]);
  }
  for (const x of xEscapes) {
    candidates.push([s, s1, { x, y: s1.y }, { x, y: t1.y }, t1, t]);
  }
  return candidates;
}

function toRoundedPath(points: Pt[], radius = 8): string {
  if (points.length < 2) return "";
  // Dedupe consecutive identical points
  const pts = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const v1x = Math.sign(cur.x - prev.x);
    const v1y = Math.sign(cur.y - prev.y);
    const v2x = Math.sign(next.x - cur.x);
    const v2y = Math.sign(next.y - cur.y);
    const r1 = Math.min(radius, Math.abs(cur.x - prev.x) / 2, Math.abs(cur.y - prev.y) / 2 || radius);
    const rr = Math.max(0, Math.min(radius, r1 || radius));
    const p1 = { x: cur.x - v1x * rr, y: cur.y - v1y * rr };
    const p2 = { x: cur.x + v2x * rr, y: cur.y + v2y * rr };
    d += ` L ${p1.x} ${p1.y} Q ${cur.x} ${cur.y} ${p2.x} ${p2.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

export interface RouteResult { path: string; labelX: number; labelY: number }

/**
 * Route an orthogonal edge from source to target, avoiding obstacle rects.
 * Picks the candidate path with the fewest obstacle intersections, then the
 * shortest / fewest-bend option among ties.
 */
export function routeOrthogonalEdge(
  source: Pt,
  target: Pt,
  sourceSide: Side,
  targetSide: Side,
  obstacles: NodeRect[],
  peerSegments: Segment[] = []
): RouteResult {
  const inflated = obstacles.map((o) => inflate(o, EDGE_OBSTACLE_PADDING));
  const candidates = buildCandidates(source, target, sourceSide, targetSide, inflated);

  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const score =
      pathIntersections(c, inflated) * 100000 +
      edgeCrossings(c, peerSegments) * 2500 +
      pathLength(c) +
      (c.length - 2) * 40; // bend penalty
    if (score < bestScore) { bestScore = score; best = c; }
  }

  const mid = best[Math.floor(best.length / 2)];
  return { path: toRoundedPath(best), labelX: mid.x, labelY: mid.y };
}

function sidePoint(rect: NodeRect, side: Side, fraction: number): Pt {
  switch (side) {
    case "top": return { x: rect.x + rect.width * fraction, y: rect.y };
    case "bottom": return { x: rect.x + rect.width * fraction, y: rect.y + rect.height };
    case "left": return { x: rect.x, y: rect.y + rect.height * fraction };
    case "right": return { x: rect.x + rect.width, y: rect.y + rect.height * fraction };
  }
}

function preferredSides(source: NodeRect, target: NodeRect): Array<{ sourceSide: Side; targetSide: Side }> {
  const sc = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const tc = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const horizontal = Math.abs(tc.x - sc.x) >= Math.abs(tc.y - sc.y);
  const primary = horizontal
    ? { sourceSide: tc.x >= sc.x ? "right" as Side : "left" as Side, targetSide: tc.x >= sc.x ? "left" as Side : "right" as Side }
    : { sourceSide: tc.y >= sc.y ? "bottom" as Side : "top" as Side, targetSide: tc.y >= sc.y ? "top" as Side : "bottom" as Side };
  const candidates: Array<{ sourceSide: Side; targetSide: Side }> = [
    primary,
    { sourceSide: "right", targetSide: "left" },
    { sourceSide: "left", targetSide: "right" },
    { sourceSide: "bottom", targetSide: "top" },
    { sourceSide: "top", targetSide: "bottom" },
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.sourceSide}:${candidate.targetSide}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}

export function routeRectilinearEdge(
  sourceRect: NodeRect,
  targetRect: NodeRect,
  obstacles: NodeRect[],
  peerSegments: Segment[] = []
): RouteResult {
  const inflated = obstacles.map((o) => inflate(o, EDGE_OBSTACLE_PADDING));
  const fractions = [0.25, 0.5, 0.75];
  let best: Pt[] | null = null;
  let bestScore = Infinity;

  for (const sides of preferredSides(sourceRect, targetRect)) {
    for (const sf of fractions) {
      for (const tf of fractions) {
        const source = sidePoint(sourceRect, sides.sourceSide, sf);
        const target = sidePoint(targetRect, sides.targetSide, tf);
        for (const candidate of buildCandidates(source, target, sides.sourceSide, sides.targetSide, inflated)) {
          const score =
            pathIntersections(candidate, inflated) * 100000 +
            edgeCrossings(candidate, peerSegments) * 2500 +
            pathLength(candidate) +
            Math.abs(sf - 0.5) * 80 +
            Math.abs(tf - 0.5) * 80 +
            (candidate.length - 2) * 40;
          if (score < bestScore) {
            bestScore = score;
            best = candidate;
          }
        }
      }
    }
  }

  const points = best ?? [sidePoint(sourceRect, "right", 0.5), sidePoint(targetRect, "left", 0.5)];
  const mid = points[Math.floor(points.length / 2)];
  return { path: toRoundedPath(points), labelX: mid.x, labelY: mid.y };
}
