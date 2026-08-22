/**
 * App.tsx — top-level wiring.
 *
 *   - resolves the room code from the URL (?room=CODE), generating one if absent
 *   - creates the BoardStore + opens the WebSocket connection once
 *   - subscribes React to the store via useSyncExternalStore
 *   - hosts the top bar (room link, presence, connection status) and the canvas
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BoardStore } from './lib/store';
import { connect, type ConnStatus } from './lib/connection';
import { createIdentity } from './lib/identity';
import { Toolbar } from './components/Toolbar';
import { Canvas } from './components/Canvas';
import type { Tool } from './lib/tools';

/** Read ?room= from the URL, or mint a short code and put it in the URL. */
function useRoomId(): string {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    let room = params.get('room');
    if (!room) {
      room = Math.random().toString(36).slice(2, 8);
      params.set('room', room);
      const url = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, '', url);
    }
    return room;
  }, []);
}

export function App() {
  const roomId = useRoomId();
  const identity = useMemo(() => createIdentity(), []);
  const store = useMemo(
    () => new BoardStore(identity.clientId, identity.name, identity.color),
    [identity],
  );

  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // Open the socket for this store; the cleanup closes it. This is
  // StrictMode-safe: a dev-mode unmount/remount closes conn1 and opens conn2.
  useEffect(() => {
    const conn = connect(store, roomId, setStatus);
    return () => conn.close();
  }, [store, roomId]);

  // Delete key removes the current selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        // don't hijack typing in inputs (none here, but be safe)
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        store.deleteShape(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, store]);

  const shareLink = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the link is visible in the URL bar anyway */
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          Collab Whiteboard
        </div>

        <div className="room-info">
          <span className="room-label">Room</span>
          <code className="room-code">{roomId}</code>
          <button className="copy-btn" onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>
        </div>

        <div className="presence">
          <span className={`status status-${status}`}>{status}</span>
          <UserChip name={identity.name} color={identity.color} you />
          {snapshot.presence.map((p) => (
            <UserChip key={p.clientId} name={p.name} color={p.color} />
          ))}
        </div>
      </header>

      <div className="workspace">
        <Toolbar
          tool={tool}
          onToolChange={setTool}
          onDelete={() => {
            if (selectedId) {
              store.deleteShape(selectedId);
              setSelectedId(null);
            }
          }}
          hasSelection={!!selectedId}
        />
        <Canvas
          store={store}
          tool={tool}
          snapshot={snapshot}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </div>
  );
}

function UserChip({
  name,
  color,
  you = false,
}: {
  name: string;
  color: string;
  you?: boolean;
}) {
  return (
    <span className="user-chip" title={name}>
      <span className="user-dot" style={{ background: color }} />
      {name}
      {you && <span className="you-tag">you</span>}
    </span>
  );
}
