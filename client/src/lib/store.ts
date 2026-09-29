/**
 * store.ts — the client-side board replica.
 *
 * This is the client's half of the CRDT. It holds the local shape + presence
 * maps and runs the SAME `@shared/merge` functions the server runs, so a client
 * converges to identical state regardless of the order messages arrive in.
 *
 * It exposes a `useSyncExternalStore`-compatible interface (subscribe +
 * getSnapshot) so React re-renders whenever the board changes.
 *
 * Local edits are optimistic: we stamp a new Lamport version, apply it locally
 * immediately, and send the delta. The server never echoes a message back to
 * its own sender, so there is no double-apply.
 *
 * Undo/redo (see the history section) is layered strictly *on top* of those
 * primitives: an undo is not a rollback, it is a brand-new edit with a brand-new
 * Lamport stamp. That keeps the CRDT's single rule intact — the newest logical
 * write wins — so undoing locally never resurrects state on a peer that has
 * since edited the same shape.
 */

import { LamportClock } from '@shared/lamport';
import { mergeCreate, mergeUpdate, mergeDelete } from '@shared/merge';
import type {
  Shape,
  ShapeChanges,
  ShapeStyle,
  Presence,
  Version,
  WireMessage,
  ClientMessage,
} from '@shared/protocol';

export interface Snapshot {
  /** Live (non-tombstoned) shapes, already sorted into draw order. */
  shapes: Shape[];
  /** other users only (never includes self) */
  presence: Presence[];
  canUndo: boolean;
  canRedo: boolean;
}

/** New shapes are created without a version, tombstone or stacking order. */
export type NewShape = Omit<Shape, 'version' | 'deleted' | 'z'>;

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

type HistoryOp =
  /** shape came into existence — undo removes it */
  | { kind: 'create'; shape: Shape }
  /** field-level edit — `before` and `after` are both partial patches */
  | { kind: 'update'; id: string; before: ShapeChanges; after: ShapeChanges }
  /** shape was tombstoned — undo re-creates it from the saved body */
  | { kind: 'delete'; shape: Shape };

/** One user-visible undo step. Multi-shape actions bundle several ops. */
interface HistoryEntry {
  ops: HistoryOp[];
  /**
   * Coalescing key. Consecutive edits sharing a key (a single drag, say) fold
   * into one entry so undo steps match user intent rather than packet count.
   */
  key: string | null;
}

const MAX_HISTORY = 100;

export class BoardStore {
  private shapes = new Map<string, Shape>();
  private presence = new Map<string, Presence>();
  private clock = new LamportClock();
  private listeners = new Set<() => void>();
  private snap: Snapshot = {
    shapes: [],
    presence: [],
    canUndo: false,
    canRedo: false,
  };

  /** Highest stacking order seen, so new shapes land on top. */
  private maxZ = 0;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  /** Key of the entry currently open for coalescing, if any. */
  private openKey: string | null = null;

  /** Set by the connection layer once the socket is open. */
  send: (msg: ClientMessage) => void = () => {};

  constructor(
    readonly clientId: string,
    readonly name: string,
    readonly color: string,
  ) {}

