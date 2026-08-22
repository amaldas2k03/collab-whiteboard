/**
 * lamport.ts — a minimal Lamport logical clock.
 *
 * A Lamport clock gives every replica (each client AND the server) a way to
 * order events without a shared physical wall-clock. The rules are only two:
 *
 *   1. Before producing a local event, increment the counter.
 *   2. On receiving a remote event stamped `t`, set counter = max(counter, t),
 *      then increment.
 *
 * The resulting timestamps define a total-ish order that, combined with a
 * clientId tie-breaker (see merge.ts), lets every replica agree on which of two
 * concurrent edits "wins" — independently of network delivery order.
 */
export class LamportClock {
  private counter = 0;

  /** Current value without advancing. */
  get value(): number {
    return this.counter;
  }

  /** Rule 1: advance for a locally-produced event and return the new stamp. */
  tick(): number {
    this.counter += 1;
    return this.counter;
  }

  /** Rule 2: fold in a received remote stamp, keeping our clock ahead of it. */
  update(remote: number): number {
    this.counter = Math.max(this.counter, remote) + 1;
    return this.counter;
  }
}
