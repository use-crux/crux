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

import type { FallbackModel } from "../generation/fallback";
import { classifyError, shouldAttemptFallback } from "../generation/fallback";
import { getMeta } from "../generation/result-meta";
import { composeAbortSignals, Deadline, withBudget } from "../generation/timeout";
import { observe } from "../observability";
import { routingDefinitionRef } from "../observability/definition-ref";
import { isPolicyTerminal } from "../safety/errors";
import { FallbackExhaustedError } from "./errors";
import { readRoutingFirstTokenAt } from "./first-token";
import {
  emitRoutingMidStreamFailure,
  routingSpanAttributes,
} from "./observability";
import {
  emitFallbackRoutingReport,
  emitRoutingHookError,
} from "./resolve-fallback-observability";
import {
  createRoutingReceipt,
  prependRoutingStep,
  routingCostFromMeta,
  withRoutingReceipt,
  withRoutingFirstTokenAt,
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
  readonly signal?: AbortSignal;
  /** Resolve one fallback candidate through the top-level resolver. */
  readonly resolveCandidate: (
    model: M,
    options: ResolveFallbackCandidateOptions,
  ) => Promise<RoutableResult<R>>;
  /** Return a human-readable id for raw models and nested wrappers. */
  readonly describeModel: (model: M) => string;
  /** Emit the canonical receipt artifact for an outermost fallback. */
  readonly emitReport?: boolean;
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
  signal: callerSignal,
  resolveCandidate,
  describeModel,
  emitReport = true,
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
    // The outer resolve span represents the fallback wrapper definition; the
    // per-attempt spans below intentionally do not repeat the ref.
    ...(options.id ? { definitionRefs: [routingDefinitionRef("fallback", options.id)] } : {}),
    attributes: {
      ...routingSpanAttributes("fallback", deadline),
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
        ...routingSpanAttributes("fallback", deadline),
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
              signal: deadline.compose(composeAbortSignals(callerSignal, signal)),
            }),
          { budget: "step", limitMs: options.timeout?.attempt },
        ),
      );
      const durationMs = Date.now() - attemptStart;
      const resultCost = routingCostFromMeta(getMeta(result));
      const invalidResponse = await shouldFallbackForResultSafely(
        result,
        options,
        attemptSpan,
      );

      if (invalidResponse) {
        const invalidResponseError = new Error("fallback when(result) matched");
        invalidResponseError.name = "InvalidResponseError";
        details.push({
          model: modelId,
          durationMs,
          status: "error",
          cost: resultCost,
          error: invalidResponseError.message,
          errorCategory: "invalid_response",
        });
        errors.push(invalidResponseError);

        attemptSpan.error(invalidResponseError, {
          attempt: i + 1,
          ...(options.id ? { routingId: options.id } : {}),
          model: modelId,
          totalModels: models.length,
          attemptStatus: "error",
          errorCategory: "invalid_response",
          willAttemptFallback: i < models.length - 1,
          durationMs,
          cost: resultCost,
        });
        previousFailedSpanId = attemptSpan.spanId;
        previousFailedModelId = modelId;
        const nextModel = models[i + 1];
        if (nextModel !== undefined) {
          await notifyFallbackSafely(
            options,
            invalidResponseError,
            i + 1,
            model,
            nextModel,
            attemptSpan,
          );
        }
        continue;
      }

      details.push({
        model: modelId,
        durationMs,
        status: "ok",
        cost: resultCost,
      });
      const firstTokenAt = readRoutingFirstTokenAt(result);

      const fallbackStep: FallbackRoutingStep = {
        kind: "fallback",
        ...(options.id ? { id: options.id } : {}),
        ...(firstTokenAt !== undefined ? { firstTokenAt } : {}),
        attempts: details,
      };
      const routing = withRoutingFirstTokenAt(
        result.routing !== undefined
          ? prependRoutingStep(fallbackStep, result.routing)
          : createRoutingReceipt(
              modelId,
              routingCostFromMeta(getMeta(result)),
              [fallbackStep],
              { firstTokenAt },
            ),
        firstTokenAt,
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

      if (emitReport) emitFallbackRoutingReport(fallbackSpan.spanId, routing);
      const attemptAttributes = {
        attempt: i + 1,
        ...(options.id ? { routingId: options.id } : {}),
        model: modelId,
        totalModels: models.length,
        durationMs,
        cost: resultCost,
        fallbackOccurred: errors.length > 0,
      };
      const streamResult = withFallbackStreamAttemptFinalizer(
        routedResult,
        attemptSpan,
        attemptAttributes,
      );
      if (streamResult) {
        attemptSpan.setAttributes({
          ...attemptAttributes,
          attemptStatus: "streaming",
        });
      } else {
        attemptSpan.end({
          attributes: {
            ...attemptAttributes,
            attemptStatus: "success",
          },
        });
      }
      fallbackSpan.end({
        attributes: {
          totalModels: models.length,
          attempts: details.length,
          chosen: routing.model,
          durationMs: Date.now() - fallbackStart,
          ...(options.id ? { routingId: options.id } : {}),
        },
      });
      return streamResult ?? routedResult;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - attemptStart;
      const errorCategory = classifyError(err);
      const willAttemptFallback =
        !isPolicyTerminal(err) &&
        shouldAttemptFallbackSafely(err, options, attemptSpan);

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
        if (emitReport) emitFallbackRoutingReport(fallbackSpan.spanId, routing);
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
  if (emitReport) emitFallbackRoutingReport(fallbackSpan.spanId, routing);
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

async function shouldFallbackForResultSafely<M>(
  result: unknown,
  options: FallbackModel<M>["options"],
  attemptSpan: ReturnType<typeof observe.openSpan>,
): Promise<boolean> {
  try {
    return (await options.when?.(result)) === true;
  } catch (hookError) {
    emitRoutingHookError(attemptSpan, "when", hookError);
    return false;
  }
}

function withFallbackStreamAttemptFinalizer<R>(
  result: RoutableResult<R>,
  attemptSpan: ReturnType<typeof observe.openSpan>,
  attributes: Record<string, unknown>,
): RoutableResult<R> | undefined {
  if (!isRecord(result)) return undefined;
  const record = result as Record<PropertyKey, unknown>;
  const clone: Record<PropertyKey, unknown> = { ...record };

  let finalized = false;
  const finalizeSuccess = (): void => {
    if (finalized) return;
    finalized = true;
    attemptSpan.end({
      attributes: {
        ...attributes,
        attemptStatus: "success",
      },
    });
  };
  const finalizeError = (error: unknown): void => {
    if (finalized) return;
    finalized = true;
    const err = error instanceof Error ? error : new Error(String(error));
    const errorCategory = classifyError(err);
    emitRoutingMidStreamFailure(attemptSpan, {
      ...attributes,
      routingKind: "fallback",
      errorCategory,
    });
    attemptSpan.error(err, {
      ...attributes,
      attemptStatus: "error",
      midStreamFailure: true,
      errorCategory,
    });
  };

  const completion = record["completion"];
  const hasCompletion = typeof completion === "function";
  let wrapped = false;
  if (isAsyncIterable(record["rawStream"])) {
    clone["rawStream"] = wrapStream(
      record["rawStream"],
      finalizeError,
      hasCompletion ? undefined : finalizeSuccess,
    );
    wrapped = true;
  }

  const raw = record["raw"];
  if (isRecord(raw) && isAsyncIterable(raw["textStream"])) {
    clone["raw"] = {
      ...raw,
      textStream: wrapStream(
        raw["textStream"],
        finalizeError,
        hasCompletion ? undefined : finalizeSuccess,
      ),
    };
    wrapped = true;
  }

  if (typeof completion === "function") {
    clone["completion"] = async (): Promise<unknown> => {
      try {
        const meta = await completion.call(record);
        finalizeSuccess();
        return meta;
      } catch (error) {
        finalizeError(error);
        throw error;
      }
    };
    wrapped = true;
  }

  return wrapped ? (clone as RoutableResult<R>) : undefined;
}

async function* wrapStream<T>(
  stream: AsyncIterable<T>,
  finalizeError: (error: unknown) => void,
  finalizeSuccess?: () => void,
): AsyncIterable<T> {
  try {
    for await (const chunk of stream) {
      yield chunk;
    }
    finalizeSuccess?.();
  } catch (error) {
    finalizeError(error);
    throw error;
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    isRecord(value) &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}
