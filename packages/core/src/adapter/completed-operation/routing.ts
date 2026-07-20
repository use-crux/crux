import {
  classifyError,
  isFallback,
} from "../../generation/fallback";
import { withAbortSignal, withBudget } from "../../generation/timeout";
import { isCascade } from "../../routing/cascade";
import { isRetry, type RetryOptions } from "../../routing/retry";
import { isRouter } from "../../routing/router";
import { isSplit } from "../../routing/split";
import { resolveCompletedFallback } from "./completed-fallback";
import { isPolicyTerminal } from "../../safety/errors";

export interface CompletedRoutingOptions {
  readonly input: unknown;
  readonly context?: object;
  readonly route?: string;
  readonly signal: AbortSignal;
  readonly stepMs?: number;
}

export interface CompletedRoutingState {
  calls: number;
  selectedModel?: unknown;
}

export async function resolveCompletedModel<TResult>(
  model: unknown,
  options: CompletedRoutingOptions,
  state: CompletedRoutingState,
  invoke: (model: unknown, signal: AbortSignal) => Promise<TResult>,
): Promise<TResult> {
  const profiled = callProfileModel(model);
  if (profiled !== undefined)
    return resolveCompletedModel(profiled, options, state, invoke);
  if (isCascade(model))
    throw new TypeError(
      "cascade() does not support completed media operations.",
    );

  if (isRetry(model)) {
    let lastError: unknown;
    for (let attempt = 0; attempt < model.options.attempts; attempt++) {
      try {
        return await resolveCompletedModel(model.model, options, state, invoke);
      } catch (error) {
        if (isPolicyTerminal(error)) throw error;
        lastError = error;
        if (
          attempt === model.options.attempts - 1 ||
          !shouldRetry(error, model.options)
        )
          throw error;
        await retryDelay(model.options, attempt + 1, options.signal);
      }
    }
    throw lastError;
  }

  if (isFallback(model)) {
    return resolveCompletedFallback(
      model,
      options,
      state,
      invoke,
      resolveCompletedModel,
    );
  }

  if (isRouter(model)) {
    const key =
      options.route ??
      (await model.config.classify({
        input: options.input as never,
        context: options.context ?? {},
      }));
    const selected = model.config.routes[key] ?? model.config.routes.default;
    if (selected === undefined)
      throw new TypeError(`router() selected unknown route "${String(key)}".`);
    return resolveCompletedModel(
      routeTarget(selected),
      { ...options, route: undefined },
      state,
      invoke,
    );
  }

  if (isSplit(model)) {
    const selected = selectSplit(
      model.config.routes,
      model.config.seed({
        input: options.input as never,
        context: options.context ?? {},
      }),
      options.route,
    );
    return resolveCompletedModel(
      selected,
      { ...options, route: undefined },
      state,
      invoke,
    );
  }

  return withBudget(
    (stepSignal) => {
      const signal =
        stepSignal === undefined
          ? options.signal
          : AbortSignal.any([options.signal, stepSignal]);
      state.selectedModel = model;
      return withAbortSignal(() => invoke(model, signal), signal);
    },
    { budget: "step", limitMs: options.stepMs },
  );
}

export function completedModelLeaves(model: unknown): readonly unknown[] {
  const profiled = callProfileModel(model);
  if (profiled !== undefined) return completedModelLeaves(profiled);
  if (isCascade(model))
    throw new TypeError(
      "cascade() does not support completed media operations.",
    );
  if (isRetry(model)) return completedModelLeaves(model.model);
  if (isFallback(model)) return model.models.flatMap(completedModelLeaves);
  if (isRouter(model))
    return Object.values(model.config.routes).flatMap((route) =>
      completedModelLeaves(routeTarget(route)),
    );
  if (isSplit(model))
    return Object.values(model.config.routes).flatMap((route) =>
      completedModelLeaves(route.model),
    );
  return [model];
}

function callProfileModel(value: unknown): unknown | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("model" in value) ||
    "_tag" in value
  )
    return undefined;
  return (value as { readonly model: unknown }).model;
}

function routeTarget(value: unknown): unknown {
  return callProfileModel(value) ?? value;
}

function shouldRetry(error: unknown, options: RetryOptions): boolean {
  const category = classifyError(error);
  if (category === null) return false;
  if (options.on && options.on.length > 0) return options.on.includes(category);
  return category !== "auth_error" && category !== "invalid_response";
}

async function retryDelay(
  options: RetryOptions,
  attempt: number,
  signal: AbortSignal,
): Promise<void> {
  if (options.backoff === undefined || options.backoff === "none") return;
  const base = options.delayMs ?? 250;
  const delayMs =
    options.backoff === "linear"
      ? base * attempt
      : base * 2 ** Math.max(0, attempt - 1);
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function selectSplit(
  routes: Readonly<
    Record<string, Readonly<{ model: unknown; weight: number }>>
  >,
  seed: string,
  forced: string | undefined,
): unknown {
  if (forced !== undefined && routes[forced] !== undefined)
    return routes[forced].model;
  const weighted = Object.entries(routes).filter(
    ([, route]) => Number.isFinite(route.weight) && route.weight > 0,
  );
  if (weighted.length === 0)
    throw new TypeError(
      "split() requires at least one route with a positive weight.",
    );
  const total = weighted.reduce((sum, [, route]) => sum + route.weight, 0);
  let bucket = hash(seed) % total;
  for (const [, route] of weighted) {
    if (bucket < route.weight) return route.model;
    bucket -= route.weight;
  }
  return weighted[weighted.length - 1]![1].model;
}

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}
