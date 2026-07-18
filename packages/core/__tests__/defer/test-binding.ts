import type {
  CruxHostBinding,
  DeferLifetimeLimits,
  DeferInvocationOutcome,
  ScopeRetainedTask,
} from "@use-crux/core/internal/scope";
import { bindRootRetention, openScope } from "@use-crux/core/internal/scope";
import {
  createScopeDeferController,
  type DeferredDrainHandle,
  type ScopeDeferController,
} from "../../src/defer/internal/invocation-scope";
import { createInvocationDeferServices } from "../../src/defer/internal/invocation-services";

type TestDeferBinding = CruxHostBinding & {
  readonly limits: DeferLifetimeLimits;
  readonly supportsInline: boolean;
  readonly durableFinalization: boolean;
};

const cancellationByBinding = new WeakMap<CruxHostBinding, AbortController>();

/** Create a conservative deterministic host binding for defer tests. */
export function testBinding(
  schedule: (run: () => Promise<void>, task: ScopeRetainedTask) => void,
  limits: Partial<DeferLifetimeLimits> = {},
): TestDeferBinding {
  const abortController = new AbortController();
  const binding = {
    kind: "test",
    invocationScope: false,
    limits: {
      maxDrainMs: 1_000,
      maxCallbacks: 10,
      concurrency: 1,
      maxNestingDepth: 3,
      ...limits,
    },
    supportsInline: true,
    durableFinalization: false,
    retain(work) {
      schedule(work, {
        run: work,
        cancel: (reason) => abortController.abort(reason),
      });
    },
  } satisfies TestDeferBinding;
  cancellationByBinding.set(binding, abortController);
  return binding;
}

/** Open a real invocation scope and expose deterministic sealing for tests. */
export function createTestScopeDeferController(
  binding: CruxHostBinding,
): ScopeDeferController & {
  seal(outcome: DeferInvocationOutcome): DeferredDrainHandle;
} {
  const scope = openScope({ kind: "invocation" }, {});
  bindRootRetention(scope.scope, binding);
  const services = createInvocationDeferServices(scope.scope, binding, {
    ...(cancellationByBinding.get(binding)
      ? { abortController: cancellationByBinding.get(binding) }
      : {}),
  });
  const controller = createScopeDeferController(scope.scope, services);

  return Object.freeze({
    ...controller,
    seal(outcome): DeferredDrainHandle {
      scope.seal(outcome);
      return controller.getDrainHandle();
    },
  });
}
