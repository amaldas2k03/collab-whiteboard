/**
 * photoImport.ts — the contract between the vision model and the board.
 *
 * The server asks the model for a `PhotoImport` (constrained by
 * `PHOTO_IMPORT_SCHEMA`) and re-checks it with `parsePhotoImport`, because
 * model output is untrusted input. The client turns it into ordinary board
 * shapes with `photoImportToShapes`, then creates them through the normal
 * store path so they sync like anything drawn by hand.
 *
 * Every bbox is normalised to the photo: 0..1 on both axes, origin top-left.
 * That keeps the model's answer independent of pixel sizes and lets the
 * mapper place the result anywhere on the canvas at any scale.
 */

import type { Shape } from './protocol';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextBlock {
  id: string;
  text: string;
  bbox: BBox;
}

export interface MathBlock {
  id: string;
  latex: string;
  bbox: BBox;
}

export type DiagramKind = 'rect' | 'ellipse' | 'diamond';

export interface DiagramShape {
  id: string;
  kind: DiagramKind;
  label: string;
  bbox: BBox;
}

export interface Connector {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface NoteLink {
  fromId: string;
  toId: string;
}

export interface PhotoImport {
  text: TextBlock[];
  math: MathBlock[];
  shapes: DiagramShape[];
  connectors: Connector[];
  links: NoteLink[];
}

/** HTTP error body for POST /api/import-photo. */
export interface PhotoImportError {
  error: string;
}

// ---------------------------------------------------------------------------
// JSON Schema (sent to the model as a structured-output constraint)
// ---------------------------------------------------------------------------

const bbox = {
  type: 'object',
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number' },
    h: { type: 'number' },
  },
  required: ['x', 'y', 'w', 'h'],
  additionalProperties: false,
};

const list = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'array',
  items: { type: 'object', properties, required, additionalProperties: false },
});

export const PHOTO_IMPORT_SCHEMA = {
  type: 'object',
  properties: {
    text: list({ id: { type: 'string' }, text: { type: 'string' }, bbox }, ['id', 'text', 'bbox']),
    math: list({ id: { type: 'string' }, latex: { type: 'string' }, bbox }, ['id', 'latex', 'bbox']),
    shapes: list(
      {
        id: { type: 'string' },
        kind: { type: 'string', enum: ['rect', 'ellipse', 'diamond'] },
        label: { type: 'string' },
        bbox,
      },
      ['id', 'kind', 'label', 'bbox'],
    ),
    connectors: list(
      {
        id: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        label: { type: 'string' },
      },
      ['id', 'from', 'to', 'label'],
    ),
    links: list({ fromId: { type: 'string' }, toId: { type: 'string' } }, ['fromId', 'toId']),
  },
  required: ['text', 'math', 'shapes', 'connectors', 'links'],
  additionalProperties: false,
} as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Hard caps so a runaway answer can't flood a room with thousands of shapes. */
const MAX_ITEMS = 300;
const MAX_TEXT = 2000;

function fail(msg: string): never {
  throw new Error(`invalid import: ${msg}`);
}

function arr(v: unknown, name: string): Record<string, unknown>[] {
  if (!Array.isArray(v)) fail(`${name} is not an array`);
  if (v.length > MAX_ITEMS) fail(`${name} has more than ${MAX_ITEMS} items`);
  return v.map((item, i) => {
    if (!item || typeof item !== 'object') fail(`${name}[${i}] is not an object`);
    return item as Record<string, unknown>;
  });
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string') fail(`${name} is not a string`);
  return v.slice(0, MAX_TEXT);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function box(v: unknown, name: string): BBox {
  const b = v as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') fail(`${name} is not an object`);
  const n = (k: string) => {
    const x = b[k];
    if (typeof x !== 'number' || !Number.isFinite(x)) fail(`${name}.${k} is not a number`);
    return x;
  };
  const x = clamp01(n('x'));
  const y = clamp01(n('y'));
  return { x, y, w: clamp01(Math.min(n('w'), 1 - x)), h: clamp01(Math.min(n('h'), 1 - y)) };
}

/**
 * Check untrusted model output (a JSON string or an already-parsed value)
 * against the schema. Throws on anything structurally wrong; silently drops
 * connectors and links that point at ids the model never defined, since one
 * dangling reference shouldn't sink an otherwise good import.
 */
export function parsePhotoImport(raw: unknown): PhotoImport {
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      fail('not JSON');
    }
  }
  if (!obj || typeof obj !== 'object') fail('not an object');
  const o = obj as Record<string, unknown>;

  const ids = new Set<string>();
  const id = (v: unknown, name: string) => {
    const s = str(v, name);
    if (!s || ids.has(s)) fail(`${name} is empty or duplicated`);
    ids.add(s);
    return s;
  };

  const text = arr(o.text, 'text').map((t, i) => ({
    id: id(t.id, `text[${i}].id`),
    text: str(t.text, `text[${i}].text`),
    bbox: box(t.bbox, `text[${i}].bbox`),
  }));
  const math = arr(o.math, 'math').map((m, i) => ({
    id: id(m.id, `math[${i}].id`),
    latex: str(m.latex, `math[${i}].latex`),
    bbox: box(m.bbox, `math[${i}].bbox`),
  }));
  const shapes = arr(o.shapes, 'shapes').map((s, i) => {
    const kind = s.kind;
    if (kind !== 'rect' && kind !== 'ellipse' && kind !== 'diamond') {
      fail(`shapes[${i}].kind is not rect|ellipse|diamond`);
    }
    return {
      id: id(s.id, `shapes[${i}].id`),
      kind: kind as DiagramKind,
      label: s.label === undefined ? '' : str(s.label, `shapes[${i}].label`),
      bbox: box(s.bbox, `shapes[${i}].bbox`),
    };
  });
  const connectors = arr(o.connectors, 'connectors')
    .map((c, i) => ({
      id: str(c.id, `connectors[${i}].id`),
      from: str(c.from, `connectors[${i}].from`),
      to: str(c.to, `connectors[${i}].to`),
      label: c.label === undefined ? undefined : str(c.label, `connectors[${i}].label`),
    }))
    .filter((c) => ids.has(c.from) && ids.has(c.to) && c.from !== c.to);
  const links = arr(o.links, 'links')
    .map((l, i) => ({
      fromId: str(l.fromId, `links[${i}].fromId`),
      toId: str(l.toId, `links[${i}].toId`),
    }))
    .filter((l) => ids.has(l.fromId) && ids.has(l.toId) && l.fromId !== l.toId);

  return { text, math, shapes, connectors, links };
}

