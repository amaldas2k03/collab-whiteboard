/**
 * protocol.ts — the single source of truth for the client <-> server wire format.
 *
 * This file is imported (via the `@shared/*` path alias) by BOTH the server and
 * the client, so the two sides can never drift out of sync on message shapes.
 *
 * Design notes for reviewers:
 *  - Every board-mutating message carries a Lamport `lamport` stamp. Conflict
 *    resolution is driven entirely by these logical timestamps, never by the
 *    order the server happens to receive messages in. See `merge.ts`.
 *  - Only `sync:full` ever carries whole-board state. Every other message is a
 *    delta (create / update / delete a single shape, or a cursor move).
 */

// ---------------------------------------------------------------------------
// Shapes (the board's persistent state)
// ---------------------------------------------------------------------------

export type ShapeType =
  /** axis-aligned box */
  | 'rect'
  /** ellipse inscribed in the box */
  | 'ellipse'
  /** straight segment */
  | 'line'
  /** straight segment with an arrowhead at the far end */
  | 'arrow'
  /** quadratic curve: points are [x0,y0, cx,cy, x1,y1] */
  | 'curve'
  /** freehand stroke */
  | 'pen'
  /** freehand stroke drawn wide + translucent, multiplied over what it covers */
  | 'highlight'
  /** free-floating label */
  | 'text'
  /** sticky note: a filled box with wrapped text inside */
  | 'note';

/** Logical version stamp used by the merge module to order concurrent edits. */
export interface Version {
  /** Lamport timestamp of the edit that produced this version. */
  lamport: number;
  /** Client that produced the edit — used as a deterministic tie-breaker. */
  clientId: string;
}

export interface ShapeStyle {
  stroke: string;
  fill: string;
  strokeWidth: number;
  /**
   * Whole-shape alpha, 0..1. Optional so a client running an older build still
   * parses shapes produced here — readers must treat `undefined` as 1.
   */
  opacity?: number;
  /** text / note only. Readers treat `undefined` as the per-type default. */
  fontSize?: number;
  /** render the stroke dashed */
  dash?: boolean;
}

/**
 * A single drawable object. One `version` per shape => whole-shape LWW.
 * `deleted` is a tombstone flag (kept, not removed) so a late-arriving update
 * cannot resurrect a shape that was concurrently deleted.
 */
export interface Shape {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  /** rect / ellipse */
  width?: number;
  height?: number;
  /** line / pen — flat [x1,y1,x2,y2,...] in the shape's local space. */
  points?: number[];
  /** text box */
  text?: string;
  /**
   * Stacking order, ascending — lower draws first. Optional for the same
   * wire-compat reason as `style.opacity`; readers treat `undefined` as 0.
   */
  z?: number;
  /** Rotation in degrees, clockwise, about the shape's own origin. */
  rotation?: number;
  style: ShapeStyle;
  version: Version;
  deleted: boolean;
}

/** Partial shape patch sent on update — only the fields that changed. */
export type ShapeChanges = Partial<
  Pick<
    Shape,
    'x' | 'y' | 'width' | 'height' | 'points' | 'text' | 'style' | 'z' | 'rotation'
  >
>;

// ---------------------------------------------------------------------------
// Presence (ephemeral, never merged, never part of board state)
// ---------------------------------------------------------------------------

export interface Presence {
  clientId: string;
  name: string;
  color: string;
  cursor: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Messages — a discriminated union on `type`.
// ---------------------------------------------------------------------------

interface BaseMessage {
  /** Client that originated the message. */
  senderId: string;
  /** Lamport stamp at send time (0 for pure-presence messages). */
  lamport: number;
}

/** S -> C: sent once, immediately after a client joins. The ONLY full-state msg. */
export interface SyncFullMessage extends BaseMessage {
  type: 'sync:full';
  payload: { shapes: Shape[]; users: Presence[] };
}

/** C -> S -> C: a client announces itself. */
export interface PresenceJoinMessage extends BaseMessage {
  type: 'presence:join';
  payload: { clientId: string; name: string; color: string };
}

/** S -> C: a client disconnected. */
export interface PresenceLeaveMessage extends BaseMessage {
  type: 'presence:leave';
  payload: { clientId: string };
}

/** C -> S -> C: a new shape was drawn. */
export interface ShapeCreateMessage extends BaseMessage {
  type: 'shape:create';
  payload: { shape: Shape };
}

/** C -> S -> C: an existing shape was moved / resized / edited. */
export interface ShapeUpdateMessage extends BaseMessage {
  type: 'shape:update';
  payload: { id: string; changes: ShapeChanges; version: Version };
}

/** C -> S -> C: a shape was deleted (becomes a tombstone). */
export interface ShapeDeleteMessage extends BaseMessage {
  type: 'shape:delete';
  payload: { id: string; version: Version };
}

/** C -> S -> C: high-frequency cursor movement. Ephemeral, never merged. */
export interface CursorMoveMessage extends BaseMessage {
  type: 'cursor:move';
  payload: { clientId: string; x: number; y: number };
}

export type ClientMessage =
  | PresenceJoinMessage
  | ShapeCreateMessage
  | ShapeUpdateMessage
  | ShapeDeleteMessage
  | CursorMoveMessage;

export type ServerMessage =
  | SyncFullMessage
  | PresenceJoinMessage
  | PresenceLeaveMessage
  | ShapeCreateMessage
  | ShapeUpdateMessage
  | ShapeDeleteMessage
  | CursorMoveMessage;

export type WireMessage = ServerMessage; // superset of both directions

/** Safe JSON parse that narrows to a WireMessage or returns null. */
export function parseMessage(raw: string): WireMessage | null {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.type === 'string') return obj as WireMessage;
    return null;
  } catch {
    return null;
  }
}
