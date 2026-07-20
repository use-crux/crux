/** Functional interface for a live root pending set. */
export interface RootPendingTracker {
  track(operation: PromiseLike<unknown>): void;
  whenIdle(): Promise<void>;
}

/** Create a drain-to-empty pending tracker with closure-owned state. */
export function createRootPendingTracker(): RootPendingTracker {
  const operations = new Set<Promise<unknown>>();
  const idleWaiters = new Set<() => void>();
  let idleCheckScheduled = false;

  const scheduleIdleCheck = (): void => {
    if (idleCheckScheduled) return;
    idleCheckScheduled = true;
    queueMicrotask(() => {
      idleCheckScheduled = false;
      if (operations.size > 0) return;
      const waiters = [...idleWaiters];
      idleWaiters.clear();
      for (const resolve of waiters) resolve();
    });
  };

  const settle = (operation: Promise<unknown>): void => {
    operations.delete(operation);
    scheduleIdleCheck();
  };

  return Object.freeze({
    /** Track an operation until it settles, without surfacing its rejection. */
    track(operation: PromiseLike<unknown>): void {
      const tracked = Promise.resolve(operation);
      operations.add(tracked);
      void tracked.then(
        () => settle(tracked),
        () => settle(tracked),
      );
    },

    /** Resolve after the set remains empty through one microtask re-check. */
    whenIdle(): Promise<void> {
      return new Promise((resolve) => {
        idleWaiters.add(resolve);
        scheduleIdleCheck();
      });
    },
  });
}
