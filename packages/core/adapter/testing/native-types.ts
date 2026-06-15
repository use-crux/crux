/**
 * Public types for native `AdapterSpec` conformance harnesses.
 *
 * These live separately from the runner so provider packages can import the
 * harness contract without pulling more implementation detail into editor
 * tooltips than necessary.
 *
 * @module
 */

/** One scripted native model response consumed by a conformance case. */
export interface AdapterConformanceEmission {
  /** Assistant text returned by the provider. */
  readonly text?: string
  /** Tool calls returned by the provider, already in canonical intent form. */
  readonly toolCalls?: readonly { readonly id?: string; readonly name: string; readonly args: unknown }[]
  /** Usage that the adapter should normalize onto `AdapterResponse.usage`. */
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly totalTokens?: number
  }
}

/** Abstract provider behavior for one conformance case. */
export interface AdapterConformanceScript {
  /** Non-streaming responses, consumed one per `spec.call()` invocation. */
  readonly emissions?: readonly AdapterConformanceEmission[]
  /** Structured-output raw texts, consumed by cases that pass `schemaParams`. */
  readonly structuredTexts?: readonly string[]
  /** Streaming text chunks consumed by `spec.stream()`. */
  readonly streamChunks?: readonly string[]
}

/** Captured provider request inspection exposed by a provider harness. */
export interface AdapterConformanceInspector {
  /** Every provider call body captured by the fake SDK client. */
  calls(): readonly unknown[]
  /** The provider-native message payload for a captured call. */
  messagesForCall(index: number): unknown
  /** The full provider-native request body for a captured call. */
  bodyForCall(index: number): unknown
}

/** Optional feature flags for provider capabilities that are not universal. */
export interface AdapterConformanceCapabilities {
  /** Whether a provider exposes stable response IDs in non-streaming results. */
  readonly responseId?: 'required' | 'optional'
  /** Whether a provider exposes a concrete model ID/version in responses. */
  readonly actualModelId?: 'required' | 'optional'
  /** Whether the adapter supports structured output through `wrapOutputSchema`. */
  readonly structuredOutput?: 'required' | 'optional' | 'unsupported'
  /** Whether stream handles can report completion metadata without consuming the stream. */
  readonly streamCompletion?: 'required' | 'optional'
}

/** Prepared fake SDK state for a single conformance case. */
export interface AdapterConformancePrepared<TClient, TExtra extends Record<string, unknown>> {
  /** Provider client or SDK facade passed to the `AdapterSpec`. */
  readonly client: TClient
  /** Model identifier passed through `CallArgs.model`. */
  readonly model: string
  /** Provider request inspector bound to this prepared client. */
  readonly inspect: AdapterConformanceInspector
  /** Provider-specific extras to include in `CallArgs.extra`. */
  readonly extra?: TExtra
}

/**
 * Provider-owned bridge from abstract conformance scripts to SDK-shaped fakes.
 *
 * The harness is deliberately small: core defines canonical behavior, while
 * provider packages decide how a scripted emission becomes an OpenAI,
 * Anthropic, Google, or other provider raw response.
 */
export interface AdapterConformanceHarness<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Provider feature flags used to calibrate optional checks. */
  readonly capabilities?: AdapterConformanceCapabilities
  /** Create a fresh fake client/model/inspector for one isolated case. */
  prepare(
    script: AdapterConformanceScript,
  ):
    | Promise<AdapterConformancePrepared<TClient, TExtra>>
    | AdapterConformancePrepared<TClient, TExtra>
}
