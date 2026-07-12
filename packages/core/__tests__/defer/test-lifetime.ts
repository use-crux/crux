import type {
  DeferLifetimeCapability,
  DeferScheduledTask,
} from "@use-crux/core/internal/defer-host";

/** Create a conservative deterministic lifetime capability for defer tests. */
export function testLifetime(
  schedule: (run: () => Promise<void>, task: DeferScheduledTask) => void,
  limits: Partial<DeferLifetimeCapability["limits"]> = {},
): DeferLifetimeCapability {
  return {
    completion: "handler-returned",
    limits: {
      maxDrainMs: 1_000,
      maxCallbacks: 10,
      concurrency: 1,
      maxNestingDepth: 3,
      ...limits,
    },
    supportsInline: true,
    durableFinalization: false,
    schedule(task) {
      schedule(() => task.run(), task);
    },
  };
}
