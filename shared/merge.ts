/**
 * merge.ts — THE conflict-resolution module.
 *
 * This is the one place that decides what happens when two clients edit the
 * same shape concurrently. It is deliberately isolated (pure functions, no I/O,
 * no WebSocket knowledge) so it can be unit-tested and pointed at directly.
 *
 * Strategy: a Last-Writer-Wins register, but "last" is defined by LOGICAL time
 * (Lamport timestamp), not by which packet the server received last.
 *
 *   winner = the version with the higher `lamport`
 *   tie    = the version with the higher `clientId` (lexicographic)
 *
 * Why this is correct regardless of message order:
 *   `compareVersion` is a *total order* over versions, so "take the max" is
 *   commutative, associative and idempotent. Applying the same set of ops in
 *   ANY order therefore yields the same final state on every replica. That is
 *   the convergence guarantee of a LWW-Register CRDT. The server and every
 *   client run this identical function, so they all converge.
 */

import type { Shape, ShapeChanges, Version } from './protocol';

/**
 * Total order over versions.
 *   returns > 0 if `a` is newer than `b`
 *   returns < 0 if `a` is older than `b`
 *   returns 0 only when a and b are the same version
 */
export function compareVersion(a: Version, b: Version): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport;
  // Same logical time (concurrent) => break the tie deterministically so every
  // replica picks the same winner. clientId comparison is arbitrary but stable.
  if (a.clientId === b.clientId) return 0;
  return a.clientId > b.clientId ? 1 : -1;
}

/** True if an edit stamped `incoming` should overwrite state stamped `current`. */
export function incomingWins(incoming: Version, current: Version): boolean {
  return compareVersion(incoming, current) > 0;
}

/**
 * Merge a create/replace of a whole shape into the current shape (or undefined
 * if we've never seen this id). Returns the shape that should now be stored.
 * Never mutates its inputs.
 */
export function mergeCreate(current: Shape | undefined, incoming: Shape): Shape {
  if (!current) return incoming;
  return incomingWins(incoming.version, current.version) ? incoming : current;
}

/**
 * Merge a partial update. `changes` is applied on top of the current shape only
 * if the update's version wins; otherwise the update is a no-op (stale edit).
 *
 * If we have never seen the shape (e.g. update arrived before its create), we
 * cannot safely materialise it from a partial patch, so we drop the update and
 * let the eventual create / next sync carry the truth. Returns the shape to
 * store, or `current` unchanged.
 */
export function mergeUpdate(
  current: Shape | undefined,
  id: string,
  changes: ShapeChanges,
  version: Version,
): Shape | undefined {
  if (!current) return undefined;
  if (!incomingWins(version, current.version)) return current;
  return { ...current, ...changes, id, version };
}

/**
 * Merge a delete. A delete is just a version-stamped write that sets the
 * tombstone flag, so it competes with concurrent updates by the same rule:
 * whichever version is newer wins. A newer update can therefore "un-delete"
 * only if its version is strictly newer than the delete's — which is exactly
 * the intended LWW behaviour.
 */
export function mergeDelete(
  current: Shape | undefined,
  version: Version,
): Shape | undefined {
  if (!current) return undefined;
  if (!incomingWins(version, current.version)) return current;
  return { ...current, deleted: true, version };
}
