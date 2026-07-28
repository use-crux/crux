import type { CompletedOperationProviderPayload } from "../../completed-operation/contracts";

/** Stable identity passed to every bounded-stream lifecycle hook. */
export interface StreamingOperationContext<TModel> {
  readonly provider: string;
  readonly operation: string;
  readonly model: TModel;
}

/** Invocation context for opening one bounded provider stream. */
export interface StreamingOperationOpenContext<
  TModel,
> extends StreamingOperationContext<TModel> {
  /** Signal combining caller cancellation and operation deadlines. */
  readonly signal: AbortSignal;
  /**
   * Start and count one actual provider or composed child call.
   *
   * The call is counted before `start` runs, including when opening the native
   * stream rejects.
   */
  readonly call: <T>(operation: string, start: () => Promise<T>) => Promise<T>;
}

/**
 * Per-call native stream and its stateful canonical projection.
 *
 * A new source is created for every physical attempt. Mapper state therefore
 * belongs to one invocation rather than the reusable definition. Native events
 * remain private to this source and never enter the public logical log.
 */
export interface StreamingOperationSource<TNativeEvent, TNativeResult, TEvent> {
  /** Genuine finite provider event stream for this physical attempt. */
  readonly events: AsyncIterable<TNativeEvent>;
  /**
   * Project one native event into zero, one, or several canonical candidates.
   *
   * Stateful sequence counters and provider framing state belong in this
   * per-call closure. Logical `start` and `finish` framing belongs to Core and
   * must never be returned here.
   */
  readonly map: (
    this: void,
    event: TNativeEvent,
  ) => TEvent | readonly TEvent[] | undefined;
  /** Terminal native result used to construct the exact completed payload. */
  readonly completion: Promise<TNativeResult>;
}

/** One portable conformance example shipped with a streaming operation. */
export interface StreamingOperationConformanceCase<TInput, TModel> {
  readonly name: string;
  readonly input: TInput;
  readonly model: TModel;
}

/**
 * Immutable provider mechanics for one bounded streaming operation.
 *
 * Provider packages own normalization, native invocation, and typed event
 * translation. Core owns eager driving, canonical replay, Safety, routing,
 * cancellation, deadlines, validation, and correlation. `validate` returns an
 * ID-free completed-operation payload; native progressive events stay inside
 * the per-call source.
 */
export interface StreamingOperationDefinition<
  TModel,
  TInput,
  TNormalized,
  TNativeEvent,
  TNativeResult,
  TEvent,
  TResult extends CompletedOperationProviderPayload,
  TReport = unknown,
> {
  readonly normalize: (
    this: void,
    input: TInput,
    context: StreamingOperationContext<TModel>,
  ) => TNormalized | Promise<TNormalized>;
  readonly support: (
    this: void,
    input: TNormalized,
    context: StreamingOperationContext<TModel>,
  ) => "supported" | "unsupported" | "unknown";
  readonly open: (
    this: void,
    input: TNormalized,
    context: StreamingOperationOpenContext<TModel>,
  ) =>
    | StreamingOperationSource<TNativeEvent, TNativeResult, TEvent>
    | Promise<StreamingOperationSource<TNativeEvent, TNativeResult, TEvent>>;
  readonly validate: (
    this: void,
    native: TNativeResult,
    input: TNormalized,
    context: StreamingOperationContext<TModel>,
  ) => TResult;
  readonly report: (
    this: void,
    result: TResult,
    input: TNormalized,
    context: StreamingOperationContext<TModel>,
  ) => TReport;
  readonly conformance: readonly StreamingOperationConformanceCase<
    TInput,
    TModel
  >[];
}

/**
 * Freeze a provider-authored bounded streaming definition.
 *
 * The returned definition is safe to reuse concurrently because every call to
 * `open` creates a source that owns its native iterable, mapper state, and
 * terminal result. Definition hooks must not depend on `this`; capture only an
 * immutable client binding. No provider I/O occurs until Core calls `open`.
 *
 * @example
 * ```ts
 * const imageStream = defineStreamingOperation({
 *   normalize: (input: ImageInput) => normalizeImageInput(input),
 *   support: (_input, { model }) => imageStreamSupport(model),
 *   open: (input, { model, signal }) =>
 *     openImageStream(client, { ...input, model, signal }),
 *   validate: (native) => decodeImageResult(native),
 *   report: (result) => ({ imageCount: result.images.length }),
 *   conformance: [],
 * })
 * ```
 */
export function defineStreamingOperation<
  TInput,
  TNormalized,
  TNativeEvent,
  TNativeResult,
  TEvent,
  TResult extends CompletedOperationProviderPayload,
  TReport = unknown,
  TModel = TInput extends Readonly<{ model: infer TInputModel }>
    ? TInputModel
    : unknown,
>(
  definition: StreamingOperationDefinition<
    TModel,
    TInput,
    TNormalized,
    TNativeEvent,
    TNativeResult,
    TEvent,
    TResult,
    TReport
  >,
): StreamingOperationDefinition<
  TModel,
  TInput,
  TNormalized,
  TNativeEvent,
  TNativeResult,
  TEvent,
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
