/**
 * Public types for the core-step adapter factory.
 *
 * Keeping these contracts separate from `define-adapter.ts` lets the factory
 * stay focused on runtime wiring while the exported surface remains easy to
 * scan and document.
 *
 * @module
 */

import type { createCompositions } from "../agent/create-compositions";
import type { Message } from "../generation/messages";
import type { TimeoutOptions } from "../generation/timeout";
import type { GenerationSettings } from "../generation/types";
import type { AnyPrompt } from "../prompt/prompt-types";
import type { Constraint } from "../safety/constraint/types";
import type { Guardrail } from "../safety/guardrail/types";
import type { SafetyTuneOptions } from "../safety/tune";
import type { ToolMiddleware } from "../tools/types";
import type {
  KnownToolsFor,
  ToolsContextOption,
} from "../tools/context-types";
import type { ToolApprovalMap } from "../tools/approval-policy";
import type { AnyToolSet } from "../types";
import type { ValidationRetryOptions } from "../generation/validation-retry";
import type { GenerateResult, StreamResult } from "./result-accumulator";
import type { CallHandle } from "./call-handle";

/** Metadata passed to an adapter `transport` callback for one provider step. */
export interface AdapterTransportInfo {
  /** Zero-based model-call step index for this managed run. */
  readonly stepIndex: number;
  /** Concrete provider model id selected for this step. */
  readonly modelId: string;
  /** Cooperative abort signal for this provider step. */
  readonly signal: AbortSignal;
}

/** User-supplied provider wire function for BYO transport mode. */
export type AdapterTransport<TParams, TRawResponse> = (
  params: TParams,
  info: AdapterTransportInfo,
) => Promise<TRawResponse>;

/** Shared fields for adapter `generate()` calls before conditional tool context is applied. */
export interface AdapterGenerateBaseOptions<
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TCallTools extends AnyToolSet | undefined = AnyToolSet | undefined,
  TRuntimeContext = unknown,
  TParams = unknown,
  TRawResponse = unknown,
> {
  /** Model identifier passed to the provider's API. */
  model: string;
  /** Input for the prompt. */
  input?: Record<string, unknown>;
  /** Provider identifier for adaptation matching. Defaults to spec.providerId. */
  provider?: string;
  /** Token budget for system message. */
  tokenBudget?: number;
  /** Maximum tool loop iterations. Default: 10. */
  maxSteps?: number;
  /** Additional generation settings at call-site (highest precedence). */
  settings?: GenerationSettings;
  /** Provider-specific extra options. */
  extra?: TExtra;
  /** Additional messages to prepend (e.g., conversation history). */
  messages?: Message[];
  /** Additional tools to merge at call time after prompt/context tools. */
  tools?: TCallTools;
  /** Tool middleware applied after prompt tools and call-site tools are merged. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[];
  /** Call-site approval policy with final-word precedence over prompt/context declarations. */
  toolApproval?: ToolApprovalMap<TRuntimeContext>;
  /** Per-tool context values keyed by tools that declare `contextSchema`. */
  toolsContext?: Readonly<Record<string, unknown>>;
  /** Shared context threaded through tool execution, middleware, approvals, and step hooks. */
  runtimeContext?: TRuntimeContext;
  /**
   * Validation-feedback retry for structured output.
   * When set, failed Zod schema validation triggers a retry with
   * the error injected as a corrective message. Each retry counts
   * as a step against the `maxSteps` budget.
   */
  validationRetry?: ValidationRetryOptions;
  /**
   * Semantic constraints to check after structural (Zod) validation passes.
   * All constraints run in parallel; combined feedback is injected on retry.
   * Merged with per-prompt, context-level, and global constraints (per-call wins).
   */
  constraints?: Constraint[];
  /**
   * Shared cap on total constraint retries across all constraints.
   * Individual constraints also have their own `maxRetries`.
   */
  constraintMaxRetries?: number;
  /**
   * Guardrails to run on input/output during generation.
   * Merged with per-prompt, context-level, and global guardrails (per-call wins).
   */
  guardrails?: Guardrail[];
  /**
   * Per-call safety posture overrides keyed by policy id.
   *
   * Tune enforcement/reporting, stream posture, or whether a policy is
   * enabled for this call without replacing the policy logic.
   */
  safety?: SafetyTuneOptions;
  /** Structured timeout budgets for this managed call. */
  timeout?: TimeoutOptions;
  /** User-supplied provider call transport using this adapter's public codec params. */
  transport?: AdapterTransport<TParams, TRawResponse>;
}

