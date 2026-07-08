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
  FallbackModel,
} from "../generation/fallback";
import { classifyError, shouldAttemptFallback } from "../generation/fallback";
import { getMeta } from "../generation/result-meta";
import { Deadline, withBudget } from "../generation/timeout";
import { observe } from "../observability";
import { FallbackExhaustedError } from "./errors";
import {
  emitFallbackRoutingReport,
  emitRoutingHookError,
} from "./resolve-fallback-observability";
import {
  createRoutingReceipt,
  prependRoutingStep,
  routingCostFromMeta,
  withRoutingReceipt,
  type AttemptDetail,
  type FallbackRoutingStep,
  type RoutableResult,
} from "./receipt";

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
  ) => Promise<RoutableResult<R>>;
  /** Return a human-readable id for raw models and nested wrappers. */
  readonly describeModel: (model: M) => string;
}

/**
 * Resolve a fallback wrapper by trying candidates in order.
 *
 * The returned result is the first successful candidate with a full routing
 * receipt. Fallback receipts are emitted even when the first candidate works.
 */
export async function resolveFallback<M, R>({
  fallback,
  deadline,
  resolveCandidate,
  describeModel,
}: ResolveFallbackArgs<M, R>): Promise<RoutableResult<R>> {
  const { models, options } = fallback;
  const errors: Error[] = [];
  const details: AttemptDetail[] = [];
  let previousFailedSpanId:
    | ReturnType<typeof observe.openSpan>["spanId"]
    | undefined;
  let previousFailedModelId: string | undefined;
  const fallbackStart = Date.now();
  const fallbackSpan = observe.openSpan({
    name: "fallback.resolve",
    primitive: "routing.fallback",
    attributes: {
      totalModels: models.length,
      ...(options.id ? { routingId: options.id } : {}),
      ...(options.description ? { routingDescription: options.description } : {}),
    },
  });

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    const modelId = describeModel(model);
    const attemptStart = Date.now();
	    const attemptSpan = observe.openSpan({
	      name: "fallback.attempt",
	      primitive: "routing.fallback",
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
          { budget: "step", limitMs: options.timeout?.attempt },
        ),
      );
      const durationMs = Date.now() - attemptStart;

      details.push({
        model: modelId,
        durationMs,
        status: "ok",
        cost: routingCostFromMeta(getMeta(result)),
      });

      const fallbackStep: FallbackRoutingStep = {
        kind: "fallback",
        ...(options.id ? { id: options.id } : {}),
        attempts: details,
      };
      const routing =
        result.routing !== undefined
          ? prependRoutingStep(fallbackStep, result.routing)
          : createRoutingReceipt(
              modelId,
              routingCostFromMeta(getMeta(result)),
              [fallbackStep],
            );
      const routedResult = withRoutingReceipt(result, routing);

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

	      emitFallbackRoutingReport(fallbackSpan.spanId, routing);
	      attemptSpan.end({
        attributes: {
          attempt: i + 1,
          ...(options.id ? { routingId: options.id } : {}),
          model: modelId,
          totalModels: models.length,
          attemptStatus: "success",
          durationMs,
          cost: routingCostFromMeta(getMeta(result)),
          fallbackOccurred: errors.length > 0,
	        },
	      });
	      fallbackSpan.end({
	        attributes: {
	          totalModels: models.length,
	          attempts: details.length,
	          chosen: routing.model,
	          durationMs: Date.now() - fallbackStart,
	          ...(options.id ? { routingId: options.id } : {}),
	        },
	      });
	      return routedResult;
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
        ...(errorCategory ? { errorCategory } : {}),
      });

      if (!willAttemptFallback) {
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
	        const routing = createRoutingReceipt(modelId, undefined, [
	          {
	            kind: "fallback",
	            ...(options.id ? { id: options.id } : {}),
	            attempts: details,
	          },
	        ]);
	        emitFallbackRoutingReport(fallbackSpan.spanId, routing);
	        fallbackSpan.error(err, {
	          totalModels: models.length,
	          attempts: details.length,
	          errorCategory,
	          durationMs: Date.now() - fallbackStart,
	          ...(options.id ? { routingId: options.id } : {}),
	        });
	        throw err;
	      }

	      errors.push(err);
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
      const nextModel = models[i + 1];
      if (nextModel !== undefined) {
        await notifyFallbackSafely(
          options,
          err,
          i + 1,
          model,
          nextModel,
          attemptSpan,
        );
      }
    }
  }

  const fallbackStep: FallbackRoutingStep = {
    kind: "fallback",
    ...(options.id ? { id: options.id } : {}),
    attempts: details,
  };
  const finalModel = details.at(-1)?.model ?? "unknown";
  const routing = createRoutingReceipt(finalModel, undefined, [fallbackStep]);
  const error = new FallbackExhaustedError(details, routing, errors);
  emitFallbackRoutingReport(fallbackSpan.spanId, routing);
  fallbackSpan.error(error, {
    totalModels: models.length,
    attempts: details.length,
    durationMs: Date.now() - fallbackStart,
    ...(options.id ? { routingId: options.id } : {}),
  });
  throw error;
}

async function notifyFallbackSafely<M>(
  options: FallbackModel<M>["options"],
  err: Error,
  attempt: number,
  model: M,
  nextModel: M,
  attemptSpan: ReturnType<typeof observe.openSpan>,
): Promise<void> {
  try {
    await options.onFallback?.({
      from: model,
      to: nextModel,
      attempt,
      error: err,
    });
  } catch (hookError) {
    emitRoutingHookError(attemptSpan, "onFallback", hookError);
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
