import type { DeferLifetimeCapability } from "../host-types";
import { executeDeferredCallback } from "./callback-boundary";
import type {
  DeferredDrainResult,
  InlineRegistration,
  ScopeDeferController,
} from "./invocation-scope";
import type { DeferScopeObservability } from "./observability";

interface DrainInlineCallbacksOptions {
  readonly concurrency: number;
  readonly maxDrainMs: number;
  readonly lifetime: DeferLifetimeCapability;
  readonly abortController: AbortController;
  readonly evidence: DeferScopeObservability;
  readonly close: () => void;
}

/** Drain accepted callbacks through a bounded, all-settled worker pool. */
export async function drainInlineCallbacks(
  scope: ScopeDeferController,
  registrations: InlineRegistration[],
  options: DrainInlineCallbacksOptions,
): Promise<DeferredDrainResult> {
  const outcomes = new Map<
    number,
    { readonly outcome: "completed" | "failed"; readonly error?: unknown }
  >();
  let nextIndex = 0;
  let closed = false;

  async function worker(): Promise<void> {
    while (!closed && nextIndex < registrations.length) {
      const index = nextIndex;
      nextIndex += 1;
      const registration = registrations[index];
      if (!registration) continue;

      try {
        await options.evidence.runInline(registration.observation, () =>
          executeDeferredCallback(scope, registration, options.lifetime),
        );
        if (!closed) {
          outcomes.set(registration.sequence, { outcome: "completed" });
        }
      } catch (error) {
        if (!closed) {
          outcomes.set(registration.sequence, { outcome: "failed", error });
        }
      }
    }
  }

  const workers = Promise.all(
    Array.from({ length: Math.max(1, Math.floor(options.concurrency)) }, () =>
      worker(),
    ),
  ).then(() => "settled" as const);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timed-out">((resolve) => {
    timeout = setTimeout(() => resolve("timed-out"), options.maxDrainMs);
  });
  let removeCancellationListener = () => {};
  const cancellation = new Promise<"cancelled">((resolve) => {
    const cancel = () => resolve("cancelled");
    if (options.abortController.signal.aborted) {
      cancel();
      return;
    }
    options.abortController.signal.addEventListener("abort", cancel, {
      once: true,
    });
    removeCancellationListener = () => {
      options.abortController.signal.removeEventListener("abort", cancel);
    };
  });

  const ending = await Promise.race([workers, deadline, cancellation]);
  closed = true;
  options.close();
  if (timeout) clearTimeout(timeout);
  removeCancellationListener();
  if (ending === "timed-out") {
    options.abortController.abort(
      new Error("Deferred callback drain exceeded its host deadline."),
    );
  }

  return {
    callbacks: registrations.map((registration) => {
      const result = outcomes.get(registration.sequence);
      return {
        sequence: registration.sequence,
        ...(result ?? {
          outcome: ending === "timed-out" ? "timed-out" : "cancelled",
        }),
      };
    }),
    timedOut: ending === "timed-out",
    cancelled: ending === "cancelled",
  };
}
