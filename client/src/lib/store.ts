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
 */

import { LamportClock } from '@shared/lamport';
import { mergeCreate, mergeUpdate, mergeDelete } from '@shared/merge';
import type {
  Shape,
  ShapeChanges,
  Presence,
  Version,
  WireMessage,
  ClientMessage,
} from '@shared/protocol';

export interface Snapshot {
  shapes: Shape[];
  /** other users only (never includes self) */
  presence: Presence[];
}

export class BoardStore {
  private shapes = new Map<string, Shape>();
  private presence = new Map<string, Presence>();
  private clock = new LamportClock();
  private listeners = new Set<() => void>();
  private snap: Snapshot = { shapes: [], presence: [] };

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
      shapes: [...this.shapes.values()].filter((s) => !s.deleted),
      presence: [...this.presence.values()].filter(
        (p) => p.clientId !== this.clientId,
      ),
    };
    this.listeners.forEach((l) => l());
  }

  private nextVersion(): Version {
    return { lamport: this.clock.tick(), clientId: this.clientId };
  }

  // --- local edits (optimistic) --------------------------------------------

  createShape(base: Omit<Shape, 'version' | 'deleted'>): Shape {
    const shape: Shape = { ...base, version: this.nextVersion(), deleted: false };
    this.shapes.set(shape.id, shape);
    this.send({
      type: 'shape:create',
      senderId: this.clientId,
      lamport: shape.version.lamport,
      payload: { shape },
    });
    this.emit();
    return shape;
  }

  updateShape(id: string, changes: ShapeChanges): void {
    const current = this.shapes.get(id);
    if (!current) return;
    const version = this.nextVersion();
    const merged = mergeUpdate(current, id, changes, version);
    if (!merged) return;
    this.shapes.set(id, merged);
    this.send({
      type: 'shape:update',
      senderId: this.clientId,
      lamport: version.lamport,
      payload: { id, changes, version },
    });
    this.emit();
  }

  deleteShape(id: string): void {
    const current = this.shapes.get(id);
    if (!current) return;
    const version = this.nextVersion();
    const merged = mergeDelete(current, version);
    if (!merged) return;
    this.shapes.set(id, merged);
    this.send({
      type: 'shape:delete',
      senderId: this.clientId,
      lamport: version.lamport,
      payload: { id, version },
    });
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
          this.shapes.set(s.id, mergeCreate(this.shapes.get(s.id), s));
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
        this.shapes.set(s.id, mergeCreate(this.shapes.get(s.id), s));
        break;
      }
      case 'shape:update': {
        const { id, changes, version } = msg.payload;
        const merged = mergeUpdate(this.shapes.get(id), id, changes, version);
        if (merged) this.shapes.set(id, merged);
        break;
      }
      case 'shape:delete': {
        const { id, version } = msg.payload;
        const merged = mergeDelete(this.shapes.get(id), version);
        if (merged) this.shapes.set(id, merged);
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
