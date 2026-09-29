/**
 * geometry.ts — pure geometry helpers shared by the canvas interactions.
 *
 * Everything here works in the board's *world* coordinate space (the infinite
 * plane), never in screen pixels. The viewport transform (see Canvas.tsx) is
 * the only thing that maps between the two.
 *
 * These functions back three features that need a shape's actual outline
 * rather than just its Konva node:
 *   - the eraser (what did the brush touch?)
 *   - the paint bucket (which shape is under the click?)
 *   - zoom-to-fit (what rectangle contains the whole board?)
 */

import type { Shape, ShapeType } from '@shared/protocol';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Shape types whose geometry lives in `points` rather than width/height. */
const POINT_SHAPES = new Set<ShapeType>([
  'line',
  'arrow',
  'curve',
  'pen',
  'highlight',
]);

export function isPointShape(type: ShapeType): boolean {
  return POINT_SHAPES.has(type);
}

/** Shapes whose text the user can edit in place. */
export function isTextShape(type: ShapeType): boolean {
  return type === 'text' || type === 'note';
}

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

/**
 * Convert the quadratic control triple we store ([p0, c, p1]) into the cubic
 * quadruple Konva's bezier Line wants. The two describe the exact same curve —
 * a quadratic is a cubic whose control points sit two-thirds of the way from
 * each endpoint toward the shared quadratic control point.
 */
export function quadraticToCubic(pts: number[]): number[] {
  const [x0, y0, cx, cy, x1, y1] = pts;
  return [
    x0,
    y0,
    x0 + (2 / 3) * (cx - x0),
    y0 + (2 / 3) * (cy - y0),
    x1 + (2 / 3) * (cx - x1),
    y1 + (2 / 3) * (cy - y1),
    x1,
    y1,
  ];
}

/** Sample a quadratic curve into a polyline, for bounds and hit-testing. */
export function sampleCurve(pts: number[], steps = 16): number[] {
  const [x0, y0, cx, cy, x1, y1] = pts;
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push(
      u * u * x0 + 2 * u * t * cx + t * t * x1,
      u * u * y0 + 2 * u * t * cy + t * t * y1,
    );
  }
  return out;
}

/** The polyline that approximates a point-shape's outline in local space. */
export function outlinePoints(shape: Shape): number[] {
  const pts = shape.points ?? [];
  return shape.type === 'curve' && pts.length >= 6 ? sampleCurve(pts) : pts;
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Bounding box in the shape's own local space (before its x/y translation). */
export function localBounds(shape: Shape): Box {
  if (isPointShape(shape.type)) {
    const pts = outlinePoints(shape);
    if (pts.length < 2) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      minX = Math.min(minX, pts[i]);
      maxX = Math.max(maxX, pts[i]);
      minY = Math.min(minY, pts[i + 1]);
      maxY = Math.max(maxY, pts[i + 1]);
    }
    // Widen by the stroke so a fat highlighter stroke is not clipped by "fit".
    const pad = (shape.style.strokeWidth ?? 1) / 2;
    return {
      x: minX - pad,
      y: minY - pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
    };
  }

  if (shape.type === 'text') {
    // Text has no authored height until it is resized; approximate from the
    // font size and the longest line so "fit" and the eraser have something.
    const fontSize = shape.style.fontSize ?? 18;
    const lines = (shape.text ?? '').split('\n');
    const longest = lines.reduce((n, l) => Math.max(n, l.length), 1);
    return {
      x: 0,
      y: 0,
      width: shape.width ?? longest * fontSize * 0.58,
      height: shape.height ?? lines.length * fontSize * 1.3,
    };
  }

  return { x: 0, y: 0, width: shape.width ?? 0, height: shape.height ?? 0 };
}

/** Axis-aligned bounding box in world space (rotation included). */
export function worldBounds(shape: Shape): Box {
  const b = localBounds(shape);
  const rot = shape.rotation ?? 0;
  if (!rot) return { ...b, x: b.x + shape.x, y: b.y + shape.y };

  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x + b.width, b.y + b.height],
    [b.x, b.y + b.height],
  ].map(([x, y]) => [shape.x + x * cos - y * sin, shape.y + x * sin + y * cos]);

  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

