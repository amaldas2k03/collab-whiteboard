/**
 * App.tsx — top-level wiring.
 *
 *   - resolves the room code from the URL (?room=CODE), generating one if absent
 *   - creates the BoardStore + opens the WebSocket connection once
 *   - subscribes React to the store via useSyncExternalStore
 *   - owns the pieces of UI state that several panels share: active tool,
 *     selection, the current draw style, grid visibility
 *   - hosts the top bar, the toolbar, the style panel and the canvas
 *
 * The viewport (pan/zoom) deliberately lives inside Canvas; App reaches it only
 * through the small imperative `CanvasApi` so that panning never re-renders the
 * whole app.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { BoardStore } from './lib/store';
import { connect, type ConnStatus } from './lib/connection';
import { createIdentity } from './lib/identity';
import { Toolbar } from './components/Toolbar';
import { StylePanel } from './components/StylePanel';
import { Shortcuts } from './components/Shortcuts';
import { Canvas, type CanvasApi } from './components/Canvas';
import { TOOLS, INITIAL_DRAW_STYLE, type DrawStyle, type Tool } from './lib/tools';

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

/** True when the keyboard event came from a field the user is typing into. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
  );
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
  const [draw, setDraw] = useState<DrawStyle>(INITIAL_DRAW_STYLE);
  const [showGrid, setShowGrid] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [copied, setCopied] = useState(false);

  const canvasApi = useRef<CanvasApi | null>(null);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const selected = useMemo(
    () => snapshot.shapes.find((s) => s.id === selectedId) ?? null,
    [snapshot.shapes, selectedId],
  );

  // Open the socket for this store; the cleanup closes it. This is
  // StrictMode-safe: a dev-mode unmount/remount closes conn1 and opens conn2.
  useEffect(() => {
    const conn = connect(store, roomId, setStatus);
    return () => conn.close();
  }, [store, roomId]);

  // Drop a stale selection when the shape disappears (erased, or deleted by a
  // collaborator) so the toolbar's selection actions can't act on a ghost.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const deleteSelection = useCallback(() => {
    if (!selectedId) return;
    store.deleteShape(selectedId);
    setSelectedId(null);
  }, [selectedId, store]);

  const duplicateSelection = useCallback(() => {
    if (!selectedId) return;
    const id = store.duplicateShape(selectedId);
    if (id) setSelectedId(id);
  }, [selectedId, store]);

  const clearBoard = useCallback(() => {
    if (snapshot.shapes.length === 0) return;
    const ok = window.confirm(
      `Clear all ${snapshot.shapes.length} items from this board? Everyone in the room will see it emptied. You can undo with Ctrl+Z.`,
    );
    if (!ok) return;
    store.clearBoard();
    setSelectedId(null);
  }, [snapshot.shapes.length, store]);

  // --- global shortcuts -----------------------------------------------------
  // Viewport keys (zoom, space-to-pan) are handled inside Canvas, which owns
  // the viewport. Everything else lands here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod) return; // leave every other browser shortcut alone

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        setSelectedId(null);
        setTool('select');
        setShowHelp(false);
        return;
      }
      if (e.key === ']' && selectedId) {
        store.bringToFront(selectedId);
        return;
      }
      if (e.key === '[' && selectedId) {
        store.sendToBack(selectedId);
        return;
      }
      if (e.key === '?') {
        setShowHelp((v) => !v);
        return;
      }
      if (e.key.toLowerCase() === 'g') {
        setShowGrid((v) => !v);
        return;
      }

      const match = TOOLS.find((t) => t.key === e.key.toLowerCase());
      if (match) setTool(match.id);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelection, duplicateSelection, selectedId, store]);

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
          <button
            className={`ghost-btn ${showGrid ? 'on' : ''}`}
            title="Toggle the grid — G"
            onClick={() => setShowGrid((v) => !v)}
          >
            Grid
          </button>
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
          hasSelection={!!selected}
          onDelete={deleteSelection}
          onDuplicate={duplicateSelection}
          onBringToFront={() => selectedId && store.bringToFront(selectedId)}
          onSendToBack={() => selectedId && store.sendToBack(selectedId)}
          canUndo={snapshot.canUndo}
          canRedo={snapshot.canRedo}
          onUndo={() => store.undo()}
          onRedo={() => store.redo()}
          onExport={() => canvasApi.current?.exportPng()}
          onClear={clearBoard}
          onHelp={() => setShowHelp(true)}
        />

        <StylePanel
          draw={draw}
          onDrawChange={setDraw}
          selected={selected}
          onSelectedStyleChange={(patch) =>
            selectedId && store.updateStyle(selectedId, patch)
          }
        />

        <Canvas
          store={store}
          tool={tool}
          onToolChange={setTool}
          snapshot={snapshot}
          selectedId={selectedId}
          onSelect={setSelectedId}
          draw={draw}
          showGrid={showGrid}
          roomId={roomId}
          apiRef={canvasApi}
        />
      </div>

      {showHelp && <Shortcuts onClose={() => setShowHelp(false)} />}
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
