/**
 * index.ts — WebSocket server entrypoint.
 *
 * Responsibilities (deliberately thin — all merge logic lives in @shared):
 *   - Accept ws connections at  ws://host:PORT/?room=<code>&clientId=<id>
 *   - Register the client in the room and send it a one-off `sync:full`.
 *   - Route each incoming message through room.apply() and broadcast the result.
 *   - On disconnect, remove the client and tell peers with `presence:leave`.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'node:http';
import { RoomManager, Room } from './room.js';
import { parseMessage } from '@shared/protocol';
import type { Presence, ServerMessage } from '@shared/protocol';

const PORT = Number(process.env.PORT) || 8080;

const manager = new RoomManager();
const wss = new WebSocketServer({ port: PORT });

console.log(`[whiteboard] WebSocket server listening on ws://localhost:${PORT}`);

/** Pull room + clientId out of the connection URL query string. */
function parseConnParams(req: IncomingMessage): { room: string; clientId: string } {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const room = url.searchParams.get('room')?.trim() || 'default';
  const clientId =
    url.searchParams.get('clientId')?.trim() || Math.random().toString(36).slice(2);
  return { room, clientId };
}

wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
  const { room: roomId, clientId } = parseConnParams(req);
  const room = manager.getOrCreate(roomId);

  // A placeholder presence; the client's own presence:join fills in name/color.
  const presence: Presence = {
    clientId,
    name: 'Anonymous',
    color: '#888888',
    cursor: { x: 0, y: 0 },
  };
  room.addClient({ clientId, socket, presence });
  console.log(`[whiteboard] ${clientId} joined room "${roomId}" (now ${room.clientCount})`);

  // The ONE full-state message this client will ever receive.
  const sync: ServerMessage = {
    type: 'sync:full',
    senderId: 'server',
    lamport: 0,
    payload: room.fullState(),
  };
  room.sendTo(clientId, sync);

  socket.on('message', (data) => {
    const msg = parseMessage(data.toString());
    if (!msg) return; // ignore malformed frames

    const out = room.apply(msg);
    if (!out) return; // stale no-op — nothing to relay

    // cursor + presence + shape deltas all fan out to peers (not the sender).
    room.broadcast(out, clientId);
  });

  const onGone = () => handleDisconnect(room, clientId);
  socket.on('close', onGone);
  socket.on('error', onGone);
});

/** Remove a client and notify the room, dropping the room if it's now empty. */
function handleDisconnect(room: Room, clientId: string): void {
  const removed = room.removeClient(clientId);
  if (!removed) return; // already handled (close + error can both fire)

  console.log(`[whiteboard] ${clientId} left room "${room.id}" (now ${room.clientCount})`);
  room.broadcast({
    type: 'presence:leave',
    senderId: 'server',
    lamport: 0,
    payload: { clientId },
  });
  manager.maybeDrop(room);
}
