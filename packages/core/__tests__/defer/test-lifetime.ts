import type {
  DeferInvocationOutcome,
  DeferLifetimeCapability,
  DeferScheduledTask,
} from "@use-crux/core/internal/scope";
import { openScope } from "@use-crux/core/internal/scope";
import {
  createScopeDeferController,
  type DeferredDrainHandle,
  type ScopeDeferController,
} from "../../src/defer/internal/invocation-scope";
import { createInvocationDeferServices } from "../../src/defer/internal/invocation-services";

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

/** Open a real invocation scope and expose deterministic sealing for tests. */
export function createTestScopeDeferController(
  lifetime: DeferLifetimeCapability,
): ScopeDeferController & {
  seal(outcome: DeferInvocationOutcome): DeferredDrainHandle;
} {
  const scope = openScope({ kind: "invocation" }, {});
  const services = createInvocationDeferServices(scope.scope, lifetime);
  const controller = createScopeDeferController(scope.scope, services);

  return Object.freeze({
    ...controller,
    seal(outcome): DeferredDrainHandle {
      scope.seal(outcome);
      return controller.getDrainHandle();
    },
  });
}
