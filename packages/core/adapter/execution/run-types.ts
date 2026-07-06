/**
 * Internal execution argument and result types.
 *
 * Public adapter factories translate user-facing options into these shapes.
 * The execution modules then apply prompt resolution, tools, safety, retries,
 * orchestration, metadata, and memory capture around each concrete model run.
 *
 * @internal
 * @module
 */

import type { ModelInfo } from '../../types'
import type { AnyPrompt } from '../../prompt/prompt-types'
import type { GenerationSettings, TraceMeta } from '../../generation/types'
import type { TokenUsage } from '../../generation/types'
import type { TimeoutOptions } from '../../generation/timeout'
import type { Message } from '../../generation/messages'
import type { ValidationRetryOptions } from '../../generation/validation-retry'
import type { Constraint } from '../../safety/constraint/types'
import type { Guardrail } from '../../safety/guardrail/types'
import type { SafetyTuneOptions } from '../../safety/tune'
import type { ToolMiddleware } from '../../tools/types'
import type { StreamHandle } from '../types'
import type { ExecutorStreamHandle, StepObserver } from '../executor-types'
import type { ApprovalRequestInfo } from '../tool/approval'
import type { FinalStepInfo } from '../result-accumulator'

export type ExecutionResolveOpts = Parameters<AnyPrompt['resolve']>[0]

/**
 * Arguments for one non-streaming execution attempt.
 *
 * The public factories translate their user-facing option bags into this
 * shape. The session then performs every shared concern around the dialect:
 * resolving the prompt, merging tools, enforcing safety, invoking middleware,
 * and capturing the completed turn.
 *
 * @typeParam TModel - Model identifier or SDK-native model reference.
 * @typeParam TExtra - Provider-specific per-call options for `core-step`.
 */
export interface AdapterExecutionGenerateArgs<
  TModel,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Prompt definition to resolve for this run. */
  readonly prompt: AnyPrompt

  /** Model string or SDK-native model reference supplied by the caller. */
  readonly model: TModel

  /** Precomputed model identity; primarily used by `core-step` adapters. */
  readonly modelInfo?: ModelInfo

  /** Prompt input passed to `prompt.resolve()` and tracing middleware. */
  readonly input?: Record<string, unknown>

  /** Provider override for prompt adaptation; defaults to the dialect id. */
  readonly provider?: string

  /** Token budget exposed to prompt resolution. */
  readonly tokenBudget?: number

  /** Maximum loop iterations before generation stops. Defaults to 10. */
  readonly maxSteps?: number

  /** Call-site generation settings merged by the prompt before mapping. */
  readonly settings?: GenerationSettings

  /** Provider-specific options forwarded to dialect calls. */
  readonly extra?: TExtra

  /** Existing conversation history to continue. */
  readonly messages?: Message[]

  /** Additional tools merged after prompt/context tools. */
  readonly tools?: Record<string, unknown>

  /** Tool middleware applied to the merged tool set. */
  readonly toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[]

  /** Corrective retry policy for structured-output validation failures. */
  readonly validationRetry?: ValidationRetryOptions

  /** Per-call semantic constraints composed by the Safety registry. */
  readonly constraints?: Constraint[]

  /** Shared retry cap for semantic constraint corrections. */
  readonly constraintMaxRetries?: number

  /** Per-call guardrails composed by the Safety registry. */
  readonly guardrails?: Guardrail[]

  /** Per-call safety posture overrides keyed by policy id. */
  readonly safety?: SafetyTuneOptions

  /** Structured timeout budgets for managed execution. */
  readonly timeout?: TimeoutOptions

  /** Optional observer for SDK-loop step events. */
  readonly observer?: StepObserver

  /** Optional active-tool allowlist forwarded to SDK-loop executors. */
  readonly activeTools?: readonly string[]
}

/**
 * Arguments for one streaming execution attempt.
 *
 * Streaming accepts the same prepared option set as non-streaming execution;
 * dialect-specific stream methods decide how to expose the raw stream handle.
 */
export interface AdapterExecutionStreamArgs<
  TModel,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> extends AdapterExecutionGenerateArgs<TModel, TExtra> {}

/**
 * Normalized non-streaming result returned by the execution session.
 *
 * `raw` is undefined only for SDK-loop runs that suspend for tool approval
 * before the SDK produces a completed result. In all other cases it is the
 * underlying provider or SDK response.
 *
 * @typeParam TRawResponse - Provider or SDK response type.
 */
export interface AdapterExecutionGenerateResult<TRawResponse> {
  /** Underlying provider/SDK response, when the run completed. */
  readonly raw: TRawResponse | undefined

  /** Final assistant text after validation and safety processing. */
  readonly text: string

  /** Parsed structured output, present when the prompt has an output schema. */
  readonly object?: unknown

  /** Trace metadata stamped with safety and provider information. */
  _meta: TraceMeta

  /** Usage accumulated across all provider-call steps, when fully metered. */
  readonly usage?: TokenUsage

  /** Provider-reported cost promoted from `_meta`, when present. */
  readonly cost?: TraceMeta['cost']

  /** Number of model attempts or loop steps consumed by the run. */
  readonly steps: number

  /** Facts from the final provider-call step. */
  readonly finalStep: FinalStepInfo

  /** Provider-agnostic Crux message history for resume or memory capture. */
  readonly messages: Message[]

  /** Tool approval requests when execution suspended instead of completing. */
  readonly pendingApprovals?: readonly ApprovalRequestInfo[]
}

/**
 * Stream handle returned by either execution dialect.
 *
 * Core-step adapters expose the raw provider stream through `StreamHandle`.
 * SDK-loop adapters expose the executor stream contract, including completion
 * metadata produced by that SDK.
 */
export type AdapterExecutionStreamResult<TRawStream> = StreamHandle<TRawStream> | ExecutorStreamHandle<TRawStream>

/**
 * Shared execution facade used by `adapter()` and `loopRuntimeAdapter()`.
 *
 * A single facade instance is bound to one dialect/client pair and can execute
 * many prompts. It contains no routing policy; fallback/router/cascade wrappers
 * choose which concrete model attempt reaches this session.
 */
export interface AdapterExecution<
  TModel,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Run a prompt to completion, including tools, validation retry, and safety. */
  generate(args: AdapterExecutionGenerateArgs<TModel, TExtra>): Promise<AdapterExecutionGenerateResult<TRawResponse>>

  /** Start a streaming prompt run and wrap completion for safety/memory capture. */
  stream(args: AdapterExecutionStreamArgs<TModel, TExtra>): Promise<AdapterExecutionStreamResult<TRawStream>>
}
