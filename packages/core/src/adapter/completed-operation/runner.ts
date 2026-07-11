import {
  validateOperationExecution,
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
import { sanitizeMediaPreview } from "../../observability/media-preview";
import type {
  CompletedOperationDefinition,
  CompletedOperationContext,
} from "./definition";
import {
  completedModelLeaves,
  resolveCompletedModel,
  type CompletedRoutingState,
} from "./routing";

/** Options owned by the shared bounded-media lifecycle. */
export interface RunCompletedMediaOperationOptions<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport,
> {
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
  readonly model: TModel;
  readonly input: TInput;
  readonly abortSignal?: AbortSignal;
  readonly timeout?: OperationTimeout;
  readonly routing?: Readonly<{ context?: object; route?: string }>;
  /** Internal descriptor sink. Reports must contain safe facts only. */
  readonly onReport?: (report: unknown) => void;
}

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
>(
  options: RunCompletedMediaOperationOptions<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport
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
          context: options.routing?.context,
          route: options.routing?.route,
          signal,
          stepMs: options.timeout?.stepMs,
        },
        state,
        async (candidate, attemptSignal) => {
          const context = lifecycleContext(options, candidate as TModel);
          const normalized =
            prepared.get(candidate) ??
            (await options.definition.normalize(options.input, context));
          const native = await options.definition.invoke(normalized, {
            ...context,
            signal: attemptSignal,
          });
          return options.definition.validate(native, normalized, context);
        },
      );
      const finalized = finalizeResult(result, state.calls);
      const selected = await selectedNormalized(
        prepared,
        options.input,
        options.definition,
        options,
        state.selectedModel,
      );
      const report = options.definition.report(
        finalized,
        selected.input,
        selected.context,
      );
      options.onReport?.(sanitizeMediaPreview(report));
      return finalized;
    }, signal);
  } finally {
    totalBudget.dispose();
  }
}

async function preflightCandidates<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport,
>(
  options: RunCompletedMediaOperationOptions<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport
  >,
  signal: AbortSignal,
): Promise<ReadonlyMap<unknown, TNormalized>> {
  const prepared = new Map<unknown, TNormalized>();
  for (const candidate of unique(completedModelLeaves(options.model))) {
    throwIfAborted(signal);
    const context = lifecycleContext(options, candidate as TModel);
    const normalized = await options.definition.normalize(
      options.input,
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

function finalizeResult<TResult extends CompletedOperationResult>(
  result: TResult,
  calls: number,
): TResult {
  const execution = validateOperationExecution(
    result.execution.kind === "composed"
      ? {
          ...result.execution,
          calls: result.execution.calls + Math.max(0, calls - 1),
        }
      : { kind: "native", calls },
  );
  return Object.freeze({
    ...result,
    warnings: Object.freeze([...result.warnings]),
    execution,
  });
}

function lifecycleContext<TModel>(
  options: Readonly<{ provider: string; operation: string }>,
  model: TModel,
): CompletedOperationContext<TModel> {
  return Object.freeze({
    provider: options.provider,
    operation: options.operation,
    model,
  });
}

async function selectedNormalized<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport,
>(
  prepared: ReadonlyMap<unknown, TNormalized>,
  input: TInput,
  definition: CompletedOperationDefinition<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport
  >,
  options: Readonly<{ provider: string; operation: string; model: TModel }>,
  selectedModel: unknown,
): Promise<
  Readonly<{
    input: TNormalized;
    context: CompletedOperationContext<TModel>;
  }>
> {
  const first = prepared.entries().next().value as
    | readonly [unknown, TNormalized]
    | undefined;
  const model = (selectedModel ?? first?.[0] ?? options.model) as TModel;
  const context = lifecycleContext(options, model);
  const normalized = prepared.has(selectedModel)
    ? prepared.get(selectedModel)!
    : (first?.[1] ?? (await definition.normalize(input, context)));
  return { input: normalized, context };
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
