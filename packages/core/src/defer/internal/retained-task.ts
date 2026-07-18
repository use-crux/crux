import { observe } from "../../observability";
import type { ScopeCloseOutcome } from "../../scope/contracts";
import { drainInlineCallbacks } from "./drain";
import type { InvocationDeferServices } from "./invocation-services";
import type {
  DeferredDrainHandle,
  DeferredDrainResult,
  InlineRegistration,
  ScopeDeferController,
} from "./invocation-scope";

const DEFER_OBSERVABILITY_FLUSH_TIMEOUT_MS = 3_000;

/** Schedule the invocation controller's retained drain and track its lifetime. */
export function scheduleInvocationDeferDrain(
  controller: ScopeDeferController,
  services: InvocationDeferServices,
  registrations: InlineRegistration[],
  drainSettledHooks: readonly ((
    result: DeferredDrainResult,
  ) => void | PromiseLike<void>)[],
  close: () => void,
  outcome: ScopeCloseOutcome,
): DeferredDrainHandle {
  const settlement = deferred<DeferredDrainResult>();
  const retained = deferred<void>();
  const committed = services.commit(
    outcome === "timeout" ? "cancelled" : outcome,
  );
  services.evidence.trackNamedLifecycle(committed);

  services.lifetime.schedule({
    async run() {
      try {
        const result = await drainInlineCallbacks(controller, registrations, {
          concurrency: services.lifetime.limits.concurrency,
          maxDrainMs: services.lifetime.limits.maxDrainMs,
          lifetime: services.lifetime,
          abortController: services.abortController,
          evidence: services.evidence,
          close,
        });
        services.evidence.settle(result);
        await runDrainSettledHooks(drainSettledHooks, result);
        settlement.resolve(result);
        await services.evidence.waitForClosure();
        await flushObservability(services);
      } finally {
        retained.resolve(undefined);
      }
    },
    cancel: services.cancel,
  });
  controller.executionScope.trackPending(retained.promise);
  return Object.freeze({ committed, settled: settlement.promise });
}

async function runDrainSettledHooks(
  hooks: readonly ((result: DeferredDrainResult) => void | PromiseLike<void>)[],
  result: DeferredDrainResult,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook(result);
    } catch (error) {
      console.error(
        "[crux] an internal drain-settled hook threw; deferred callback outcomes were preserved.",
        error,
      );
    }
  }
}

async function flushObservability(
  services: InvocationDeferServices,
): Promise<void> {
  try {
    await observe.flush({
      timeoutMs: Math.min(
        services.lifetime.limits.maxDrainMs,
        DEFER_OBSERVABILITY_FLUSH_TIMEOUT_MS,
      ),
    });
  } catch (error) {
    console.error(
      "[crux] observability flush threw after deferred work settled; the deferred callback outcome was preserved.",
      error,
    );
  }
}

function deferred<T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}