/** Union of every shape's world box, or null when the board is empty. */
export function contentBounds(shapes: Shape[]): Box | null {
  if (shapes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    const b = worldBounds(s);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

/** Shortest distance from a point to a segment. 0 when the point is on it. */
function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  // Degenerate segment => plain point distance.
  const t =
    lenSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Map a world point into the shape's local (un-rotated, un-translated) space. */
function toLocal(shape: Shape, wx: number, wy: number): [number, number] {
  const dx = wx - shape.x;
  const dy = wy - shape.y;
  const rot = shape.rotation ?? 0;
  if (!rot) return [dx, dy];
  const rad = (-rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

function hasFill(shape: Shape): boolean {
  const f = shape.style.fill;
  return !!f && f !== 'transparent' && f !== 'none';
}

/**
 * Distance in world units from a point to the shape — 0 when the point is
 * "on" it. Filled shapes count their interior as 0; outlined ones only count
 * the stroke, so an eraser passes *through* an empty rectangle rather than
 * wiping it out from the middle.
 *
 * @param solid treat a closed shape's interior as a hit even when it has no
 *   fill yet. The paint bucket needs this — you fill an outline by clicking
 *   inside it, which is exactly the case the default rejects.
 */
export function distanceToShape(
  shape: Shape,
  wx: number,
  wy: number,
  solid = false,
): number {
  const [lx, ly] = toLocal(shape, wx, wy);

  if (isPointShape(shape.type)) {
    const pts = outlinePoints(shape);
    if (pts.length < 4) {
      return pts.length === 2 ? Math.hypot(lx - pts[0], ly - pts[1]) : Infinity;
    }
    let best = Infinity;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      best = Math.min(
        best,
        distToSegment(lx, ly, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]),
      );
    }
    // A wide stroke should be touchable across its whole width.
    return Math.max(0, best - (shape.style.strokeWidth ?? 1) / 2);
  }

  const b = localBounds(shape);

  if (shape.type === 'ellipse') {
    const rx = b.width / 2;
    const ry = b.height / 2;
    if (rx <= 0 || ry <= 0) return Infinity;
    // Normalise into unit-circle space, then scale the residual back out. An
    // approximation of true ellipse distance, which is plenty for a brush.
    const nx = (lx - rx) / rx;
    const ny = (ly - ry) / ry;
    const r = Math.hypot(nx, ny);
    if (r <= 1) return solid || hasFill(shape) ? 0 : (1 - r) * Math.min(rx, ry);
    return (r - 1) * Math.min(rx, ry);
  }

  // rect / text / note — rectangle distance.
  const dx = Math.max(b.x - lx, 0, lx - (b.x + b.width));
  const dy = Math.max(b.y - ly, 0, ly - (b.y + b.height));
  const outside = Math.hypot(dx, dy);
  if (outside > 0) return outside;
  // Inside: filled shapes (and anything carrying text) are solid; hollow
  // outlines are only "hit" near their edge.
  if (solid || hasFill(shape) || isTextShape(shape.type)) return 0;
  return Math.min(lx - b.x, b.x + b.width - lx, ly - b.y, b.y + b.height - ly);
}

/**
 * Topmost shape within `tolerance` world units of the point, or null.
 * `shapes` is expected in draw order (lowest first), so we walk it backwards.
 */
export function shapeAt(
  shapes: Shape[],
  wx: number,
  wy: number,
  tolerance = 0,
  solid = false,
): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (distanceToShape(shapes[i], wx, wy, solid) <= tolerance) return shapes[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Re-origin a point shape so its `points` are relative to its own top-left and
 * x/y carry the position. Drafts are drawn in raw world coordinates; this runs
 * on commit so dragging, rotating and scaling all pivot around the shape
 * itself instead of the world origin.
 */
export function normalizePoints(shape: Shape): Shape {
  if (!isPointShape(shape.type)) return shape;
  const pts = shape.points ?? [];
  if (pts.length < 2) return shape;
  let minX = Infinity;
  let minY = Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
  }
  const moved = pts.map((v, i) => (i % 2 === 0 ? v - minX : v - minY));
  return { ...shape, x: shape.x + minX, y: shape.y + minY, points: moved };
}

/** Scale a point list about the local origin (used when baking a resize). */
export function scalePoints(pts: number[], sx: number, sy: number): number[] {
  return pts.map((v, i) => (i % 2 === 0 ? v * sx : v * sy));
}
