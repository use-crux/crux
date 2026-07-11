import type { CompletedOperationResult } from "../../completed-operation/contracts";

/** Stable identity passed to every completed-operation lifecycle hook. */
export interface CompletedOperationContext<TModel> {
  readonly provider: string;
  readonly operation: string;
  readonly model: TModel;
}

/** Invocation context for one bounded provider attempt. */
export interface CompletedOperationInvokeContext<
  TModel,
> extends CompletedOperationContext<TModel> {
  /** Signal combining caller cancellation, the total deadline, and the step deadline. */
  readonly signal: AbortSignal;
}

/** One portable conformance example shipped with a provider operation. */
export interface CompletedOperationConformanceCase<TInput, TModel> {
  readonly name: string;
  readonly input: TInput;
  readonly model: TModel;
}

/**
 * Immutable mechanics for one bounded media operation.
 *
 * Provider packages own normalization and native translation. Core owns the
 * lifecycle around these pure hooks. `support` is deliberately local to the
 * definition: Crux does not expose runtime capability discovery.
 */
export interface CompletedOperationDefinition<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport = unknown,
> {
  readonly normalize: (
    this: void,
    input: TInput,
    context: CompletedOperationContext<TModel>,
  ) => TNormalized | Promise<TNormalized>;
  readonly support: (
    this: void,
    input: TNormalized,
    context: CompletedOperationContext<TModel>,
  ) => "supported" | "unsupported" | "unknown";
  readonly invoke: (
    this: void,
    input: TNormalized,
    context: CompletedOperationInvokeContext<TModel>,
  ) => Promise<TNative>;
  readonly validate: (
    this: void,
    native: TNative,
    input: TNormalized,
    context: CompletedOperationContext<TModel>,
  ) => TResult;
  readonly report: (
    this: void,
    result: TResult,
    input: TNormalized,
    context: CompletedOperationContext<TModel>,
  ) => TReport;
  readonly conformance: readonly CompletedOperationConformanceCase<
    TInput,
    TModel
  >[];
}

/**
 * Freeze a provider-authored completed-operation definition.
 *
 * The returned record is safe to reuse across bound clients and calls. Hooks
 * must not depend on `this`; capture an immutable client binding in closures.
 * Definitions perform no I/O until the shared runner calls `invoke`.
 *
 * @example
 * ```ts
 * const image = defineCompletedOperation({
 *   normalize: (input) => normalizeImageInput(input),
 *   support: (_input, { model }) => imageSupport(model),
 *   invoke: (input, { model, signal }) => client.images.generate({ ...input, model, signal }),
 *   validate: (raw) => decodeImageResult(raw),
 *   report: (result) => ({ kind: 'image', count: result.images.length }),
 *   conformance: [],
 * })
 * ```
 */
export function defineCompletedOperation<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport = unknown,
>(
  definition: CompletedOperationDefinition<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport
  >,
): CompletedOperationDefinition<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult,
  TReport
> {
  return Object.freeze({
    ...definition,
    conformance: Object.freeze(
      definition.conformance.map((item) => Object.freeze({ ...item })),
    ),
  });
}
