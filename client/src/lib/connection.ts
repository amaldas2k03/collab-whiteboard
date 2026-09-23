/**
 * connection.ts — the WebSocket transport.
 *
 * Thin wrapper that:
 *   - opens ws://<host>/?room=&clientId=
 *   - wires the socket's outbound path into store.send
 *   - feeds inbound frames into store.applyRemote
 *   - announces presence:join on open
 *   - auto-reconnects with a small backoff and reports status to the UI
 *
 * All conflict-resolution logic lives in the store/merge module, never here.
 */

import { parseMessage } from '@shared/protocol';
import type { BoardStore } from './store';

export type ConnStatus = 'connecting' | 'open' | 'closed';

// Production pages are served over HTTPS, where the localhost fallback is
// blocked as mixed content. Say so loudly rather than leaving a dead board.
function resolveWsBase(): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return configured;
  if (import.meta.env.PROD) {
    console.error(
      '[whiteboard] VITE_WS_URL is unset. Set it to your wss:// server URL in the ' +
        'Vercel project env vars and redeploy — falling back to localhost, which ' +
        'an HTTPS page will refuse to connect to.',
    );
  }
  return 'ws://localhost:8080';
}

const WS_BASE = resolveWsBase();

export interface Connection {
  close(): void;
}

export function connect(
  store: BoardStore,
  roomId: string,
  onStatus: (s: ConnStatus) => void,
): Connection {
  let socket: WebSocket | null = null;
  let closedByUs = false;
  let backoff = 500;

  const url = `${WS_BASE}/?room=${encodeURIComponent(roomId)}&clientId=${encodeURIComponent(store.clientId)}`;

  const open = () => {
    onStatus('connecting');
    socket = new WebSocket(url);

    // outbound: let the store push messages through this socket
    store.send = (msg) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(msg));
      }
    };

    socket.onopen = () => {
      backoff = 500;
      onStatus('open');
      // Announce ourselves so peers learn our name + color.
      store.send({
        type: 'presence:join',
        senderId: store.clientId,
        lamport: 0,
        payload: {
          clientId: store.clientId,
          name: store.name,
          color: store.color,
        },
      });
    };

    socket.onmessage = (ev) => {
      const msg = parseMessage(typeof ev.data === 'string' ? ev.data : '');
      if (msg) store.applyRemote(msg);
    };

    socket.onclose = () => {
      onStatus('closed');
      if (!closedByUs) {
        setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, 5000);
      }
    };

    socket.onerror = () => socket?.close();
  };

  open();

  return {
    close() {
      closedByUs = true;
      socket?.close();
    },
  };
}
