/**
 * Public contracts for loop-owning provider executors.
 *
 * @module
 */

import type { createCompositions } from "../agent/create-compositions";
import type { FallbackModel } from "../generation/fallback";
import type { Message } from "../generation/messages";
import type { TimeoutOptions } from "../generation/timeout";
import type { GenerationSettings } from "../generation/types";
import type { CruxRunId } from "../observability";
import type {
  AnyRouterModel,
  CascadeModel,
  RetryModel,
  RoutingCallOptions,
  SplitModel,
} from "../routing";
import type { Constraint } from "../safety/constraint/types";
import type { Guardrail } from "../safety/guardrail/types";
import type { SafetyTuneOptions } from "../safety/tune";
import type { ToolApprovalMap } from "../tools/approval-policy";
import type { ToolMiddleware } from "../tools/types";
import type { ValidationRetryOptions } from "../generation/validation-retry";
import type { AnyPrompt } from "../prompt/prompt-types";
import type { ExecutorStreamHandle, StepObserver } from "./executor-types";
import type { GenerateResult } from "./result-accumulator";
import type { ModelCapacityProfile } from "../request/capacity/model-profile";
import type { InputBudget } from "../request/budget/input-budget";

/**
 * Model argument accepted by a loop-owning executor.
 *
 * Routing is resolved before the provider runtime receives a concrete model.
 */
export type ExecutorModelArg<TModel> =
  | TModel
  | FallbackModel<TModel>
  | AnyRouterModel<TModel>
  | CascadeModel<TModel>
  | SplitModel<Record<string, { model: TModel; weight: number }>>
  | RetryModel<TModel>;

/** Shared fields for executor `generate()` and `stream()` calls. */
export interface ExecutorGenerateBaseOptions<
  TModel,
  TSelectedModel = ExecutorModelArg<TModel>,
> {
  /** Plain model or Core routing wrapper to execute. */
  model: TSelectedModel;
  /** Input for the prompt. */
  input?: Record<string, unknown>;
  /** Additional Tools merged at call time with highest precedence. */
  tools?: Record<string, unknown>;
  /** Per-Tool context values keyed by Tools that declare `contextSchema`. */
  toolsContext?: Readonly<Record<string, unknown>>;
  /** Shared context threaded through Tool execution and callbacks. */
  runtimeContext?: unknown;
  /** Tool middleware applied after prompt and call-site Tools are merged. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[];
  /** Call-site approval policy with final-word precedence. */
  toolApproval?: ToolApprovalMap;
  /** Message history used for continuations and approval resumption. */
  messages?: Message[];
  /** Maximum loop steps. Refunded steps do not count. @defaultValue 10 */
  maxSteps?: number;
  /** Call-site generation settings with highest precedence. */
  settings?: GenerationSettings;
  /** Token budget for the system message. */
  /** Whole-request input pressure settings for each provider call. */
  inputBudget?: InputBudget;
  /** Structured timeout budgets for this managed call. */
  timeout?: TimeoutOptions;
  /**
   * Caller-owned cooperative cancellation signal.
   *
   * When combined with structured timeouts or routing signals, the first
   * cancellation source wins. Cancellation is cooperative; provider or Tool
   * code that ignores the signal may continue after the caller settles.
   *
   * @defaultValue `undefined`
   */
  readonly signal?: AbortSignal;
  /** Validation-feedback retry policy for structured output. */
  validationRetry?: ValidationRetryOptions;
  /** Semantic constraints checked after structural validation. */
  constraints?: Constraint[];
  /** Shared cap on total retries across all constraints. */
  constraintMaxRetries?: number;
  /** Guardrails applied to generation input and output. */
  guardrails?: Guardrail[];
  /** Per-call safety posture overrides keyed by policy id. */
  safety?: SafetyTuneOptions;
  /** Per-step steering observer composed after Crux-owned steering. */
  observer?: StepObserver;
  /** Restrict which Tools the model may call. */
  activeTools?: readonly string[];
  /** Provider-runtime passthrough options. */
  extra?: Record<string, unknown>;
}

/** Options for executor `generate()` calls. */
export type ExecutorGenerateOptions<
  TModel,
  TSelectedModel = ExecutorModelArg<TModel>,
> = ExecutorGenerateBaseOptions<TModel, TSelectedModel> &
  RoutingCallOptions<TSelectedModel>;

/** Options for executor `stream()` calls. */
export type ExecutorStreamOptions<
  TModel,
  TSelectedModel = ExecutorModelArg<TModel>,
> = ExecutorGenerateOptions<TModel, TSelectedModel>;

/** Result of an executor `generate()` call. */
export type ExecutorGenerateResult<TRawResponse> = GenerateResult<
  TRawResponse | undefined
>;

/** SDK-owned stream handle stamped by the authoritative Crux run span. */
export type ExecutorStreamResult<TRawStream> =
  ExecutorStreamHandle<TRawStream> & {
    readonly runId: CruxRunId;
  };

/** Executor returned by a loop-owning provider-runtime factory. */
export interface CruxExecutor<
  TModel,
  TRawResponse = unknown,
  TRawStream = unknown,
> {
  /** Stable provider-runtime identifier. */
  readonly executorId: string;
  /**
   * Report capacity facts for a concrete SDK model reference without I/O.
   *
   * @param model - Concrete model understood by the SDK runtime.
   * @returns Capacity facts used for whole-request budget derivation.
   */
  capacity(model: TModel): ModelCapacityProfile;
  /** Execute a prompt through the provider-owned language loop. */
  generate(
    prompt: AnyPrompt,
    opts: ExecutorGenerateOptions<TModel>,
  ): Promise<ExecutorGenerateResult<TRawResponse>>;
  /** Start one managed logical stream. */
  stream(
    prompt: AnyPrompt,
    opts: ExecutorStreamOptions<TModel>,
  ): Promise<ExecutorStreamResult<TRawStream>>;
  /** Run multiple agents concurrently and merge results. */
  parallel: ReturnType<typeof createCompositions>["parallel"];
  /** Chain agents sequentially with typed data flow. */
  pipeline: ReturnType<typeof createCompositions>["pipeline"];
  /** Run multiple agents and pick a winner through voting. */
  consensus: ReturnType<typeof createCompositions>["consensus"];
  /** Run a peer-routed agent swarm. */
  swarm: ReturnType<typeof createCompositions>["swarm"];
}
