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

import type { ModelInfo } from "../../types";
import type { AnyPrompt } from "../../prompt/prompt-types";
import type {
  GenerationMeta,
  GenerationSettings,
  TokenUsage,
} from "../../generation/types";
import type { WithOperationResultMeta } from "../../observability/result-meta";
import type { TimeoutOptions } from "../../generation/timeout";
import type { Message } from "../../generation/messages";
import type { AssistantContentPart } from "../../types/content";
import type { ValidationRetryOptions } from "../../generation/validation-retry";
import type { Constraint } from "../../safety/constraint/types";
import type { Guardrail } from "../../safety/guardrail/types";
import type { SafetyTuneOptions } from "../../safety/tune";
import type { ToolMiddleware } from "../../tools/types";
import type { ToolApprovalMap } from "../../tools/approval-policy";
import type { StreamHandle } from "../types";
import type { ExecutorStreamHandle, StepObserver } from "../executor-types";
import type { ApprovalRequestInfo } from "../tool/approval";
import type { FinalStepInfo } from "../result-accumulator";
import type { CallHandle } from "../call-handle";
import type { CruxRunId } from "../../observability";

export type ExecutionResolveOpts = Parameters<AnyPrompt["resolve"]>[0];

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
  readonly prompt: AnyPrompt;

  /** Model string or SDK-native model reference supplied by the caller. */
  readonly model: TModel;

  /** Precomputed model identity; primarily used by `core-step` adapters. */
  readonly modelInfo?: ModelInfo;

  /** Prompt input passed to `prompt.resolve()` and tracing middleware. */
  readonly input?: Record<string, unknown>;

  /** Provider override for prompt adaptation; defaults to the dialect id. */
  readonly provider?: string;

  /** Token budget exposed to prompt resolution. */
  readonly tokenBudget?: number;

  /** Maximum loop iterations before generation stops. Defaults to 10. */
  readonly maxSteps?: number;

  /** Call-site generation settings merged by the prompt before mapping. */
  readonly settings?: GenerationSettings;

  /** Provider-specific options forwarded to dialect calls. */
  readonly extra?: TExtra;

  /** Existing conversation history to continue. */
  readonly messages?: Message[];

  /**
   * SDK-native history for loop-owned adapters with a native message edge.
   * Execution modules keep canonical `messages` for policy and results; only
   * the owning runtime may interpret this payload.
   */
  readonly nativeMessages?: readonly unknown[];

  /** Additional tools merged after prompt/context tools. */
  readonly tools?: Record<string, unknown>;

  /** Per-tool context values keyed by tools that declare `contextSchema`. */
  readonly toolsContext?: Readonly<Record<string, unknown>>;

  /** Shared context threaded through tool execution, middleware, approvals, and step hooks. */
  readonly runtimeContext?: unknown;

  /** Tool middleware applied to the merged tool set. */
  readonly toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[];

  /** Call-site approval policy with final-word precedence over prompt/context declarations. */
  readonly toolApproval?: ToolApprovalMap;

  /** Corrective retry policy for structured-output validation failures. */
  readonly validationRetry?: ValidationRetryOptions;

  /** Per-call semantic constraints composed by the Safety registry. */
  readonly constraints?: Constraint[];

  /** Shared retry cap for semantic constraint corrections. */
  readonly constraintMaxRetries?: number;

  /** Per-call guardrails composed by the Safety registry. */
  readonly guardrails?: Guardrail[];

  /** Per-call safety posture overrides keyed by policy id. */
  readonly safety?: SafetyTuneOptions;

  /** Structured timeout budgets for managed execution. */
  readonly timeout?: TimeoutOptions;

  /** Outer routing deadline signal for the whole caller-visible operation. */
  readonly signal?: AbortSignal;

  /** Optional observer for SDK-loop step events. */
  readonly observer?: StepObserver;

  /** Optional active-tool allowlist forwarded to SDK-loop executors. */
  readonly activeTools?: readonly string[];
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
  /** Authoritative Crux observability run opened for this generation. */
  readonly runId: CruxRunId;
  /** Underlying provider/SDK response, when the run completed. */
  readonly raw: TRawResponse | undefined;

  /** Final assistant text after validation and safety processing. */
  readonly text: string;
  /** Exact ordered assistant output; `text` is its text-only projection. */
  readonly content: readonly AssistantContentPart[];

  /** Parsed structured output, present when the prompt has an output schema. */
  readonly object?: unknown;

  /** Provider-neutral generation facts before operation correlation. */
  _meta: GenerationMeta;

  /** Usage accumulated across all provider-call steps, when fully metered. */
  readonly usage?: TokenUsage;

  /** Provider-reported cost promoted from `_meta`, when present. */
  readonly cost?: GenerationMeta["cost"];

  /** Ordered model-attempt or loop-step facts. */
  readonly steps: readonly FinalStepInfo[];

  /** Facts from the final provider-call step. */
  readonly finalStep: FinalStepInfo;

  /** Provider-agnostic Crux message history for resume or memory capture. */
  readonly messages: readonly Message[];
  /** Non-fatal warnings accumulated in execution order. */
  readonly warnings: readonly unknown[];
  /** Provider-owned metadata from the terminal step, when supplied. */
  readonly providerMetadata?: unknown;

  /** Tool approval requests when execution suspended instead of completing. */
  readonly pendingApprovals?: readonly ApprovalRequestInfo[];
}

/** Internal result shape produced before orchestration stamps the run ID. */
export type AdapterExecutionGenerateResultWithoutRunId<TRawResponse> = Omit<
  AdapterExecutionGenerateResult<TRawResponse>,
  "runId"
>;

/** Core-observed execution result returned after generation orchestration. */
export type ObservedAdapterExecutionGenerateResult<TRawResponse> =
  WithOperationResultMeta<AdapterExecutionGenerateResult<TRawResponse>>;

/**
 * Stream handle returned by either execution dialect.
 *
 * Core-step adapters expose the raw provider stream through `StreamHandle`.
 * SDK-loop adapters expose the executor stream contract, including completion
 * metadata produced by that SDK.
 */
export type AdapterExecutionStreamResult<TRawStream> =
  | (WithOperationResultMeta<StreamHandle<TRawStream>> &
      Readonly<{ runId: CruxRunId }>)
  | ExecutorStreamHandle<TRawStream>;

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
  TParams = unknown,
> {
  /** Run a prompt to completion, including tools, validation retry, and safety. */
  generate(
    args: AdapterExecutionGenerateArgs<TModel, TExtra>,
  ): Promise<ObservedAdapterExecutionGenerateResult<TRawResponse>>;

  /** Start a streaming prompt run and wrap completion for safety/memory capture. */
  stream(
    args: AdapterExecutionStreamArgs<TModel, TExtra>,
  ): Promise<AdapterExecutionStreamResult<TRawStream>>;

  /** Prepare a sans-I/O call handle when the dialect exposes public codecs. */
  prepare?(
    args: AdapterExecutionGenerateArgs<TModel, TExtra>,
  ): Promise<
    CallHandle<
      TParams,
      TRawResponse,
      ObservedAdapterExecutionGenerateResult<TRawResponse>
    >
  >;
}
