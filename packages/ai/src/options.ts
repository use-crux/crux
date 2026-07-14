/**
 * Public option contracts for the `@use-crux/ai` adapter.
 *
 * The root module re-exports these types, but keeping them here prevents the
 * package entrypoint from accumulating SDK-disposition details.
 *
 * @module
 */

import type {
  LanguageModel,
  ModelMessage,
  StopCondition as AiStopCondition,
  ToolChoice as AiToolChoice,
  ToolSet,
} from "ai";
import type { z } from "zod";
import type {
  ContextEntry,
  GenerationSettings,
  KnownToolsFor,
  Message,
  MergedInput,
  Prompt,
  TimeoutOptions,
  ToolsContextOption,
} from "@use-crux/core";
import type {
  FallbackModel,
  ToolApprovalMap,
  ToolMiddleware,
  ValidationRetryOptions,
} from "@use-crux/core";
import type { AnyRouterModel, CascadeModel } from "@use-crux/core/routing";
import type {
  RetryModel,
  RoutingCallOptions,
  SplitModel,
} from "@use-crux/core/routing";
import type {
  Constraint,
  Guardrail,
  SafetyTuneOptions,
} from "@use-crux/core/safety";
import type { SdkGateway } from "./gateway";
import type { SdkLoopResultLike } from "./sdk-codec";

type AiProviderOptions = Parameters<
  SdkGateway["generateText"]
>[0]["providerOptions"];
type AiHeaders = Parameters<SdkGateway["generateText"]>[0]["headers"];
type AiMaxRetries = Parameters<SdkGateway["generateText"]>[0]["maxRetries"];
type AiTransportParams =
  | Parameters<SdkGateway["generateText"]>[0]
  | Parameters<SdkGateway["generateObject"]>[0];
type AiTransportResult = SdkLoopResultLike;

/** Message history accepted by `@use-crux/ai` generation calls. */
export type AIMessageHistory = readonly Message[] | readonly ModelMessage[];

/** Metadata passed to an AI SDK adapter `transport` callback. */
export interface AITransportInfo {
  /** Zero-based SDK call index for this managed run. */
  readonly stepIndex: number;
  /** Concrete model id selected for this SDK call. */
  readonly modelId: string;
  /** Cooperative abort signal for this SDK call. */
  readonly signal: AbortSignal;
}

/** User-supplied AI SDK wire function for BYO transport mode. */
export type AITransport = (
  params: AiTransportParams,
  info: AITransportInfo,
) => Promise<AiTransportResult>;

/**
 * AI SDK-native, non-portable options for `generate()` and `stream()`.
 *
 * Portable settings such as `maxTokens`, `topK`, `stopSequences`, `seed`,
 * `toolChoice`, and `stopWhen` belong at the Crux call site. SDK-specific
 * values stay in `extra` so a prompt can move between adapters without hidden
 * dialect fields.
 */
export interface AIExtra extends Record<string, unknown> {
  /** AI SDK-native tool choice strategy. Prefer Crux `toolChoice` for portable calls. */
  readonly toolChoice?: AiToolChoice<ToolSet>;
  /** AI SDK-native stop conditions. Prefer Crux `stopWhen` for portable calls. */
  readonly stopWhen?:
    | AiStopCondition<ToolSet>
    | readonly AiStopCondition<ToolSet>[];
  /** AI SDK provider-specific options passed through to the underlying call. */
  readonly providerOptions?: AiProviderOptions;
  /** AI SDK HTTP headers passed through to HTTP-based providers. */
  readonly headers?: AiHeaders;
  /** AI SDK retry policy. Crux fallback/retry policy remains separate. */
  readonly maxRetries?: AiMaxRetries;
}

type AIPromptForOptions<
  TOwnInput extends z.ZodType,
  TContexts extends readonly ContextEntry[],
  TPromptTools extends Record<string, unknown> | undefined = Record<string, unknown> | undefined,
> = Prompt<TOwnInput, z.ZodType | undefined, TContexts, TPromptTools>;

interface AIGenerateBaseOptions<
  TCallTools extends ToolSet | undefined,
  TRuntimeContext,
  TModel,
> {
  /** The AI SDK language model to use. Supports Crux routing wrappers. */
  model: TModel;
  /** Additional tools to merge at call time (highest precedence). */
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
   * Message history override.
   *
   * Pass canonical Crux messages for Crux-owned resume flows, or AI SDK
   * `ModelMessage[]` from `convertToModelMessages()` to preserve native
   * file/image parts and provider options through the AI SDK loop.
   */
  messages?: AIMessageHistory;
  /**
   * Maximum tool-loop steps, identical to every Crux adapter.
   *
   * Portable `settings.maxSteps`/`maxSteps()` are normalized to the same
   * neutral stop-condition vocabulary before reaching the AI SDK.
   *
   * @defaultValue 10
   */
  maxSteps?: number;
  /** Restrict which tools the model can use. */
  activeTools?: readonly string[];
  /** AI SDK-native, non-portable options. */
  extra?: AIExtra;
  /** Token budget for system message. */
  tokenBudget?: number;
  /** Structured timeout budgets for this managed call. */
  timeout?: TimeoutOptions;
  /** User-supplied SDK call transport using this adapter's public codec params. */
  transport?: AITransport;
  /**
   * Validation-feedback retry for structured output.
   * Uses AI SDK's `experimental_repairText` for cheap text fixes first,
   * then falls back to LLM retry with corrective messages.
   */
  validationRetry?: ValidationRetryOptions;
  /** Per-call semantic constraints (highest precedence in the safety merge). */
  constraints?: Constraint[];
  /** Shared cap on total constraint retries across all constraints. */
  constraintMaxRetries?: number;
  /** Per-call guardrails (highest precedence in the safety merge). */
  guardrails?: Guardrail[];
  /** Per-call safety posture overrides keyed by policy id. */
  safety?: SafetyTuneOptions;
}

/** Options for `generate()` and `stream()` with AI SDK models. */
export type AIGenerateOptions<
  TOwnInput extends z.ZodType,
  TContexts extends readonly ContextEntry[],
  TCallTools extends ToolSet | undefined = ToolSet | undefined,
  TPrompt extends AIPromptForOptions<TOwnInput, TContexts> | undefined = undefined,
  TRuntimeContext = unknown,
  TModel =
    | LanguageModel
    | FallbackModel<LanguageModel>
    | AnyRouterModel<LanguageModel>
    | CascadeModel<LanguageModel>
    | SplitModel<Record<string, { model: LanguageModel; weight: number }>>
    | RetryModel<LanguageModel>,
> = {
} & Omit<AIGenerateBaseOptions<TCallTools, TRuntimeContext, TModel>, "toolsContext"> &
  ToolsContextOption<KnownToolsFor<TPrompt, TCallTools>> &
  GenerationSettings &
  RoutingCallOptions<TModel> &
  ([keyof MergedInput<TOwnInput, TContexts>] extends [never]
    ? { input?: undefined }
    : { input: MergedInput<TOwnInput, TContexts> });

/** Model-bound prompt execution options with public inference preserved. */
