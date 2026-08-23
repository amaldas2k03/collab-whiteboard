# Collab Whiteboard

A real-time collaborative whiteboard. Multiple people join a room by link and
draw together — shapes, freehand strokes, and text sync live over WebSockets,
each person's cursor is visible to everyone, and concurrent edits to the same
shape are resolved **deterministically** using Lamport logical clocks (not
"last packet to arrive wins").

Built as a portfolio project to demonstrate a clean, explainable approach to
real-time collaboration and distributed conflict resolution.

- **Frontend:** React + TypeScript + [Konva](https://konvajs.org/) (`react-konva`)
- **Backend:** Node.js + TypeScript + [`ws`](https://github.com/websockets/ws) (raw WebSocket protocol, no Socket.io)
- **State:** in-memory on the server (`Map<roomId, Room>`); no database
- **Conflict resolution:** a Last-Writer-Wins Register CRDT keyed on Lamport timestamps, isolated in one shared module

> **Live demo:** _TODO — added after deployment_

---

## Screenshots

> _TODO: drop a screenshot / GIF here after recording. Suggested shots:_
> - _two browser windows side by side drawing in the same room_
> - _live cursors with name labels_
> - _the same shape being dragged from both windows (conflict resolution)_

---

## Architecture

The project is an npm-workspaces monorepo with three parts:

```
collab-whiteboard/
├── shared/          # protocol + conflict-resolution code imported by BOTH sides
│   ├── protocol.ts  #   wire message types + Shape/Presence data model
│   ├── lamport.ts   #   Lamport logical clock
│   └── merge.ts     #   THE conflict-resolution module (pure, isolated)
├── server/          # Node + ws WebSocket server
│   └── src/
│       ├── index.ts #   connection handling, routing, broadcast fan-out
│       └── room.ts  #   Room (authoritative state) + RoomManager
└── client/          # React + Konva SPA
    └── src/
        ├── lib/     #   store (client replica), connection, identity, tools
        └── components/  # Canvas, Toolbar
```

`shared/` is imported by both the client and the server via the `@shared/*`
path alias, so the two sides can never drift out of sync on message shapes — and,
crucially, **they run the exact same `merge.ts`**.

### Message flow

```
   Client A                       Server (Room)                    Client B
      │                               │                               │
      │  ── connect ?room=&clientId ─▶│                               │
      │  ◀──────── sync:full ─────────│  (full state — the ONLY       │
      │                               │   full-state message)         │
      │                               │                               │
      │  ── shape:update (lamport) ──▶│                               │
      │                          merge() into room state              │
      │                          (LWW by Lamport time)                │
      │                               │──── shape:update ────────────▶│
      │                               │                          merge() locally
      │                               │                               │
      │  ── cursor:move ─────────────▶│──── cursor:move ─────────────▶│
      │       (ephemeral, not merged, relayed to peers)               │
```

Every client is a **replica**: it keeps its own copy of the board and runs the
same merge function the server runs. The server is just the replica that new
clients sync from. Because the merge is order-independent (see below), all
replicas converge to identical state regardless of network timing.

Only `sync:full` (sent once, on join) ever carries whole-board state. Every
other message is a **delta**: create / update / delete a single shape, or a
cursor move.

---

## Conflict resolution (the important part)

**File to read:** [`shared/merge.ts`](shared/merge.ts) — it's pure functions,
no I/O, no WebSocket knowledge, so the strategy lives in one place.

### The problem

Two people drag the *same* rectangle at the *same* time. Both edits reach the
server. If we simply applied "whichever message the server received last," the
outcome would depend on network jitter — and different clients could end up
showing different final positions. That's non-deterministic and wrong.

### The strategy: LWW-Register keyed on Lamport time

Every shape carries a version stamp:

```ts
version = { lamport: number, clientId: string }
```

- Every edit (create/update/delete) **increments the editor's Lamport clock**
  and stamps the edit with the new value.
- On receiving a remote edit stamped `t`, a replica advances its own clock to
  `max(local, t) + 1`. (Standard Lamport clock rules.)

An incoming edit **wins** over the current shape iff:

```
incoming.lamport > current.lamport
   OR (incoming.lamport == current.lamport AND incoming.clientId > current.clientId)
```

The `clientId` comparison is an arbitrary-but-**stable** tiebreaker for truly
concurrent edits (same logical time). Because every replica uses the same rule,
they all pick the same winner.

### Why order doesn't matter

`compareVersion` defines a **total order** over versions, so "keep the version
with the maximum stamp" is:

- **commutative** — merge(a, b) == merge(b, a)
- **associative** — grouping doesn't matter
- **idempotent** — applying the same edit twice changes nothing

Applying the same set of edits in *any* order therefore yields the *same* final
state on every replica. That's the convergence guarantee of a **LWW-Register
CRDT**. It's why the server can broadcast deltas the instant it sees them and
never worry about ordering.

### Deletes use tombstones

A delete doesn't remove the shape — it sets a version-stamped `deleted: true`
tombstone. This way a late-arriving update can't "resurrect" a shape that was
concurrently deleted: the delete and the update compete by the same Lamport
rule, and whichever version is newer wins.

### Granularity

Conflict resolution is **whole-shape** (one version per shape). If A moves a
shape while B resizes it concurrently, the higher-Lamport edit wins entirely —
one of the two edits is dropped. This was a deliberate choice for
explainability; per-property LWW (letting the move and resize both survive) is a
natural extension.

---

## WebSocket protocol

All messages share an envelope and are discriminated on `type`:

```ts
{ type, senderId, lamport, payload }
```

| Type              | Direction | Payload                                   | Notes                              |
| ----------------- | --------- | ----------------------------------------- | ---------------------------------- |
| `sync:full`       | S → C     | `{ shapes: Shape[], users: Presence[] }`  | **Only** full-state msg; on join   |
| `presence:join`   | C → S → C | `{ clientId, name, color }`               | Announce self                      |
| `presence:leave`  | S → C     | `{ clientId }`                            | On disconnect                      |
| `shape:create`    | C → S → C | `{ shape: Shape }`                        | Delta                              |
| `shape:update`    | C → S → C | `{ id, changes, version }`                | Delta (partial patch)              |
| `shape:delete`    | C → S → C | `{ id, version }`                         | Tombstone stamp                    |
| `cursor:move`     | C → S → C | `{ clientId, x, y }`                      | Ephemeral, throttled, never merged |

Full definitions: [`shared/protocol.ts`](shared/protocol.ts).

---

## Running locally

**Prerequisites:** Node.js 20+.

```bash
# from the repo root
npm install
npm run dev
```

This starts both processes via `concurrently`:

- **client** (Vite) → http://localhost:3000
- **server** (ws)   → ws://localhost:8080

Open http://localhost:3000. A room code is generated and added to the URL. To
test collaboration, click **Copy invite link** and open it in a second browser
window (or share it with someone). Draw in one — it appears in the other, and
you'll see each other's live cursors.

### Run the pieces separately

```bash
npm run dev:server   # ws server only, on :8080
npm run dev:client   # Vite client only, on :3000
```

### Environment variables

| Var           | Side   | Default                 | Purpose                                        |
| ------------- | ------ | ----------------------- | ---------------------------------------------- |
| `VITE_WS_URL` | client | `ws://localhost:8080`   | WebSocket server URL the client connects to    |
| `WS_PORT`     | server | `8080`                  | Port the ws server binds to (used in dev)      |
| `PORT`        | server | falls back to `WS_PORT` | Provided by hosts (Render/Railway) in prod     |

---

## Features

**Core (done):**
- Shapes: rectangle, ellipse, straight line, freehand pen, text box
- Select, move, resize (rect/ellipse), delete
- Room-based sessions via shareable link (no auth)
- Live cursors with name + color labels
- New clients receive full state on join, deltas thereafter
- Deterministic conflict resolution (above)

**Not yet implemented (scoped out / stretch):**
- Undo/redo
- Persistence (board is in-memory; empties when the last person leaves)
- Styling controls (colors/stroke width) beyond per-shape defaults
- Offline edit + reconnect merge
- PNG/SVG export

---

## Tech decisions

- **Raw `ws`, not Socket.io** — to work directly with the WebSocket protocol and
  keep the message contract explicit and inspectable.
- **Konva for canvas** — gives shape hit-testing, dragging, and a resize
  transformer without hand-rolling canvas math.
- **In-memory state** — the scope is real-time collaboration and conflict
  resolution, not durability. Swapping in Redis/Postgres would be additive.
- **Shared `merge.ts` on both sides** — makes the client a true CRDT replica and
  keeps a single source of truth for the resolution logic.
