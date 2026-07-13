import type { DeferScheduledTask } from "../host-types";

interface RegistryEntry {
  state: "waiting" | "running";
  readonly cancelWaiting: (reason: unknown) => void;
  task?: DeferScheduledTask;
}

/** Per-host registry for response-bound and running Node callback drains. */
export class NodeDeferRegistry {
  private readonly entries = new Set<RegistryEntry>();
  private readonly changeWaiters = new Set<() => void>();
  private shutdownPromise:
    | Promise<{
        readonly completed: boolean;
        readonly pending: number;
      }>
    | undefined;
  private shuttingDown = false;

  constructor(private readonly shutdownDrainMs: number) {}

  addWaiting(cancelWaiting: (reason: unknown) => void): RegistryEntry {
    const entry: RegistryEntry = { state: "waiting", cancelWaiting };
    if (this.shuttingDown) {
      cancelWaiting(new Error("The Node defer host is already shut down."));
      return entry;
    }
    this.entries.add(entry);
    this.notifyChange();
    return entry;
  }

  start(entry: RegistryEntry, task: DeferScheduledTask): void {
    if (!this.entries.has(entry)) {
      task.cancel(new Error("The Node defer host is already shut down."));
      return;
    }
    entry.state = "running";
    entry.task = task;

    let running: Promise<void>;
    try {
      running = task.run();
    } catch (error) {
      running = Promise.reject(error);
    }
    void running
      .catch(() => undefined)
      .finally(() => {
        this.remove(entry);
      });
  }

  shutdown(): Promise<{
    readonly completed: boolean;
    readonly pending: number;
  }> {
    this.shuttingDown = true;
    this.shutdownPromise ??= this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<{
    readonly completed: boolean;
    readonly pending: number;
  }> {
    if (this.entries.size === 0) return { completed: true, pending: 0 };

    const deadlineToken = Symbol("node.defer.shutdown-deadline");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<typeof deadlineToken>((resolve) => {
      timeout = setTimeout(() => resolve(deadlineToken), this.shutdownDrainMs);
    });

    while (this.entries.size > 0) {
      const result = await Promise.race([
        this.waitForChange().then(() => undefined),
        deadline,
      ]);
      if (result !== deadlineToken) continue;

      const reason = new Error("Node defer shutdown deadline exceeded.");
      let pending = 0;
      for (const entry of [...this.entries]) {
        if (entry.state === "waiting") {
          entry.cancelWaiting(reason);
          this.remove(entry);
          continue;
        }
        pending += 1;
        entry.task?.cancel(reason);
      }
      await Promise.resolve();
      await Promise.resolve();
      return { completed: pending === 0, pending };
    }

    if (timeout) clearTimeout(timeout);
    return { completed: true, pending: 0 };
  }

  private remove(entry: RegistryEntry): void {
    if (!this.entries.delete(entry)) return;
    this.notifyChange();
  }

  private waitForChange(): Promise<void> {
    return new Promise((resolve) => {
      this.changeWaiters.add(resolve);
    });
  }

  private notifyChange(): void {
    for (const resolve of this.changeWaiters) resolve();
    this.changeWaiters.clear();
  }
}

export type NodeDeferRegistryEntry = RegistryEntry;
