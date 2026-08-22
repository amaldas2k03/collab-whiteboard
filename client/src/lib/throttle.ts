/**
 * throttle.ts — trailing-edge throttle used to cap the rate of high-frequency
 * outbound messages (cursor moves, live drag updates) sent over the socket.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): (...args: A) => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  return (...args: A) => {
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
}
