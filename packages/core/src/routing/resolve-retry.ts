/**
 * Internal retry resolution used by {@link resolveModel}.
 *
 * Retry is a wrapper decision, so every success and terminal failure receives
 * a routing receipt step before the result or error leaves the resolver.
 *
 * @module
 * @internal
 */

import type { Deadline } from "../generation/timeout";
import {
  classifyError,
  type ErrorCategory,
} from "../generation/fallback";
import { observe } from "../observability";
import { routingDefinitionRef } from "../observability/definition-ref";
import {
  emitRoutingReceiptReport,
  routingSpanAttributes,
} from "./observability";
import type { RetryModel, RetryOptions } from "./retry";
import {
  attachRoutingToError,
  createRoutingReceipt,
  prependRoutingStep,
  routingCostFromMeta,
  withRoutingReceipt,
  type AttemptDetail,
  type RetryRoutingStep,
  type RoutableResult,
} from "./receipt";

/** Arguments for resolving a retry wrapper inside the routing resolver. */
export interface ResolveRetryArgs<M, R> {
  /** Retry wrapper to execute. */
  readonly retry: RetryModel<M>;
  /** Prompt input for nested wrappers. */
  readonly input: unknown;
  /** Whole routed-call deadline shared by every nested attempt. */
  readonly deadline: Deadline;
  /** Current execution mode. */
  readonly mode?: "generate" | "stream";
  /** Caller-owned cancellation inherited from the outer resolution. */
  readonly signal?: AbortSignal;
  /** Stream first-token timeout budget inherited from the call site. */
  readonly firstTokenMs?: number;
  /** Call-site routing context. */
  readonly context?: unknown;
  /** Route override supplied by the call site. */
  readonly forcedRoute?: string;
  /** Emit the canonical receipt artifact for an outermost retry. */
  readonly emitReport?: boolean;
  /** Resolve the retried child through the top-level resolver. */
  readonly resolveCandidate: (
    model: M,
    options: {
      readonly deadline: Deadline;
      readonly mode?: "generate" | "stream";
      readonly signal?: AbortSignal;
      readonly firstTokenMs?: number;
      readonly context?: unknown;
      readonly forcedRoute?: string;
      readonly emitReport?: boolean;
    },
  ) => Promise<RoutableResult<R>>;
  /** Return a human-readable id for raw models and nested wrappers. */
  readonly describeModel: (model: M) => string;
}

/** Resolve a retry wrapper by trying its child up to the configured limit. */
export async function resolveRetry<M, R>({
  retry,
  input,
  deadline,
  mode,
  signal,
  firstTokenMs,
  context,
  forcedRoute,
  emitReport = true,
  resolveCandidate,
  describeModel,
}: ResolveRetryArgs<M, R>): Promise<RoutableResult<R>> {
  const { model, options } = retry;
  const attempts: AttemptDetail[] = [];
  const maxAttempts = Math.max(1, options.attempts);
  const modelId = describeModel(model);
  let lastError: Error | undefined;

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
    const attemptStart = Date.now();
    const attemptSpan = observe.openSpan({
      name: "retry.attempt",
      primitive: "routing.retry",
      implicitRun: false,
      // Each attempt is a `routing.retry` span for the same wrapper definition;
      // only carry the ref when the wrapper was given an authored `id`.
      ...(options.id ? { definitionRefs: [routingDefinitionRef("retry", options.id)] } : {}),
      attributes: {
        ...routingSpanAttributes("retry", deadline),
        attemptIndex,
        attempts: maxAttempts,
        model: modelId,
        ...(options.id ? { routingId: options.id } : {}),
        ...(options.description ? { routingDescription: options.description } : {}),
      },
    });

    try {
      const result = await attemptSpan.withContext(() =>
        resolveCandidate(model, {
          deadline,
          mode,
          signal,
          firstTokenMs,
          context,
          forcedRoute,
          emitReport: false,
        }),
      );
      const durationMs = Date.now() - attemptStart;
      attempts.push({
        model: modelId,
        status: "ok",
        durationMs,
        cost: routingCostFromMeta(result._meta),
        ...(attemptIndex > 0 ? { delayMs: retryDelayMs(options, attemptIndex) } : {}),
      });
      const retryStep: RetryRoutingStep = {
        kind: "retry",
        ...(options.id ? { id: options.id } : {}),
        model: modelId,
        attempts,
      };
      const routing =
        result.routing !== undefined
          ? prependRoutingStep(retryStep, result.routing)
          : createRoutingReceipt(
              modelId,
              routingCostFromMeta(result._meta),
              [retryStep],
            );
      const routedResult = withRoutingReceipt(result, routing);
      if (emitReport) {
        emitRoutingReceiptReport(
          attemptSpan.spanId,
          "routing.retry",
          "retry",
          routing,
        );
      }
      attemptSpan.end({
        attributes: {
          attemptIndex,
          attemptStatus: "success",
          durationMs,
          model: modelId,
          ...(options.id ? { routingId: options.id } : {}),
        },
      });
      return routedResult;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;
      const durationMs = Date.now() - attemptStart;
      const errorCategory = classifyError(err);
      const shouldRetry =
        attemptIndex < maxAttempts - 1 &&
        shouldRetryCategory(errorCategory, options.on);
      const delayMs = shouldRetry ? retryDelayMs(options, attemptIndex + 1) : 0;

      attempts.push({
        model: modelId,
        status: "error",
        durationMs,
        error: err.message,
        ...(errorCategory ? { errorCategory } : {}),
        ...(delayMs > 0 ? { delayMs } : {}),
      });
      observe.event({
        name: "retry.attempt_failed",
        attributes: {
          attemptIndex,
          model: modelId,
          errorCategory,
          delayMs,
          willRetry: shouldRetry,
          ...(options.id ? { routingId: options.id } : {}),
        },
      });
      attemptSpan.error(err, {
        attemptIndex,
        attemptStatus: "error",
        durationMs,
        errorCategory,
        willRetry: shouldRetry,
        model: modelId,
        ...(options.id ? { routingId: options.id } : {}),
      });

      if (!shouldRetry) {
        throw attachRoutingToError(err, retryRouting(modelId, options.id, attempts));
      }

      if (delayMs > 0) {
        await sleepWithSignal(delayMs, deadline.compose(signal));
      }
    }
  }

  const fallbackError = lastError ?? new Error("retry() exhausted without an error");
  throw attachRoutingToError(
    fallbackError,
    retryRouting(modelId, options.id, attempts),
  );
}

function retryRouting(
  model: string,
  id: string | undefined,
  attempts: readonly AttemptDetail[],
) {
  return createRoutingReceipt(model, undefined, [
    {
      kind: "retry",
      ...(id ? { id } : {}),
      model,
      attempts,
    },
  ]);
}

function shouldRetryCategory(
  category: ErrorCategory | null,
  allowed: readonly ErrorCategory[] | undefined,
): boolean {
  if (category === null) return false;
  if (allowed && allowed.length > 0) return allowed.includes(category);
  return category !== "auth_error" && category !== "invalid_response";
}

function retryDelayMs(options: RetryOptions, attemptNumber: number): number {
  const base = options.delayMs ?? 250;
  if (options.backoff === "linear") return base * attemptNumber;
  if (options.backoff === "exponential") {
    return base * 2 ** Math.max(0, attemptNumber - 1);
  }
  return 0;
}

function sleepWithSignal(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  if (signal.aborted) {
    return Promise.reject(new DOMException("aborted", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
