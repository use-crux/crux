interface RegistryEntry {
  state: "waiting" | "running";
  readonly cancel: (reason: unknown) => void;
}

/** Closure-owned registry for response-bound and running Node drains. */
export interface NodeDeferRegistry {
  addWaiting(cancel: (reason: unknown) => void): NodeDeferRegistryEntry;
  start(entry: NodeDeferRegistryEntry, work: () => Promise<void>): void;
  shutdown(): Promise<{
    readonly completed: boolean;
    readonly pending: number;
  }>;
}

/** Create an isolated Node drain registry with bounded shutdown. */
export function createNodeDeferRegistry(
  shutdownDrainMs: number,
): NodeDeferRegistry {
  const entries = new Set<RegistryEntry>();
  const changeWaiters = new Set<() => void>();
  let shutdownPromise:
    | Promise<{ readonly completed: boolean; readonly pending: number }>
    | undefined;
  let shuttingDown = false;

  const notifyChange = (): void => {
    for (const resolve of changeWaiters) resolve();
    changeWaiters.clear();
  };

  const remove = (entry: RegistryEntry): void => {
    if (!entries.delete(entry)) return;
    notifyChange();
  };

  const waitForChange = (): Promise<void> =>
    new Promise((resolve) => {
      changeWaiters.add(resolve);
    });

  const performShutdown = async (): Promise<{
    readonly completed: boolean;
    readonly pending: number;
  }> => {
    if (entries.size === 0) return { completed: true, pending: 0 };

    const deadlineToken = Symbol("node.defer.shutdown-deadline");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof deadlineToken>((resolve) => {
      timeout = setTimeout(() => resolve(deadlineToken), shutdownDrainMs);
    });

    while (entries.size > 0) {
      const result = await Promise.race([
        waitForChange().then(() => undefined),
        deadline,
      ]);
      if (result !== deadlineToken) continue;

      const reason = new Error("Node defer shutdown deadline exceeded.");
      let pending = 0;
      for (const entry of [...entries]) {
        entry.cancel(reason);
        if (entry.state === "waiting") {
          remove(entry);
        } else {
          pending += 1;
        }
      }
      await Promise.resolve();
      await Promise.resolve();
      return { completed: pending === 0, pending };
    }

    if (timeout) clearTimeout(timeout);
    return { completed: true, pending: 0 };
  };

  return Object.freeze({
    addWaiting(cancel): RegistryEntry {
      const entry: RegistryEntry = { state: "waiting", cancel };
      if (shuttingDown) {
        cancel(new Error("The Node defer host is already shut down."));
        return entry;
      }
      entries.add(entry);
      notifyChange();
      return entry;
    },
    start(entry, work): void {
      if (!entries.has(entry)) return;
      entry.state = "running";
      let running: Promise<void>;
      try {
        running = work();
      } catch (error) {
        running = Promise.reject(error);
      }
      void running.catch(() => undefined).finally(() => remove(entry));
    },
    shutdown(): Promise<{
      readonly completed: boolean;
      readonly pending: number;
    }> {
      shuttingDown = true;
      shutdownPromise ??= performShutdown();
      return shutdownPromise;
    },
  } satisfies NodeDeferRegistry);
}

export type NodeDeferRegistryEntry = RegistryEntry;
