/**
 * Internal fallback resolution used by {@link resolveModel}.
 *
 * Fallback is part of the recursive routing resolver rather than a second
 * adapter dispatch path. This helper owns the attempt loop while delegating each
 * candidate back to the resolver, so nested router/cascade/fallback values keep
 * one execution contract and one deadline hierarchy.
 *
 * @module
 * @internal
 */

import type {
  FallbackAttemptDetail,
  FallbackMeta,
  FallbackModel,
} from "../generation/fallback";
import { classifyError, shouldAttemptFallback } from "../generation/fallback";
import { getMeta, setMeta } from "../generation/result-meta";
import { Deadline, withBudget } from "../generation/timeout";
import { observe } from "../observability";

/** Options passed to one recursively resolved fallback candidate. */
export interface ResolveFallbackCandidateOptions {
  /** Cooperative cancellation signal for the active fallback attempt. */
  readonly signal?: AbortSignal;
}

/** Arguments for resolving a fallback wrapper inside the routing resolver. */
export interface ResolveFallbackArgs<M, R> {
  /** Fallback wrapper to execute. */
  readonly fallback: FallbackModel<M>;
  /** Whole routed-call deadline shared by every attempt. */
  readonly deadline: Deadline;
  /** Resolve one fallback candidate through the top-level resolver. */
  readonly resolveCandidate: (
    model: M,
    options: ResolveFallbackCandidateOptions,
  ) => Promise<R & { _meta: Record<string, unknown> }>;
  /** Return a human-readable id for raw models and nested wrappers. */
  readonly describeModel: (model: M) => string;
}

/**
 * Resolve a fallback wrapper by trying candidates in order.
 *
 * The returned result is the first successful candidate. Existing Phase 4
 * metadata semantics are preserved: `_meta.fallback` is attached only when a
 * previous attempt failed; Phase 5 replaces this with a full receipt.
 */
export async function resolveFallback<M, R>({
  fallback,
  deadline,
  resolveCandidate,
  describeModel,
}: ResolveFallbackArgs<M, R>): Promise<R & { _meta: Record<string, unknown> }> {
  const { models, options } = fallback;
  const errors: Error[] = [];
  const details: FallbackAttemptDetail[] = [];
  let previousFailedSpanId:
    | ReturnType<typeof observe.openSpan>["spanId"]
    | undefined;
  let previousFailedModelId: string | undefined;

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const modelId = describeModel(model);
    const attemptStart = Date.now();
    const attemptSpan = observe.openSpan({
      name: "fallback.attempt",
      primitive: "fallback.attempt",
      attributes: {
        attempt: i + 1,
        ...(options.id ? { routingId: options.id } : {}),
        ...(options.description
          ? { routingDescription: options.description }
          : {}),
        model: modelId,
        totalModels: models.length,
        hasTimeout: options.timeout !== undefined,
      },
    });

    try {
      const result = await attemptSpan.withContext(() =>
        withBudget(
          (signal) =>
            resolveCandidate(model, {
              signal: deadline.compose(signal),
            }),
          { budget: "step", limitMs: options.timeout },
        ),
      );
      const durationMs = Date.now() - attemptStart;

      details.push({
        model: modelId,
        durationMs,
        status: "success",
        cost: getMeta(result)?.cost,
      });

      if (errors.length > 0) {
        setMeta(result, {
          fallback: {
            attempts: i + 1,
            failedModels: details
              .filter((detail) => detail.status === "error")
              .map((detail) => detail.model),
            details,
          } satisfies FallbackMeta,
        });
      }

      if (previousFailedSpanId && previousFailedModelId) {
        observe.edge({
          edgeType: "fallback.attempt",
          from: { kind: "span", id: previousFailedSpanId },
          to: { kind: "span", id: attemptSpan.spanId },
          attributes: {
            fromModel: previousFailedModelId,
            toModel: modelId,
            attempt: i + 1,
          },
        });
      }

      emitFallbackRoutingReport(attemptSpan.spanId, {
        kind: "routing.report",
        routingKind: "fallback",
        ...(options.id ? { routingId: options.id } : {}),
        chosen: modelId,
        tiers: details.map(fallbackTierPreview),
      });
      attemptSpan.end({
        attributes: {
          attempt: i + 1,
          ...(options.id ? { routingId: options.id } : {}),
          model: modelId,
          totalModels: models.length,
          attemptStatus: "success",
          durationMs,
          cost: getMeta(result)?.cost,
          fallbackOccurred: errors.length > 0,
        },
      });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - attemptStart;
      const errorCategory = classifyError(err);
      const willAttemptFallback = shouldAttemptFallbackSafely(
        err,
        options,
        attemptSpan,
      );

      details.push({
        model: modelId,
        durationMs,
        status: "error",
        error: err.message,
        errorCategory,
      });

      if (!willAttemptFallback) {
        emitFallbackRoutingReport(attemptSpan.spanId, {
          kind: "routing.report",
          routingKind: "fallback",
          ...(options.id ? { routingId: options.id } : {}),
          fallbackReason: errorCategory,
          tiers: details.map(fallbackTierPreview),
        });
        attemptSpan.error(err, {
          attempt: i + 1,
          ...(options.id ? { routingId: options.id } : {}),
          model: modelId,
          totalModels: models.length,
          attemptStatus: "error",
          errorCategory,
          willAttemptFallback: false,
          durationMs,
        });
        throw err;
      }

      errors.push(err);
      emitFallbackRoutingReport(attemptSpan.spanId, {
        kind: "routing.report",
        routingKind: "fallback",
        ...(options.id ? { routingId: options.id } : {}),
        fallbackReason: errorCategory,
        tiers: details.map(fallbackTierPreview),
      });
      attemptSpan.error(err, {
        attempt: i + 1,
        ...(options.id ? { routingId: options.id } : {}),
        model: modelId,
        totalModels: models.length,
        attemptStatus: "error",
        errorCategory,
        willAttemptFallback: i < models.length - 1,
        durationMs,
      });
      previousFailedSpanId = attemptSpan.spanId;
      previousFailedModelId = modelId;
      notifyAttemptErrorSafely(options, err, i + 1, model, attemptSpan);
    }
  }

  throw new AggregateError(
    errors,
    `All ${models.length} fallback models failed`,
  );
}

