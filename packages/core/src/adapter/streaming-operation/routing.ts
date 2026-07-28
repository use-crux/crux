import { createUnsupportedCapabilityError } from "../../content/media-errors";
import { classifyError, isFallback } from "../../generation/fallback";
import { isRetry } from "../../routing/retry";
import { isRouter } from "../../routing/router";
import { isSplit } from "../../routing/split";
import {
  createRoutingReceipt,
  type AttemptDetail,
  type RoutingReceipt,
  type RoutingStep,
} from "../../routing/receipt";
import { completedModelLeaves } from "../completed-operation/routing";
import { withSelectedModel } from "../completed-operation/lifecycle";
import type {
  StreamingOperationContext,
  StreamingOperationDefinition,
} from "./definition";

/** Attempt recorder used to construct one payload-free logical receipt. */
export interface StreamingRoutingTracker {
  start(model: unknown): Readonly<{ model: unknown; startedAt: number }>;
  succeed(attempt: Readonly<{ model: unknown; startedAt: number }>): void;
  fail(
    attempt: Readonly<{ model: unknown; startedAt: number }>,
    error: unknown,
  ): void;
  receipt(
    routedModel: unknown,
    selectedModel: unknown,
    route?: string,
    midStreamFailure?: boolean,
  ): RoutingReceipt | undefined;
}

/** Track physical attempts without retaining native events or media values. */
export function createStreamingRoutingTracker(): StreamingRoutingTracker {
  const attempts: AttemptDetail[] = [];
  return {
    start: (model) => ({ model, startedAt: performance.now() }),
    succeed(attempt) {
      attempts.push(attemptDetail(attempt, "ok"));
    },
    fail(attempt, error) {
      attempts.push(attemptDetail(attempt, "error", error));
    },
    receipt(routedModel, selectedModel, route, midStreamFailure) {
      const step = routingStep(
        routedModel,
        selectedModel,
        attempts,
        route,
        midStreamFailure,
      );
      if (!step) return undefined;
      return createRoutingReceipt(describeModel(selectedModel), undefined, [
        step,
      ]);
    },
  };
}

function attemptDetail(
  attempt: Readonly<{ model: unknown; startedAt: number }>,
  status: "ok" | "error",
  error?: unknown,
): AttemptDetail {
  return {
    model: describeModel(attempt.model),
    status,
    durationMs: performance.now() - attempt.startedAt,
    ...(error === undefined
      ? {}
      : {
          errorCategory: classifyError(error) ?? "unknown",
          error: error instanceof Error ? error.message : String(error),
        }),
  };
}

function routingStep(
  routedModel: unknown,
  selectedModel: unknown,
  attempts: readonly AttemptDetail[],
  route: string | undefined,
  midStreamFailure: boolean | undefined,
): RoutingStep | undefined {
  if (isFallback(routedModel)) {
    return {
      kind: "fallback",
      id: routedModel.options.id,
      attempts: [...attempts],
      ...(midStreamFailure ? { midStreamFailure: true } : {}),
    };
  }
  if (isRetry(routedModel)) {
    return {
      kind: "retry",
      id: routedModel.options.id,
      model: describeModel(selectedModel),
      attempts: [...attempts],
    };
  }
  if (isRouter(routedModel)) {
    const selectedRoute =
      route ?? routeForModel(routedModel.config.routes, selectedModel);
    return {
      kind: "router",
      id: routedModel.config.id,
      classifiedAs: selectedRoute,
      route: selectedRoute,
      usedDefaultRoute: selectedRoute === "default",
      forced: route !== undefined,
    };
  }
  if (isSplit(routedModel)) {
    return {
      kind: "split",
      id: routedModel.config.id,
      route: route ?? routeForModel(routedModel.config.routes, selectedModel),
      seed: "internal",
    };
  }
  return undefined;
}

function routeForModel(
  routes: Readonly<Record<string, unknown>>,
  model: unknown,
): string {
  for (const [key, value] of Object.entries(routes)) {
    const target =
      typeof value === "object" && value !== null && "model" in value
        ? value.model
        : value;
    if (target === model) return key;
  }
  return "default";
}

/** Normalized, support-checked inputs for every reachable routing leaf. */
export async function preflightStreamingCandidates<
  TModel,
  TInput,
  TNormalized,
  TNativeEvent,
  TNativeResult,
  TEvent,
  TResult extends
    import("../../completed-operation/contracts").CompletedOperationProviderPayload,
  TReport,
>(
  options: Readonly<{
    definition: StreamingOperationDefinition<
      TModel,
      TInput,
      TNormalized,
      TNativeEvent,
      TNativeResult,
      TEvent,
      TResult,
      TReport
    >;
    provider: string;
    operation: "streamImage" | "streamSpeech";
    model: unknown;
    input: TInput;
  }>,
  signal: AbortSignal,
): Promise<ReadonlyMap<unknown, TNormalized>> {
  const prepared = new Map<unknown, TNormalized>();
  for (const candidate of unique(completedModelLeaves(options.model))) {
    signal.throwIfAborted();
    const context: StreamingOperationContext<TModel> = {
      provider: options.provider,
      operation: options.operation,
      model: candidate as TModel,
    };
    const normalized = await options.definition.normalize(
      withSelectedModel(options.input, candidate),
      context,
    );
    signal.throwIfAborted();
    if (options.definition.support(normalized, context) === "unsupported") {
      throw createUnsupportedCapabilityError({
        adapter: options.provider,
        model: describeModel(candidate),
        issues: [{ capability: options.operation }],
      });
    }
    prepared.set(candidate, normalized);
  }
  return prepared;
}

function unique(values: readonly unknown[]): readonly unknown[] {
  return [...new Set(values)];
}

function describeModel(model: unknown): string {
  if (typeof model === "string") return model;
  if (typeof model === "object" && model !== null) {
    const candidate = model as {
      readonly modelId?: unknown;
      readonly id?: unknown;
    };
    if (typeof candidate.modelId === "string") return candidate.modelId;
    if (typeof candidate.id === "string") return candidate.id;
  }
  return String(model);
}
