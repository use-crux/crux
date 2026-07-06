/**
 * Public contracts for provider-runtime conformance harnesses.
 *
 * Provider packages use these types to translate Crux's abstract conformance
 * scripts into SDK-shaped fake clients. Core owns the behavior being tested;
 * each provider owns only the raw response and request-capture shapes needed
 * for its SDK boundary.
 *
 * @module
 */

import type { AnyPrompt } from '../../prompt/prompt-types'
import type { GenerationSettings, TokenUsage, TraceMeta } from '../../generation/types'
import type { Message } from '../../generation/messages'
import type { ProviderOwnership } from '../provider-runtime'
import type { StepObserver } from '../executor-types'
import type { AdapterConformanceInspector } from './native-types'
import type { ValidationRetryOptions } from '../../generation/validation-retry'

/** Feature flags that calibrate a provider-runtime conformance run. */
export interface ProviderRuntimeConformanceCapabilities {
  /**
   * Which side owns the model/tool loop.
   *
   * `single-turn` runtimes expose one provider call per model turn and let
   * Crux drive tool loops. `loop-owned` runtimes hand the loop to an SDK and
   * receive steering through the executor contract.
   */
  readonly ownership: ProviderOwnership
  /** Run structured-output checks. */
  readonly structuredOutput?: boolean
  /** Run streaming checks. */
  readonly streaming?: boolean
  /** Run tool-call continuation checks. */
  readonly toolCalls?: boolean
  /** Run approval suspension checks. Requires `toolCalls`. */
  readonly approvalSuspension?: boolean
  /** Reserved for SDK-loop step steering checks. */
  readonly observerDirectives?: boolean
  /** Reserved for provider-native prompt/cache behavior checks. */
  readonly providerCache?: boolean
}

/** One model emission consumed by a conformance script. */
export interface ProviderConformanceEmission {
  /** Assistant text for this model turn. */
  readonly text?: string
  /** Tool calls requested by the assistant, in canonical intent form. */
  readonly toolCalls?: ReadonlyArray<{
    readonly id?: string
    readonly name: string
    readonly args: unknown
  }>
  /** Optional usage data for harnesses that support per-emission usage. */
  /** Use `null` when the scripted provider response intentionally omits usage. */
  readonly usage?: TokenUsage | null
}

/** Abstract provider behavior for one isolated conformance case. */
export interface ProviderConformanceScript {
  /** Marks the provider-cache boundary scenario for harness-specific setup. */
  readonly providerCache?: boolean
  /** Non-streaming model turns, consumed in order by generation calls. */
  readonly emissions?: readonly ProviderConformanceEmission[]
  /** Raw structured-output texts, consumed by structured generation calls. */
  readonly structuredTexts?: readonly string[]
  /** Streaming text deltas, consumed by stream calls. */
  readonly streamChunks?: readonly string[]
}

/** Prepared fake SDK state for one conformance case. */
export interface ProviderConformancePrepared<
  TClient,
  TModel,
  TDeps extends Record<string, unknown> = Record<string, never>,
> {
  /** Provider client, SDK gateway, or facade passed to `runtime.create()`. */
  readonly client: TClient
  /** Concrete model argument passed to `generate()` and `stream()`. */
  readonly model: TModel
  /** Provider runtime dependencies, when `runtime.create()` requires them. */
  readonly deps?: TDeps
  /** Optional provider request inspector for boundary-level request checks. */
  readonly inspect?: AdapterConformanceInspector
}

/**
 * Provider-owned bridge from abstract scripts to SDK-shaped fakes.
 *
 * The harness deliberately has a small surface: it prepares a fresh client
 * and model for one conformance case, while the shared runner performs the
 * public `generate()` / `stream()` assertions.
 */
export interface ProviderRuntimeConformanceHarness<
  TClient,
  TModel = string,
  TDeps extends Record<string, unknown> = Record<string, never>,
> {
  /** Capabilities enabled for this provider runtime. */
  readonly capabilities?: ProviderRuntimeConformanceCapabilities
  /**
   * Provider-owned cache-boundary assertion.
   *
   * Core owns the cached-prefix scenario; each provider owns the native request
   * shape. Return `undefined` when the captured request is correct, or a short
   * diagnostic string when it violates the provider's cache contract.
   */
  readonly providerCache?: {
    assertRequest(body: unknown): string | undefined
  }
  /** Create a fresh fake client/model pair for one isolated case. */
  prepare(
    script: ProviderConformanceScript,
  ): Promise<ProviderConformancePrepared<TClient, TModel, TDeps>> | ProviderConformancePrepared<TClient, TModel, TDeps>
}

/** Minimal generation surface every public provider runtime exposes. */
export interface ProviderRuntimeConformanceRuntime<TModel> {
  /** Execute one conformance prompt. */
  generate(
    prompt: AnyPrompt,
    options: ProviderRuntimeConformanceGenerateOptions<TModel>,
  ): Promise<ProviderRuntimeConformanceGenerateResult>
  /** Start one conformance stream. */
  stream(
    prompt: AnyPrompt,
    options: ProviderRuntimeConformanceGenerateOptions<TModel>,
  ): Promise<ProviderRuntimeConformanceStreamHandle>
}

/** Generation options used by the conformance runner. */
export interface ProviderRuntimeConformanceGenerateOptions<TModel> {
  /** Concrete provider model for this case. */
  readonly model: TModel
  /** Prompt input. */
  readonly input?: Record<string, unknown>
  /** Call-site tools to merge into the prompt run. */
  readonly tools?: Record<string, unknown>
  /** Maximum model/tool loop steps. */
  readonly maxSteps?: number
  /** Call-site settings. */
  readonly settings?: GenerationSettings
  /** Optional transcript continuation. */
  readonly messages?: Message[]
  /** Validation retry policy for structured-output checks. */
  readonly validationRetry?: ValidationRetryOptions
  /** Loop-owned step observer for directive checks. */
  readonly observer?: StepObserver
}

/** Public result fields shared by single-turn and loop-owned runtimes. */
export interface ProviderRuntimeConformanceGenerateResult {
  /** Final assistant text. */
  readonly text: string
  /** Parsed structured output, when the prompt declares one. */
  readonly object?: unknown
  /** Normalized generation metadata. */
  readonly _meta: TraceMeta
  /** Budget-consuming steps used by the run. */
  readonly steps: number
  /** Canonical transcript returned by the runtime. */
  readonly messages: readonly Message[]
  /** Approval requests when a tool call suspended before execution. */
  readonly pendingApprovals?: readonly unknown[]
}

/** Stream handle fields the runner can inspect without provider knowledge. */
export interface ProviderRuntimeConformanceStreamHandle {
  /** Single-turn adapters expose their raw provider stream here. */
  readonly rawStream?: AsyncIterable<unknown>
  /** Loop-owned executors expose the SDK stream result here. */
  readonly raw?: unknown
  /** Optional provider-neutral text delta extractor. */
  readonly extractTextDelta?: (chunk: unknown) => string | undefined
  /** Stream completion metadata, if the runtime can report it. */
  completion(): Promise<unknown>
}
