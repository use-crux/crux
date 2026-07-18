import type { RootPendingTracker } from "./pending";
import type { CruxHostBinding, ScopeRetainedTask } from "./types";

interface QueuedRetainedTask {
  readonly task: ScopeRetainedTask;
  readonly settle: () => void;
  started: boolean;
}

interface RetentionFailure {
  readonly error: unknown;
}

/** Functional gate joining platform completion with the live root pending set. */
export interface RootRetentionGate {
  enqueueTask(task: ScopeRetainedTask): void;
  noteFirstPending(): void;
}

/** Create the at-most-once retention gate for one binding-opened root. */
export function createRootRetentionGate(
  binding: CruxHostBinding,
  pending: RootPendingTracker,
): RootRetentionGate {
  const queued: QueuedRetainedTask[] = [];
  let retained = false;
  let started = false;
  let failure: RetentionFailure | undefined;

  const start = (entry: QueuedRetainedTask): void => {
    if (entry.started) return;
    entry.started = true;
    let running: Promise<void>;
    try {
      running = entry.task.run();
    } catch (error) {
      running = Promise.reject(error);
    }
    void running.then(entry.settle, entry.settle);
  };

  const retainOnce = (): void => {
    if (failure) throw failure.error;
    if (retained) return;
    retained = true;
    try {
      binding.retain(async () => {
        started = true;
        for (const entry of queued) start(entry);
        await pending.whenIdle();
      });
    } catch (error) {
      failure = Object.freeze({ error });
      throw error;
    }
  };

  return Object.freeze({
    enqueueTask(task): void {
      let settleGate: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        settleGate = resolve;
      });
      const entry: QueuedRetainedTask = {
        task,
        settle: () => settleGate?.(),
        started: false,
      };
      queued.push(entry);
      pending.track(gate);
      try {
        retainOnce();
      } catch {
        // The scope kernel re-observes and propagates this acceptance failure
        // when it tracks the defer close hook's returned settlement.
      }
      if (started) start(entry);
    },
    noteFirstPending: retainOnce,
  } satisfies RootRetentionGate);
}
