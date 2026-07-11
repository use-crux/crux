import { runWithDeferRegistration } from "./context";
import { runWithCapturedAsyncScope } from "../../async-scope/internal/carrier";
import type {
  DeferredDrainResult,
  InlineRegistration,
  InvocationDeferScope,
} from "./invocation-scope";

interface DrainInlineCallbacksOptions {
  readonly concurrency: number;
  readonly maxDrainMs: number;
  readonly abortController: AbortController;
  readonly close: () => void;
}

/** Drain accepted callbacks through a bounded, all-settled worker pool. */
export async function drainInlineCallbacks(
  scope: InvocationDeferScope,
  registrations: InlineRegistration[],
  options: DrainInlineCallbacksOptions,
): Promise<DeferredDrainResult> {
  const outcomes = new Map<number, "completed" | "failed">();
  let nextIndex = 0;
  let closed = false;

  async function worker(): Promise<void> {
    while (!closed && nextIndex < registrations.length) {
      const index = nextIndex;
      nextIndex += 1;
      const registration = registrations[index];
      if (!registration) continue;

      let outcome: "completed" | "failed" = "completed";
      try {
        await runWithCapturedAsyncScope(registration.capturedScope, () =>
          runWithDeferRegistration(
            { scope, phase: "drain", depth: registration.depth + 1 },
            registration.callback,
          ),
        );
      } catch {
        outcome = "failed";
      }
      if (!closed) outcomes.set(registration.sequence, outcome);
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
    callbacks: registrations.map((registration) => ({
      sequence: registration.sequence,
      outcome:
        outcomes.get(registration.sequence) ??
        (ending === "timed-out" ? "timed-out" : "cancelled"),
    })),
    timedOut: ending === "timed-out",
    cancelled: ending === "cancelled",
  };
}
