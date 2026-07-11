import {
  validateOperationTimeout,
  type CompletedOperationResult,
  type OperationTimeout,
} from "../../completed-operation/contracts";
import { createUnsupportedCapabilityError } from "../../content/media-errors";
import {
  composeAbortSignals,
  createBudgetSignal,
  withAbortSignal,
} from "../../generation/timeout";
import type {
  CompletedOperationDefinition,
  CompletedOperationContext,
} from "./definition";
import type { CompletedOperationModelGuard, RoutingCallOptions } from "../../routing/types";
import {
  completedModelLeaves,
  resolveCompletedModel,
  type CompletedRoutingState,
} from "./routing";
import { safeCompletedOperationReport } from "./report";
import {
  completedLifecycleContext,
  finalizeCompletedResult,
  selectedCompletedInput,
  withSelectedModel,
} from "./lifecycle";

/** Options owned by the shared bounded-media lifecycle. */
export type RunCompletedMediaOperationOptions<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport,
  TSelectedModel = TModel,
> = Readonly<{
  readonly definition: CompletedOperationDefinition<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport
  >;
  readonly provider: string;
  readonly operation: string;
  readonly model: TSelectedModel;
  readonly input: TInput;
  readonly abortSignal?: AbortSignal;
  readonly timeout?: OperationTimeout;
  /** Context consumed by router/split callbacks. */
  readonly routing?: object;
  /** Optional top-level route override. */
  readonly route?: string;
  /** Internal descriptor sink. Reports must contain safe facts only. */
  readonly onReport?: (report: unknown) => void;
}> &
  CompletedOperationModelGuard<TModel, TSelectedModel> &
  RoutingCallOptions<TSelectedModel>;

/**
 * Run a bounded media operation through one provider-neutral lifecycle.
 *
 * Known unsupported candidates fail before native I/O. Unknown models reach
 * the provider. Native failures retain exact identity; routed fallback failure
 * uses `AggregateError.errors` to retain every original cause. The runner
 * neither persists media nor enters the language/tool loop.
 *
 * @example
 * ```ts
 * return runCompletedMediaOperation({
 *   definition: imageOperation,
 *   provider: 'example',
 *   operation: 'image.generate',
 *   model: options.model,
 *   input: options,
 *   abortSignal: options.abortSignal,
 *   timeout: options.timeout,
 * })
 * ```
 */
export async function runCompletedMediaOperation<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport = unknown,
  TSelectedModel = TModel,
>(
  options: RunCompletedMediaOperationOptions<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport,
    TSelectedModel
  >,
): Promise<TResult> {
  validateOperationTimeout(options.timeout);
  throwIfAborted(options.abortSignal);
  const totalBudget = createBudgetSignal({
    budget: "total",
    limitMs: options.timeout?.totalMs,
  });
  const signal =
    composeAbortSignals(options.abortSignal, totalBudget.signal) ??
    new AbortController().signal;
  const state: CompletedRoutingState = { calls: 0 };
  try {
    return await withAbortSignal(async () => {
      const prepared = await preflightCandidates(options, signal);
      const result = await resolveCompletedModel(
        options.model,
        {
          input: options.input,
          context: options.routing,
          route: options.route,
          signal,
          stepMs: options.timeout?.stepMs,
        },
        state,
        async (candidate, attemptSignal) => {
          const context = completedLifecycleContext(
            options,
            candidate as TModel,
          );
          const candidateInput = withSelectedModel(options.input, candidate);
          const normalized =
            prepared.get(candidate) ??
            (await options.definition.normalize(candidateInput, context));
          const native = await options.definition.invoke(normalized, {
            ...context,
            signal: attemptSignal,
            call: async (operation, start) => {
              if (!operation.trim())
                throw new TypeError("Completed child operation must have a name.");
              state.calls += 1;
              return start();
            },
          });
          return options.definition.validate(native, normalized, context);
        },
      );
      const finalized = finalizeCompletedResult(result, state.calls);
      const selected = await selectedCompletedInput(
        prepared,
        options.input,
        options.definition,
        options,
        state.selectedModel,
      );
      emitReport(options, finalized, selected);
      return finalized;
    }, signal);
  } finally {
    totalBudget.dispose();
  }
}

function emitReport<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport,
>(
  options: Readonly<{
    definition: CompletedOperationDefinition<
      TModel,
      TInput,
      TNormalized,
      TNative,
      TResult,
      TReport
    >;
    onReport?: (report: unknown) => void;
  }>,
  result: TResult,
  selected: Readonly<{
    input: TNormalized;
    context: CompletedOperationContext<TModel>;
  }>,
): void {
  try {
    const report = safeCompletedOperationReport(
      options.definition.report(result, selected.input, selected.context),
    );
    if (report) options.onReport?.(report);
  } catch {
    // Reporting is best-effort and must never change a successful provider result.
  }
}

async function preflightCandidates<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport,
  TSelectedModel,
>(
  options: RunCompletedMediaOperationOptions<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport,
    TSelectedModel
  >,
  signal: AbortSignal,
): Promise<ReadonlyMap<unknown, TNormalized>> {
  const prepared = new Map<unknown, TNormalized>();
  for (const candidate of unique(completedModelLeaves(options.model))) {
    throwIfAborted(signal);
    const context = completedLifecycleContext(options, candidate as TModel);
    const candidateInput = withSelectedModel(options.input, candidate);
    const normalized = await options.definition.normalize(
      candidateInput,
      context,
    );
    prepared.set(candidate, normalized);
    if (options.definition.support(normalized, context) === "unsupported") {
      throw createUnsupportedCapabilityError({
        adapter: options.provider,
        model: describeModel(candidate),
        issues: [{ capability: options.operation }],
      });
    }
  }
  throwIfAborted(signal);
  return prepared;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("aborted", "AbortError");
}

function unique(values: readonly unknown[]): readonly unknown[] {
  return [...new Set(values)];
}

function describeModel(model: unknown): string {
  if (typeof model === "string") return model;
  if (typeof model === "object" && model !== null) {
    const value = model as {
      readonly modelId?: unknown;
      readonly id?: unknown;
    };
    if (typeof value.modelId === "string") return value.modelId;
    if (typeof value.id === "string") return value.id;
  }
  return String(model);
}