  // --- React integration ----------------------------------------------------

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): Snapshot => this.snap;

  /** Recompute the immutable snapshot and notify subscribers. */
  private emit(): void {
    this.snap = {
      shapes: [...this.shapes.values()]
        .filter((s) => !s.deleted)
        // Draw order: stacking index first, id as a stable tie-breaker so every
        // replica paints overlapping shapes in the same order.
        .sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || (a.id < b.id ? -1 : 1)),
      presence: [...this.presence.values()].filter(
        (p) => p.clientId !== this.clientId,
      ),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
    this.listeners.forEach((l) => l());
  }

  private nextVersion(): Version {
    return { lamport: this.clock.tick(), clientId: this.clientId };
  }

  /** The single place a shape enters the map, so `maxZ` can never drift. */
  private put(shape: Shape): void {
    this.shapes.set(shape.id, shape);
    this.maxZ = Math.max(this.maxZ, shape.z ?? 0);
  }

  getShape(id: string): Shape | undefined {
    return this.shapes.get(id);
  }

  // --- wire primitives (no history) ----------------------------------------

  /** Create-or-replace a whole shape with a fresh version. */
  private putShape(base: Omit<Shape, 'version' | 'deleted'>): Shape {
    const shape: Shape = {
      ...base,
      version: this.nextVersion(),
      deleted: false,
    };
    this.put(shape);
    this.send({
      type: 'shape:create',
      senderId: this.clientId,
      lamport: shape.version.lamport,
      payload: { shape },
    });
    return shape;
  }

  /** Apply + broadcast a partial patch. Returns false if the shape is gone. */
  private write(id: string, changes: ShapeChanges): boolean {
    const current = this.shapes.get(id);
    if (!current) return false;
    const version = this.nextVersion();
    const merged = mergeUpdate(current, id, changes, version);
    if (!merged) return false;
    this.put(merged);
    this.send({
      type: 'shape:update',
      senderId: this.clientId,
      lamport: version.lamport,
      payload: { id, changes, version },
    });
    return true;
  }

  /** Tombstone a shape. Returns false if it was already gone. */
  private remove(id: string): boolean {
    const current = this.shapes.get(id);
    if (!current || current.deleted) return false;
    const version = this.nextVersion();
    const merged = mergeDelete(current, version);
    if (!merged) return false;
    this.put(merged);
    this.send({
      type: 'shape:delete',
      senderId: this.clientId,
      lamport: version.lamport,
      payload: { id, version },
    });
    return true;
  }

  // --- history bookkeeping --------------------------------------------------

  private record(ops: HistoryOp[], key: string | null = null): void {
    if (ops.length === 0) return;
    const top = this.undoStack[this.undoStack.length - 1];

    // Fold into the open entry when the caller reuses its key (e.g. every
    // throttled frame of one drag).
    if (key && key === this.openKey && top && top.key === key) {
      for (const op of ops) {
        const existing = top.ops.find(
          (o) => o.kind === 'update' && op.kind === 'update' && o.id === op.id,
        );
        if (existing && existing.kind === 'update' && op.kind === 'update') {
          // Keep the ORIGINAL `before` — that is where undo must land.
          existing.after = { ...existing.after, ...op.after };
        } else {
          top.ops.push(op);
        }
      }
    } else {
      this.undoStack.push({ ops, key });
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.openKey = key;
    }
    // Any new action invalidates the redo branch.
    this.redoStack.length = 0;
  }

  /** Snapshot the current value of every field a patch is about to change. */
  private inverseOf(current: Shape, changes: ShapeChanges): ShapeChanges {
    const before: ShapeChanges = {};
    for (const key of Object.keys(changes) as (keyof ShapeChanges)[]) {
      // Assigning through a widened alias: each key's value type matches by
      // construction, but TS cannot prove that across a dynamic key.
      (before as Record<string, unknown>)[key] = current[key];
    }
    return before;
  }

  /**
   * Close the current coalescing window. Call on pointer-up so the next drag
   * starts a fresh undo step.
   */
  sealHistory(): void {
    this.openKey = null;
  }

  private applyForward(ops: HistoryOp[]): void {
    for (const op of ops) {
      if (op.kind === 'create') this.putShape(stripMeta(op.shape));
      else if (op.kind === 'update') this.write(op.id, op.after);
      else this.remove(op.shape.id);
    }
  }

  private applyBackward(ops: HistoryOp[]): void {
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      if (op.kind === 'create') this.remove(op.shape.id);
      else if (op.kind === 'update') this.write(op.id, op.before);
      // Re-creating with a *newer* version out-votes the tombstone, which is
      // how a delete gets undone without a special "undelete" message.
      else this.putShape(stripMeta(op.shape));
    }
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.openKey = null;
    this.applyBackward(entry.ops);
    this.redoStack.push(entry);
    this.emit();
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.openKey = null;
    this.applyForward(entry.ops);
    this.undoStack.push(entry);
    this.emit();
  }

  // --- local edits (optimistic, recorded) ----------------------------------

  /** Draw a new shape. It is placed on top of everything currently on screen. */
  createShape(base: NewShape): Shape {
    const shape = this.putShape({ ...base, z: this.maxZ + 1 });
    this.record([{ kind: 'create', shape }]);
    this.emit();
    return shape;
  }

  /**
   * Patch a shape.
   *
   * @param coalesceKey pass a stable key (e.g. `drag:<id>`) to fold a stream of
   *   updates into one undo step; omit it for discrete edits.
   */
  updateShape(id: string, changes: ShapeChanges, coalesceKey?: string): void {
    const current = this.shapes.get(id);
    if (!current) return;
    const before = this.inverseOf(current, changes);
    if (!this.write(id, changes)) return;
    this.record(
      [{ kind: 'update', id, before, after: { ...changes } }],
      coalesceKey ?? null,
    );
    this.emit();
  }

  /** Merge a patch into a shape's style without disturbing its other fields. */
  updateStyle(id: string, patch: Partial<ShapeStyle>): void {
    const current = this.shapes.get(id);
    if (!current) return;
    this.updateShape(id, { style: { ...current.style, ...patch } });
  }

  deleteShape(id: string): void {
    const current = this.shapes.get(id);
    if (!current || current.deleted) return;
    if (!this.remove(id)) return;
    this.record([{ kind: 'delete', shape: current }]);
    this.emit();
  }

  /** Delete several shapes as ONE undo step (used by the eraser drag). */
  deleteShapes(ids: string[]): void {
    const ops: HistoryOp[] = [];
    for (const id of ids) {
      const current = this.shapes.get(id);
      if (!current || current.deleted) continue;
      if (this.remove(id)) ops.push({ kind: 'delete', shape: current });
    }
    if (ops.length === 0) return;
    // Every shape touched by one eraser stroke shares the stroke's key.
    this.record(ops, 'erase');
    this.emit();
  }

  /** Copy a shape, offset slightly, and return the copy's id. */
  duplicateShape(id: string, offset = 16): string | null {
    const current = this.shapes.get(id);
    if (!current || current.deleted) return null;
    const copy = this.putShape({
      ...stripMeta(current),
      id: crypto.randomUUID(),
      x: current.x + offset,
      y: current.y + offset,
      z: this.maxZ + 1,
    });
    this.record([{ kind: 'create', shape: copy }]);
    this.emit();
    return copy.id;
  }

  bringToFront(id: string): void {
    const current = this.shapes.get(id);
    if (!current) return;
    if ((current.z ?? 0) >= this.maxZ) return;
    this.updateShape(id, { z: this.maxZ + 1 });
  }

  sendToBack(id: string): void {
    const current = this.shapes.get(id);
    if (!current) return;
    let minZ = 0;
    for (const s of this.shapes.values()) {
      if (!s.deleted) minZ = Math.min(minZ, s.z ?? 0);
    }
    if ((current.z ?? 0) <= minZ) return;
    this.updateShape(id, { z: minZ - 1 });
  }

  /** Wipe the board. Recorded as a single undo step. */
  clearBoard(): void {
    const ops: HistoryOp[] = [];
    for (const shape of this.shapes.values()) {
      if (shape.deleted) continue;
      if (this.remove(shape.id)) ops.push({ kind: 'delete', shape });
    }
    if (ops.length === 0) return;
    this.record(ops);
    this.emit();
  }

  /** Cursor moves are ephemeral: no version, never merged, not stored as shape. */
  moveCursor(x: number, y: number): void {
    this.send({
      type: 'cursor:move',
      senderId: this.clientId,
      lamport: 0,
      payload: { clientId: this.clientId, x, y },
    });
  }

  // --- remote messages ------------------------------------------------------

  applyRemote(msg: WireMessage): void {
    // Keep our Lamport clock ahead of every logical stamp we observe.
    if (msg.lamport > 0) this.clock.update(msg.lamport);

    switch (msg.type) {
      case 'sync:full': {
        for (const s of msg.payload.shapes) {
          this.put(mergeCreate(this.shapes.get(s.id), s));
        }
        for (const p of msg.payload.users) {
          if (p.clientId !== this.clientId) this.presence.set(p.clientId, p);
        }
        break;
      }
      case 'presence:join': {
        const { clientId, name, color } = msg.payload;
        if (clientId !== this.clientId && !this.presence.has(clientId)) {
          this.presence.set(clientId, {
            clientId,
            name,
            color,
            cursor: { x: 0, y: 0 },
          });
        }
        break;
      }
      case 'presence:leave': {
        this.presence.delete(msg.payload.clientId);
        break;
      }
      case 'shape:create': {
        const s = msg.payload.shape;
        this.put(mergeCreate(this.shapes.get(s.id), s));
        break;
      }
      case 'shape:update': {
        const { id, changes, version } = msg.payload;
        const merged = mergeUpdate(this.shapes.get(id), id, changes, version);
        if (merged) this.put(merged);
        break;
      }
      case 'shape:delete': {
        const { id, version } = msg.payload;
        const merged = mergeDelete(this.shapes.get(id), version);
        if (merged) this.put(merged);
        break;
      }
      case 'cursor:move': {
        const p = this.presence.get(msg.payload.clientId);
        if (p) p.cursor = { x: msg.payload.x, y: msg.payload.y };
        break;
      }
    }
    this.emit();
  }
}

/** Drop the CRDT metadata so a shape body can be re-sent with a new version. */
function stripMeta(shape: Shape): Omit<Shape, 'version' | 'deleted'> {
  const { version, deleted, ...body } = shape; // eslint-disable-line @typescript-eslint/no-unused-vars
  return body;
}