// ---------------------------------------------------------------------------
// Mapping onto the board
// ---------------------------------------------------------------------------

/** A board shape before the store stamps it (same shape as the client's NewShape). */
export type ImportedShape = Omit<Shape, 'version' | 'deleted' | 'z'>;

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

const INK = '#1e1e1e';
/** How faded the reference photo sits under the extracted notes. */
export const PHOTO_OPACITY = 0.35;

/**
 * Endpoints for an arrow from box `a` to box `b`, in world space: each end
 * sits where the centre-to-centre line leaves its box, so arrows touch the
 * outlines instead of stabbing into the middle.
 */
export function connectorPoints(a: Placement, b: Placement): number[] {
  const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const edge = (box: Placement, c: { x: number; y: number }, dx: number, dy: number) => {
    const t = Math.min(
      dx ? box.width / 2 / Math.abs(dx) : Infinity,
      dy ? box.height / 2 / Math.abs(dy) : Infinity,
      1,
    );
    return [c.x + dx * t, c.y + dy * t];
  };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  return [...edge(a, ac, dx, dy), ...edge(b, bc, -dx, -dy)];
}

/** Re-origin world points to their own top-left, matching the client's convention. */
function originPoints(pts: number[]): { x: number; y: number; points: number[] } {
  const x = Math.min(pts[0], pts[2]);
  const y = Math.min(pts[1], pts[3]);
  return { x, y, points: pts.map((v, i) => (i % 2 === 0 ? v - x : v - y)) };
}

/**
 * Turn a validated import into board shapes laid over `place` (the photo's
 * box on the canvas). Model ids are local to one answer, so every shape gets
 * a fresh id from `newId` and connectors/links are rewired to those.
 * The reference photo (when `src` is given) comes first so it stacks lowest.
 */
export function photoImportToShapes(
  data: PhotoImport,
  place: Placement,
  src: string | null,
  newId: () => string,
): ImportedShape[] {
  const ids = new Map<string, string>();
  const uid = (local: string) => {
    let id = ids.get(local);
    if (!id) ids.set(local, (id = newId()));
    return id;
  };
  const world = (b: BBox): Placement => ({
    x: place.x + b.x * place.width,
    y: place.y + b.y * place.height,
    width: Math.max(8, b.w * place.width),
    height: Math.max(8, b.h * place.height),
  });

  const out: ImportedShape[] = [];
  if (src) {
    out.push({
      id: newId(),
      type: 'image',
      ...place,
      src,
      locked: true,
      style: { stroke: 'transparent', fill: 'transparent', strokeWidth: 0, opacity: PHOTO_OPACITY },
    });
  }

  const boxes = new Map<string, Placement>();

  for (const s of data.shapes) {
    const b = world(s.bbox);
    boxes.set(s.id, b);
    out.push({
      id: uid(s.id),
      type: s.kind,
      ...b,
      ...(s.label ? { text: s.label } : {}),
      style: { stroke: INK, fill: 'transparent', strokeWidth: 2, opacity: 1, fontSize: 16 },
    });
  }

  for (const t of data.text) {
    const b = world(t.bbox);
    boxes.set(t.id, b);
    const lines = Math.max(1, t.text.split('\n').length);
    out.push({
      id: uid(t.id),
      type: 'text',
      x: b.x,
      y: b.y,
      // Typeset glyphs often run wider than the handwriting they replace; a
      // little slack stops each line re-wrapping.
      width: b.width * 1.15,
      text: t.text,
      style: {
        stroke: INK,
        fill: INK,
        strokeWidth: 1,
        opacity: 1,
        fontSize: Math.round(Math.min(72, Math.max(12, b.height / lines / 1.3))),
      },
    });
  }

  for (const m of data.math) {
    const b = world(m.bbox);
    boxes.set(m.id, b);
    out.push({
      id: uid(m.id),
      type: 'math',
      ...b,
      text: m.latex,
      style: { stroke: INK, fill: INK, strokeWidth: 1, opacity: 1 },
    });
  }

  for (const c of data.connectors) {
    const a = boxes.get(c.from);
    const b = boxes.get(c.to);
    if (!a || !b) continue;
    out.push({
      id: uid(c.id),
      type: 'arrow',
      ...originPoints(connectorPoints(a, b)),
      from: uid(c.from),
      to: uid(c.to),
      ...(c.label ? { text: c.label } : {}),
      style: { stroke: INK, fill: 'transparent', strokeWidth: 2, opacity: 1 },
    });
  }

  for (const l of data.links) {
    const shape = out.find((s) => s.id === ids.get(l.fromId));
    if (shape) shape.link = uid(l.toId);
  }

  return out;
}
