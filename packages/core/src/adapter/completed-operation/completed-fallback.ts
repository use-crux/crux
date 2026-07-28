import type { FallbackModel, FallbackOptions } from "../../generation/fallback";
import { shouldAttemptFallback } from "../../generation/fallback";
import { withBudget } from "../../generation/timeout";
import { observe } from "../../observability";
import { isPolicyTerminal } from "../../safety/errors";
import type { CompletedRoutingOptions, CompletedRoutingState } from "./routing";

type CompletedModelResolver<TResult> = (
  model: unknown,
  options: CompletedRoutingOptions,
  state: CompletedRoutingState,
  invoke: (model: unknown, signal: AbortSignal) => Promise<TResult>,
) => Promise<TResult>;

/** Run a completed operation across an ordered fallback model set. */
export async function resolveCompletedFallback<TResult>(
  model: FallbackModel,
  options: CompletedRoutingOptions,
  state: CompletedRoutingState,
  invoke: (model: unknown, signal: AbortSignal) => Promise<TResult>,
  resolve: CompletedModelResolver<TResult>,
): Promise<TResult> {
  const causes: unknown[] = [];
  for (let index = 0; index < model.models.length; index++) {
    const candidate = model.models[index];
    try {
      const result = await withBudget(
        (attemptSignal) =>
          resolve(
            candidate,
            {
              ...options,
              signal: attemptSignal
                ? AbortSignal.any([options.signal, attemptSignal])
                : options.signal,
            },
            state,
            invoke,
          ),
        { budget: "step", limitMs: model.options.timeout?.attempt },
      );
      if (await fallbackWhen(result, model.options.when)) {
        if (options.canReplace?.() === false) return result;
        const cause = Object.assign(
          new Error("fallback when(result) matched"),
          { name: "InvalidResponseError" },
        );
        causes.push(cause);
        await notifyNextFallback(model, index, cause);
        continue;
      }
      return result;
    } catch (error) {
      if (
        isPolicyTerminal(error) ||
        options.shouldStop?.(error) ||
        options.canReplace?.() === false
      )
        throw error;
      causes.push(error);
      if (index === model.models.length - 1) break;
      if (
        !(error instanceof Error) ||
        !completedShouldFallback(error, model.options)
      )
        throw error;
      await notifyNextFallback(model, index, error);
    }
  }
  throw new AggregateError(
    causes,
    "All completed-operation fallback candidates failed.",
  );
}

async function fallbackWhen(
  result: unknown,
  predicate: FallbackOptions["when"],
): Promise<boolean> {
  try {
    return (await predicate?.(result)) ?? false;
  } catch (error) {
    observeCompletedHookError("when", error);
    return false;
  }
}

function completedShouldFallback(
  error: Error,
  options: FallbackOptions,
): boolean {
  try {
    return shouldAttemptFallback(error, options);
  } catch (hookError) {
    observeCompletedHookError("shouldFallback", hookError);
    return false;
  }
}

async function notifyNextFallback(
  model: FallbackModel,
  index: number,
  error: Error,
): Promise<void> {
  const next = model.models[index + 1];
  if (next === undefined) return;
  try {
    await model.options.onFallback?.({
      from: model.models[index],
      to: next,
      attempt: index + 1,
      error,
    });
  } catch (hookError) {
    observeCompletedHookError("onFallback", hookError);
  }
}

function observeCompletedHookError(hook: string, error: unknown): void {
  observe.event({
    name: "routing.hook_error",
    attributes: {
      routingKind: "fallback",
      operationKind: "completed",
      hook,
      error: error instanceof Error ? error.message : String(error),
    },
  });
}
