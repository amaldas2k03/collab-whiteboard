/**
 * drafts.ts — the in-progress shape the user is dragging out.
 *
 * A draft is a real `Shape` with a placeholder version, rendered by the same
 * component as everything else so what you see while dragging is exactly what
 * you get on release. Drafts are built in *world* coordinates; `finalizeDraft`
 * re-origins point shapes before the shape is committed to the store.
 */

import type { Shape, ShapeType } from '@shared/protocol';
import { normalizePoints } from './geometry';
import { styleFor, type DrawStyle } from './tools';

/** A freshly placed sticky note, in world units. */
export const NOTE_SIZE = { width: 190, height: 150 };
/** Wrap width for a freshly placed text box, in world units. */
export const TEXT_WIDTH = 280;

const DRAFT_VERSION = { lamport: 0, clientId: 'draft' };

export function makeDraft(
  type: ShapeType,
  x: number,
  y: number,
  draw: DrawStyle,
): Shape {
  const base = {
    id: crypto.randomUUID(),
    type,
    style: styleFor(type, draw),
    version: DRAFT_VERSION,
    deleted: false,
  };
  switch (type) {
    case 'line':
    case 'arrow':
      return { ...base, x: 0, y: 0, points: [x, y, x, y] };
    case 'curve':
      // Start as a degenerate quadratic; `growDraft` bends it once there is a
      // direction to bend perpendicular to.
      return { ...base, x: 0, y: 0, points: [x, y, x, y, x, y] };
    case 'pen':
    case 'highlight':
      return { ...base, x: 0, y: 0, points: [x, y] };
    default:
      return { ...base, x, y, width: 0, height: 0 };
  }
}

/** How far a curve bows out from the straight line between its endpoints. */
const CURVE_BEND = 0.25;

export function growDraft(
  draft: Shape,
  startX: number,
  startY: number,
  curX: number,
  curY: number,
  /** Hold Shift to constrain: square boxes, and 45-degree lines. */
  constrain = false,
): Shape {
  if (draft.type === 'line' || draft.type === 'arrow') {
    const [ex, ey] = constrain
      ? snapAngle(startX, startY, curX, curY)
      : [curX, curY];
    return { ...draft, points: [startX, startY, ex, ey] };
  }

  if (draft.type === 'curve') {
    const [ex, ey] = constrain
      ? snapAngle(startX, startY, curX, curY)
      : [curX, curY];
    const dx = ex - startX;
    const dy = ey - startY;
    const len = Math.hypot(dx, dy) || 1;
    // Control point: the midpoint pushed out along the segment's normal.
    const mx = (startX + ex) / 2;
    const my = (startY + ey) / 2;
    const bend = len * CURVE_BEND;
    return {
      ...draft,
      points: [
        startX,
        startY,
        mx + (-dy / len) * bend,
        my + (dx / len) * bend,
        ex,
        ey,
      ],
    };
  }

  if (draft.type === 'pen' || draft.type === 'highlight') {
    const pts = draft.points ?? [];
    // Drop samples closer than a pixel: fewer points, identical stroke, and a
    // much smaller payload over the wire.
    const n = pts.length;
    if (n >= 2 && Math.hypot(curX - pts[n - 2], curY - pts[n - 1]) < 1) {
      return draft;
    }
    return { ...draft, points: [...pts, curX, curY] };
  }

  // rect / ellipse / note / text: normalise the box so dragging any direction
  // works, optionally forced square.
  let w = Math.abs(curX - startX);
  let h = Math.abs(curY - startY);
  if (constrain) {
    const side = Math.max(w, h);
    w = side;
    h = side;
  }
  return {
    ...draft,
    x: curX < startX ? startX - w : startX,
    y: curY < startY ? startY - h : startY,
    width: w,
    height: h,
  };
}

/** Snap an endpoint to the nearest 45-degree ray from the start point. */
function snapAngle(
  startX: number,
  startY: number,
  curX: number,
  curY: number,
): [number, number] {
  const dx = curX - startX;
  const dy = curY - startY;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [startX + Math.cos(angle) * len, startY + Math.sin(angle) * len];
}

/** Reject accidental click-drags that produced nothing worth keeping. */
export function isDraftValid(draft: Shape): boolean {
  if (draft.type === 'line' || draft.type === 'arrow') {
    const p = draft.points ?? [];
    return p.length >= 4 && Math.hypot(p[2] - p[0], p[3] - p[1]) > 3;
  }
  if (draft.type === 'curve') {
    const p = draft.points ?? [];
    return p.length >= 6 && Math.hypot(p[4] - p[0], p[5] - p[1]) > 3;
  }
  if (draft.type === 'pen' || draft.type === 'highlight') {
    return (draft.points?.length ?? 0) >= 4;
  }
  return (draft.width ?? 0) > 3 && (draft.height ?? 0) > 3;
}

/** Strip the draft metadata and re-origin point shapes, ready for the store. */
export function finalizeDraft(draft: Shape): Omit<Shape, 'version' | 'deleted' | 'z'> {
  const normalized = normalizePoints(draft);
  const { version, deleted, z, ...body } = normalized; // eslint-disable-line @typescript-eslint/no-unused-vars
  return body;
}
