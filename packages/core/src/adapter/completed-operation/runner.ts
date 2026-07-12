import {
  validateOperationTimeout,
  type CompletedOperationResult,
  type OperationTimeout,
} from "../../completed-operation/contracts";
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
import {
  openCompletedMediaObservation,
  safeMediaInputPreview,
  safeMediaOutputPreview,
  type CompletedMediaObservation,
} from "./observability-graph";
import { preflightCompletedCandidates } from "./preflight";

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
 * When `operation` maps to the media vocabulary (`generateImage`, `transcribe`,
 * `generateSpeech`, `describe`), the lifecycle emits one media span, safe
 * input/output/`media.report` artifacts, `derived.from` lineage, and nested
 * child spans for composed primitives such as `generation.call`.
 *
 * @example
 * ```ts
 * return runCompletedMediaOperation({
 *   definition: imageOperation,
 *   provider: 'example',
 *   operation: 'generateImage',
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
  const observation = openCompletedMediaObservation({
    provider: options.provider,
    operation: options.operation,
    model: options.model,
  });
  try {
    return await withAbortSignal(
      () => runWithObservation(options, signal, observation),
      signal,
    );
  } finally {
    totalBudget.dispose();
  }
}

async function runWithObservation<
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
  observation: CompletedMediaObservation | undefined,
): Promise<TResult> {
  const execute = async (): Promise<TResult> => {
    const state: CompletedRoutingState = { calls: 0 };
    const inputPreview = safeMediaInputPreview(options.input);
    try {
      const prepared = await preflightCompletedCandidates(options, signal);
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
              if (!operation.trim()) {
                throw new TypeError(
                  "Completed child operation must have a name.",
                );
              }
              state.calls += 1;
              return observation
                ? observation.observeChildCall(operation, start)
                : start();
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
      const report = emitReport(options, finalized, selected);
      observation?.succeed(
        finalized,
        report,
        inputPreview,
        safeMediaOutputPreview(finalized),
      );
      return finalized;
    } catch (error) {
      observation?.fail(error, inputPreview);
      throw error;
    }
  };

  return observation ? await observation.withContext(execute) : await execute();
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
): unknown {
  try {
    const report = safeCompletedOperationReport(
      options.definition.report(result, selected.input, selected.context),
    );
    if (report) options.onReport?.(report);
    return report;
  } catch {
    // Reporting is best-effort and must never change a successful provider result.
    return undefined;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("aborted", "AbortError");
}
