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

/** Schedule the invocation controller's retained drain and track its settlement. */
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
  const ownsRoot = controller.executionScope === services.invocationScope;
  const committed = ownsRoot
    ? services.commit(outcome === "timeout" ? "cancelled" : outcome)
    : Promise.resolve();
  if (ownsRoot) services.evidence.trackNamedLifecycle(committed);

  const task = {
    async run() {
      try {
        const result = skipsInlineDrain(outcome)
          ? skipInlineCallbacks(services, registrations, close)
          : await drainInlineCallbacks(controller, registrations, {
              concurrency: services.limits.concurrency,
              maxDrainMs: services.limits.maxDrainMs,
              durableFinalization: services.durableFinalization,
              abortController: services.abortController,
              evidence: services.evidence,
              close,
            });
        if (ownsRoot) services.evidence.settle(result);
        else services.evidence.recordDrain(result);
        await runDrainSettledHooks(drainSettledHooks, result);
        settlement.resolve(result);
        if (ownsRoot) {
          await services.evidence.waitForClosure();
          await flushObservability(services);
        }
      } finally {
        retained.resolve(undefined);
      }
    },
    cancel: services.cancel,
  };
  if (ownsRoot) services.schedule(task);
  else {
    void task.run().catch((error: unknown) => {
      console.error(
        "[crux] inner-scope deferred work escaped its contained drain.",
        error,
      );
    });
  }
  controller.executionScope.trackPending(retained.promise);
  return Object.freeze({ committed, settled: settlement.promise });
}

function skipsInlineDrain(outcome: ScopeCloseOutcome): boolean {
  return (
    outcome === "error" || outcome === "cancelled" || outcome === "timeout"
  );
}

function skipInlineCallbacks(
  services: InvocationDeferServices,
  registrations: readonly InlineRegistration[],
  close: () => void,
): DeferredDrainResult {
  for (const registration of registrations) {
    services.evidence.skipInline(registration.observation);
  }
  close();
  return {
    callbacks: registrations.map(({ sequence }) => ({
      sequence,
      outcome: "cancelled" as const,
      skipReason: "scope-outcome" as const,
    })),
    timedOut: false,
    cancelled: true,
  };
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
        services.limits.maxDrainMs,
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
