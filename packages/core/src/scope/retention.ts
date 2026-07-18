import type { RootPendingTracker } from "./pending";
import type { CruxHostBinding, ScopeRetainedTask } from "./types";

interface QueuedRetainedTask {
  readonly task: ScopeRetainedTask;
  readonly settle: () => void;
  started: boolean;
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
    if (retained) return;
    retained = true;
    binding.retain(async () => {
      started = true;
      for (const entry of queued) start(entry);
      await pending.whenIdle();
    });
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
      retainOnce();
      if (started) start(entry);
    },
    noteFirstPending: retainOnce,
  } satisfies RootRetentionGate);
}
