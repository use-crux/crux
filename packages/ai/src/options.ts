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
  StopCondition as AiStopCondition,
  ToolChoice as AiToolChoice,
  ToolSet,
} from "ai";
import type { z } from "zod";
import type {
  Context,
  GenerationSettings,
  MergedInput,
  ResolvedPrompt,
  TimeoutOptions,
} from "@use-crux/core";
import type {
  FallbackModel,
  ToolMiddleware,
  ValidationRetryOptions,
} from "@use-crux/core";
import type { AnyRouterModel, CascadeModel } from "@use-crux/core/routing";
import type {
  Constraint,
  Guardrail,
  SafetyTuneOptions,
} from "@use-crux/core/safety";
import type { SdkGateway } from "./gateway";

type AiProviderOptions = Parameters<
  SdkGateway["generateText"]
>[0]["providerOptions"];
type AiHeaders = Parameters<SdkGateway["generateText"]>[0]["headers"];
type AiMaxRetries = Parameters<SdkGateway["generateText"]>[0]["maxRetries"];

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

/** Options for `generate()` and `stream()` with AI SDK models. */
export type AIGenerateOptions<
  TOwnInput extends z.ZodType,
  TContexts extends readonly Context<z.ZodType>[],
> = {
  /** The AI SDK language model to use. Supports `fallback()`, `router()`, and `cascade()` wrappers. */
  model:
    | LanguageModel
    | FallbackModel<LanguageModel>
    | AnyRouterModel<LanguageModel>
    | CascadeModel<LanguageModel>;
  /** Additional tools to merge at call time (highest precedence). */
  tools?: ToolSet;
  /** Tool middleware applied after prompt tools and call-site tools are merged. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[];
  /**
   * Message history override for resume flows such as tool approval.
   * Pass the prior assistant messages plus a `tool-approval-response` tool
   * message.
   */
  messages?: ResolvedPrompt["messages"];
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
} & GenerationSettings &
  ([keyof MergedInput<TOwnInput, TContexts>] extends [never]
    ? { input?: undefined }
    : { input: MergedInput<TOwnInput, TContexts> });

/** Model-bound prompt execution options with public inference preserved. */
