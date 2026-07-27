/** Deterministic effect boundary for Eval cell-deadline tests. */
export function createDeadlineClock() {
  let now = 0;
  let nextHandle = 0;
  const timers = new Map<
    number,
    { readonly at: number; readonly callback: () => void }
  >();
  return {
    now: () => now,
    setTimer(callback: () => void, delayMs: number) {
      const handle = nextHandle++;
      timers.set(handle, { at: now + delayMs, callback });
      return handle;
    },
    clearTimer(handle: unknown) {
      if (typeof handle === "number") timers.delete(handle);
    },
    advance(durationMs: number) {
      now += durationMs;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now)
        .sort(([, left], [, right]) => left.at - right.at);
      for (const [handle, timer] of due) {
        timers.delete(handle);
        timer.callback();
      }
    },
    pendingTimers: () => timers.size,
  };
}