function notifyAttemptErrorSafely<M>(
  options: FallbackModel<M>["options"],
  err: Error,
  attempt: number,
  model: M,
  attemptSpan: ReturnType<typeof observe.openSpan>,
): void {
  try {
    options.onAttemptError?.(err, attempt, model);
  } catch (hookError) {
    emitRoutingHookError(attemptSpan, "onAttemptError", hookError);
  }
}

function shouldAttemptFallbackSafely<M>(
  err: Error,
  options: FallbackModel<M>["options"],
  attemptSpan: ReturnType<typeof observe.openSpan>,
): boolean {
  try {
    return shouldAttemptFallback(err, options);
  } catch (hookError) {
    emitRoutingHookError(attemptSpan, "shouldFallback", hookError);
    return false;
  }
}

function emitRoutingHookError(
  span: ReturnType<typeof observe.openSpan>,
  hook: string,
  error: unknown,
): void {
  span.withContext(() => {
    observe.event({
      name: "routing.hook_error",
      attributes: {
        routingKind: "fallback",
        hook,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  });
}

function fallbackTierPreview(
  detail: FallbackAttemptDetail,
  index: number,
): Record<string, unknown> {
  return {
    tier: index,
    model: detail.model,
    verdict: detail.status,
    ...(detail.error ? { note: detail.error } : {}),
    ...(detail.cost !== undefined ? { cost: detail.cost } : {}),
    durationMs: detail.durationMs,
  };
}

function emitFallbackRoutingReport(
  spanId: ReturnType<typeof observe.openSpan>["spanId"],
  preview: Record<string, unknown>,
): void {
  const artifactId = observe.artifact({
    kind: "routing.report",
    contentType: "application/json",
    encoding: "json",
    preview,
    attributes: {
      primitive: "fallback.attempt",
      routingKind: "fallback",
    },
  });
  if (!artifactId) return;
  observe.edge({
    edgeType: "produced",
    from: { kind: "span", id: spanId },
    to: { kind: "artifact", id: artifactId },
    attributes: { primitive: "fallback.attempt", routingKind: "fallback" },
  });
}
