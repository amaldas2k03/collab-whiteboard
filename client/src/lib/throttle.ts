/**
 * throttle.ts — trailing-edge throttle used to cap the rate of high-frequency
 * outbound messages (cursor moves, live drag updates) sent over the socket.
 */

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  /**
   * Drop a trailing call that hasn't fired yet. Callers that follow a throttled
   * stream with an authoritative final write (drag-move → drag-end) need this:
   * otherwise the queued call lands *after* the final one and re-applies a
   * position the user has already moved past.
   */
  cancel(): void;
}

export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): Throttled<A> {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const throttled = (...args: A) => {
    const now = Date.now();
    const remaining = waitMs - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else {
      // remember the most recent args and fire once the window elapses
      pending = args;
      if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          if (pending) fn(...pending);
          pending = null;
        }, remaining);
      }
    }
  };

  throttled.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  return throttled;
}
