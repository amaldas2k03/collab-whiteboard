/**
 * room.ts — server-side room state and the broadcast fan-out.
 *
 * A Room owns the authoritative board state for one room code. It applies every
 * incoming board mutation through the SHARED merge module (the exact same code
 * the clients run), so the server is just another CRDT replica that also happens
 * to be the sync point for newcomers.
 *
 * The server never broadcasts whole-board state except in the initial
 * `sync:full` sent to a joining client — everything else is a delta.
 */

import type { WebSocket } from 'ws';
import { LamportClock } from '@shared/lamport';
import {
  mergeCreate,
  mergeUpdate,
  mergeDelete,
} from '@shared/merge';
import type {
  Presence,
  Shape,
  ServerMessage,
  WireMessage,
} from '@shared/protocol';

/** One connected client, as seen by the server. */
export interface Client {
  clientId: string;
  socket: WebSocket;
  presence: Presence;
}

export class Room {
  readonly id: string;
  /** Authoritative shape store, including tombstones (deleted shapes). */
  private shapes = new Map<string, Shape>();
  /** Connected clients keyed by clientId. */
  private clients = new Map<string, Client>();
  /** The server's own Lamport clock, advanced as it observes remote events. */
  private clock = new LamportClock();

  constructor(id: string) {
    this.id = id;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  // --- membership -----------------------------------------------------------

  addClient(client: Client): void {
    this.clients.set(client.clientId, client);
  }

  removeClient(clientId: string): Presence | undefined {
    const client = this.clients.get(clientId);
    this.clients.delete(clientId);
    return client?.presence;
  }

  /** Snapshot for the initial sync:full — the only time we send full state. */
  fullState(): { shapes: Shape[]; users: Presence[] } {
    return {
      shapes: [...this.shapes.values()],
      users: [...this.clients.values()].map((c) => c.presence),
    };
  }

  // --- message handling -----------------------------------------------------

  /**
   * Apply an incoming client message to authoritative state and decide whether
   * (and what) to broadcast. Returns the message to fan out to peers, or null
   * if the message was a stale no-op that changed nothing.
   */
  apply(msg: WireMessage): ServerMessage | null {
    // Keep the server clock ahead of every logical stamp it observes.
    if (msg.lamport > 0) this.clock.update(msg.lamport);

    switch (msg.type) {
      case 'presence:join': {
        const client = this.clients.get(msg.payload.clientId);
        if (client) {
          client.presence.name = msg.payload.name;
          client.presence.color = msg.payload.color;
        }
        return msg; // let peers learn the new member
      }

      case 'shape:create': {
        const current = this.shapes.get(msg.payload.shape.id);
        const merged = mergeCreate(current, msg.payload.shape);
        this.shapes.set(merged.id, merged);
        // Broadcast the authoritative winner so replicas converge even if the
        // sender's create lost to one already stored.
        return {
          type: 'shape:create',
          senderId: msg.senderId,
          lamport: merged.version.lamport,
          payload: { shape: merged },
        };
      }

      case 'shape:update': {
        const { id, changes, version } = msg.payload;
        const current = this.shapes.get(id);
        const merged = mergeUpdate(current, id, changes, version);
        if (!merged || merged === current) return null; // stale / unknown
        this.shapes.set(id, merged);
        return msg;
      }

      case 'shape:delete': {
        const { id, version } = msg.payload;
        const current = this.shapes.get(id);
        const merged = mergeDelete(current, version);
        if (!merged || merged === current) return null; // stale / unknown
        this.shapes.set(id, merged);
        return msg;
      }

      case 'cursor:move': {
        // Ephemeral presence: update the cached cursor, never touch shapes,
        // never run the merge module. Relayed as-is.
        const client = this.clients.get(msg.payload.clientId);
        if (client) {
          client.presence.cursor = { x: msg.payload.x, y: msg.payload.y };
        }
        return msg;
      }

      default:
        return null;
    }
  }

  // --- fan-out --------------------------------------------------------------

  /** Send a message to one specific client. */
  sendTo(clientId: string, msg: ServerMessage): void {
    const client = this.clients.get(clientId);
    if (client && client.socket.readyState === client.socket.OPEN) {
      client.socket.send(JSON.stringify(msg));
    }
  }

  /** Broadcast a message to everyone except `exceptId` (usually the sender). */
  broadcast(msg: ServerMessage, exceptId?: string): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.clientId === exceptId) continue;
      if (client.socket.readyState === client.socket.OPEN) {
        client.socket.send(data);
      }
    }
  }
}

/** Owns all rooms. Creates them lazily and drops them when the last client leaves. */
export class RoomManager {
  private rooms = new Map<string, Room>();

  getOrCreate(roomId: string): Room {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId);
      this.rooms.set(roomId, room);
    }
    return room;
  }

  maybeDrop(room: Room): void {
    if (room.clientCount === 0) this.rooms.delete(room.id);
  }

  get roomCount(): number {
    return this.rooms.size;
  }
}
