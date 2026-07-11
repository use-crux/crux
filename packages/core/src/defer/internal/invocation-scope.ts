import type {
  DeferInvocationOutcome,
  DeferLifetimeCapability,
} from "../host-types";
import type { DeferredCallback } from "../types";
import { createDeferError } from "../errors";
import {
  captureAsyncScope,
  type CapturedAsyncScope,
} from "../../async-scope/internal/carrier";
import {
  type DeferRegistrationContext,
  type DeferRegistrationScope,
} from "./context";
import { drainInlineCallbacks } from "./drain";

type InvocationState = "open" | "sealed";
type DeferredCallbackOutcome =
  | "completed"
  | "failed"
  | "timed-out"
  | "cancelled";

export interface InlineRegistration {
  readonly sequence: number;
  readonly depth: number;
  readonly callback: DeferredCallback;
  readonly capturedScope: CapturedAsyncScope;
}

type CommitOperationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown };

/** Result retained internally for shutdown, tests, and later diagnostics. */
export interface DeferredDrainResult {
  readonly callbacks: readonly {
    readonly sequence: number;
    readonly outcome: DeferredCallbackOutcome;
  }[];
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

/** Internal barriers created when an invocation is sealed. */
export interface DeferredDrainHandle {
  readonly committed: Promise<void>;
  readonly settled: Promise<DeferredDrainResult>;
}

/** Package-private invocation state machine. */
export interface InvocationDeferScope extends DeferRegistrationScope {
  /** Cooperative signal aborted when bounded drain settlement stops waiting. */
  readonly signal: AbortSignal;
  /** Stop waiting for callback settlement during shutdown or host cancellation. */
  cancel(reason?: unknown): void;
  seal(outcome: DeferInvocationOutcome): DeferredDrainHandle;
}

/** Create one invocation-scoped deferred-work kernel. */
export function createInvocationDeferScope(
  lifetime: DeferLifetimeCapability,
): InvocationDeferScope {
  let state: InvocationState = "open";
  let drainClosed = false;
  let handle: DeferredDrainHandle | undefined;
  const registrations: InlineRegistration[] = [];
  const commitOperations: Array<Promise<CommitOperationResult>> = [];
  const abortController = new AbortController();

  const scope: InvocationDeferScope = {
    signal: abortController.signal,
    cancel(reason) {
      abortController.abort(
        reason ?? new Error("Deferred callback drain was cancelled."),
      );
    },
    registerInline(callback, registration) {
      if ((state !== "open" && registration.phase !== "drain") || drainClosed) {
        throw createDeferError({
          code: "DEFER_SCOPE_SEALED",
          message:
            "defer() cannot register work after its invocation was sealed.",
        });
      }
      if (registrations.length >= lifetime.limits.maxCallbacks) {
        throw createDeferError({
          code: "DEFER_LIMIT_EXCEEDED",
          message: `defer() exceeded the host callback limit of ${lifetime.limits.maxCallbacks}.`,
        });
      }
      if (
        registration.phase === "drain" &&
        registration.depth > lifetime.limits.maxNestingDepth
      ) {
        throw createDeferError({
          code: "DEFER_LIMIT_EXCEEDED",
          message: `defer() exceeded the host nesting limit of ${lifetime.limits.maxNestingDepth}.`,
        });
      }
      registrations.push({
        sequence: registrations.length,
        depth: registration.depth,
        callback,
        capturedScope: captureAsyncScope(),
      });
    },
    trackCommit(operation) {
      if (state !== "open") {
        throw createDeferError({
          code: "DEFER_SCOPE_SEALED",
          message: "defer() cannot track durable acceptance after sealing.",
        });
      }
      commitOperations.push(
        Promise.resolve(operation).then<
          CommitOperationResult,
          CommitOperationResult
        >(
          () => ({ ok: true }),
          (error: unknown) => ({ ok: false, error }),
        ),
      );
    },
    seal(outcome) {
      void outcome;
      if (handle) return handle;
      state = "sealed";

      const settlement = deferred<DeferredDrainResult>();
      handle = {
        committed: settleCommitOperations(commitOperations),
        settled: settlement.promise,
      };
      lifetime.schedule({
        async run() {
          settlement.resolve(
            await drainInlineCallbacks(scope, registrations, {
              concurrency: lifetime.limits.concurrency,
              maxDrainMs: lifetime.limits.maxDrainMs,
              abortController,
              close: () => {
                drainClosed = true;
              },
            }),
          );
        },
        cancel(reason) {
          scope.cancel(reason);
        },
      });
      return handle;
    },
  };

  return scope;
}

async function settleCommitOperations(
  operations: readonly Promise<CommitOperationResult>[],
): Promise<void> {
  const results = await Promise.all(operations);
  const failure = results.find(
    (
      result,
    ): result is Extract<CommitOperationResult, { readonly ok: false }> =>
      !result.ok,
  );
  if (failure) throw failure.error;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}