/** Options for adapter `generate()` calls. */
export type AdapterGenerateOptions<
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TCallTools extends AnyToolSet | undefined = AnyToolSet | undefined,
  TPrompt extends AnyPrompt | undefined = undefined,
  TRuntimeContext = unknown,
  TParams = unknown,
  TRawResponse = unknown,
> = Omit<AdapterGenerateBaseOptions<TExtra, TCallTools, TRuntimeContext, TParams, TRawResponse>, "toolsContext"> &
  ToolsContextOption<KnownToolsFor<TPrompt, TCallTools>>;

/** Options for adapter `stream()` calls. */
export type AdapterStreamOptions<
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TCallTools extends AnyToolSet | undefined = AnyToolSet | undefined,
  TPrompt extends AnyPrompt | undefined = undefined,
  TRuntimeContext = unknown,
  TParams = unknown,
  TRawResponse = unknown,
> = AdapterGenerateOptions<TExtra, TCallTools, TPrompt, TRuntimeContext, TParams, TRawResponse>;

/** Result of an adapter `generate()` call. */
export type AdapterGenerateResult<
  TRawResponse,
  TOutput = unknown,
> = GenerateResult<TRawResponse, TOutput>;

/** The adapter interface returned by the factory. */
export interface CruxAdapter<
  TClient,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TParams = unknown,
> {
  /** Provider identifier from the spec. */
  readonly providerId: string;

  /** Execute a prompt (non-streaming) with automatic tool loop. */
  generate<
    TPrompt extends AnyPrompt,
    TCallTools extends AnyToolSet | undefined = undefined,
    TRuntimeContext = unknown,
  >(
    prompt: TPrompt,
    opts: AdapterGenerateOptions<TExtra, TCallTools, TPrompt, TRuntimeContext, TParams, TRawResponse>,
  ): Promise<AdapterGenerateResult<TRawResponse>>;

  /** Execute a prompt (streaming). */
  stream<
    TPrompt extends AnyPrompt,
    TCallTools extends AnyToolSet | undefined = undefined,
    TRuntimeContext = unknown,
  >(
    prompt: TPrompt,
    opts: AdapterStreamOptions<TExtra, TCallTools, TPrompt, TRuntimeContext, TParams, TRawResponse>,
  ): Promise<StreamResult<TRawStream>>;

  /** Prepare a sans-I/O provider call handle when the adapter exposes public codecs. */
  prepare?<
    TPrompt extends AnyPrompt,
    TCallTools extends AnyToolSet | undefined = undefined,
    TRuntimeContext = unknown,
  >(
    prompt: TPrompt,
    opts: AdapterGenerateOptions<TExtra, TCallTools, TPrompt, TRuntimeContext, TParams, TRawResponse>,
  ): Promise<CallHandle<TParams, TRawResponse, AdapterGenerateResult<TRawResponse | undefined>>>;

  /** Run multiple agents concurrently and merge results. */
  parallel: ReturnType<typeof createCompositions>["parallel"];

  /** Chain agents sequentially with typed data flow. */
  pipeline: ReturnType<typeof createCompositions>["pipeline"];

  /** Run multiple agents and pick a winner via voting. */
  consensus: ReturnType<typeof createCompositions>["consensus"];

  /** Run a swarm of agents with peer-to-peer routing via tool calls. */
  swarm: ReturnType<typeof createCompositions>["swarm"];
}
