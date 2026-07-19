import {
  validateOperationTimeout,
  type CompletedOperationProviderPayload,
} from "../../completed-operation/contracts";
import { withOperationResultMeta } from "../../observability/internal/result-meta";
import {
  composeAbortSignals,
  createBudgetSignal,
  withAbortSignal,
} from "../../generation/timeout";
import type {
  CompletedOperationDefinition,
  CompletedOperationContext,
} from "./definition";
import { resolveCompletedModel, type CompletedRoutingState } from "./routing";
import { safeCompletedOperationReport } from "./report";
import {
  completedLifecycleContext,
  finalizeCompletedResult,
  selectedCompletedInput,
} from "./lifecycle";
import {
  openCompletedMediaObservation,
  safeMediaInputPreview,
  safeMediaOutputPreview,
  type CompletedMediaObservation,
} from "./observability-graph";
import { guardCompletedOperationOutput } from "./safety/execute";
import { prepareCompletedOperationCandidates } from "./safety/candidate";
import type {
  CompletedMediaOperationResult,
  RunCompletedMediaOperationOptions,
} from "./runner-types";

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
 * Provider validation remains ID-free. The exact media pair is attached only
 * after payload finalization and is visible to success reporting and callers.
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
  TResult extends CompletedOperationProviderPayload,
  TReport = unknown,
  TSelectedModel = TModel,
  const TOperation extends string = string,
>(
  options: RunCompletedMediaOperationOptions<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport,
    TSelectedModel,
    TOperation
  >,
): Promise<CompletedMediaOperationResult<TOperation, TResult>> {
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
  TResult extends CompletedOperationProviderPayload,
  TReport,
  TSelectedModel,
  TOperation extends string,
>(
  options: RunCompletedMediaOperationOptions<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport,
    TSelectedModel,
    TOperation
  >,
  signal: AbortSignal,
  observation: CompletedMediaObservation | undefined,
): Promise<CompletedMediaOperationResult<TOperation, TResult>> {
  const execute = async (): Promise<
    CompletedMediaOperationResult<TOperation, TResult>
  > => {
    const state: CompletedRoutingState = { calls: 0 };
    const inputPreview = safeMediaInputPreview(options.input);
    try {
      const candidates = await prepareCompletedOperationCandidates(
        options,
        signal,
      );
      const { input, safety, normalized: prepared } = candidates;
      const result = await resolveCompletedModel(
        options.model,
        {
          input,
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
          const normalized = await candidates.prepare(candidate, attemptSignal);
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
      const payload = finalizeCompletedResult(result, state.calls);
      const guarded = await guardCompletedOperationOutput(
        options.operation,
        payload,
        safety,
        state.selectedModel,
      );
      const selected = await selectedCompletedInput(
        prepared,
        input,
        options.definition,
        options,
        state.selectedModel,
      );
      if (!observation) {
        emitReport(options, guarded, selected);
        return guarded as CompletedMediaOperationResult<TOperation, TResult>;
      }
      const finalized = withOperationResultMeta(guarded, {
        traceId: observation.traceId,
        spanId: observation.spanId,
      });
      const report = emitReport(options, finalized as TResult, selected);
      observation.succeed(
        finalized,
        report,
        inputPreview,
        safeMediaOutputPreview(guarded),
      );
      return finalized as CompletedMediaOperationResult<TOperation, TResult>;
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
  TResult extends CompletedOperationProviderPayload,
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
