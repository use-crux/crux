/**
 * Provider-neutral generation policy contracts.
 *
 * Owns the SDK-agnostic generation settings, provider adaptations, and
 * normalized result metadata that adapters read and write during a generate or
 * stream call. These types are intentionally provider-free: every adapter maps
 * them to and from its own SDK shape at the execution boundary.
 *
 * Drained from the root `types.ts` mega-module during the structure refactor;
 * the root module keeps a temporary `export type` re-export shim so existing
 * `./types` importers keep resolving unchanged.
 *
 * @module
 */

import type { ConstraintAudit } from "../safety/constraint/types";
import type { GuardrailAudit } from "../safety/guardrail/types";
import type { StopCondition, ToolChoice } from "./tool-control";

// ─────────────────────────────────────────────────────────────────
// Generation Settings
// ─────────────────────────────────────────────────────────────────

/**
 * SDK-agnostic generation settings.
 *
 * Common settings shared across AI providers. Each adapter maps these
 * to its SDK's expected field names (e.g. `maxTokens` → `max_tokens` for OpenAI).
 *
 * Merged with last-write-wins priority:
 * `config.settings` < `adapt.settings` < call-site overrides.
 *
 * Provider-specific options belong in each adapter's typed `extra` option so
 * prompt definitions remain portable across adapters.
 */
export interface GenerationSettings {
  /** Sampling temperature (0–2). Higher = more random. */
  temperature?: number;
  /** Maximum number of tokens to generate. */
  maxTokens?: number;
  /** Nucleus sampling threshold. */
  topP?: number;
  /** Top-K sampling. */
  topK?: number;
  /** Sequences that stop generation. */
  stopSequences?: readonly string[];
  /** Deterministic sampling seed, when supported by the selected provider. */
  seed?: number;
  /**
   * Portable reasoning-effort hint.
   *
   * Adapters map this to provider-native controls when the selected model
   * supports reasoning. Exact budgets, summaries, and provider-specific
   * disabling controls belong in the adapter's typed `extra` option.
   */
  reasoning?: 'low' | 'medium' | 'high';
  /**
   * Portable tool choice policy.
   *
   * Adapters map this to provider-native request fields. Provider-specific
   * variants belong in adapter `extra` options.
   */
  toolChoice?: ToolChoice;
  /**
   * Portable tool-loop stop condition(s). Arrays are OR-composed.
   *
   * Numeric {@link maxSteps} is kept as shorthand and normalized with this
   * field during adapter execution.
   */
  stopWhen?: StopCondition | readonly StopCondition[];
  /** Shorthand for `stopWhen: maxSteps(n)`. */
  maxSteps?: number;
  /** Penalize frequent tokens. */
  frequencyPenalty?: number;
  /** Penalize already-present tokens. */
  presencePenalty?: number;
}

// ─────────────────────────────────────────────────────────────────
// Provider Adaptation
// ─────────────────────────────────────────────────────────────────

/**
 * Provider-specific prompt modifications.
 *
 * Applied *after* system/prompt composition, allowing you to tweak the
 * final text for specific models without polluting business logic.
 */
export interface PromptAdaptation {
  /** Text prepended to the system message. */
  prependSystem?: string;
  /** Text appended to the system message. */
  appendSystem?: string;
  /** Text prepended to the user prompt. */
  prependPrompt?: string;
  /** Text appended to the user prompt. */
  appendPrompt?: string;
  /** Generation settings overrides for this provider. */
  settings?: GenerationSettings;
}

/**
 * Map of provider keys to their adaptations.
 *
 * Resolution priority: exact `provider` match → `modelId` prefix (for OpenRouter) → `'*'` wildcard.
 *
 * @example
 * ```ts
 * {
 *   anthropic: { appendSystem: '\nReturn raw JSON.' },
 *   openai: { settings: { temperature: 0.1 } },
 *   '*': { appendSystem: '\nJSON only.' },
 * }
 * ```
 */
export type ProviderAdaptations = {
  [provider: string]: PromptAdaptation;
};

// ─────────────────────────────────────────────────────────────────
// Token Usage & Trace Metadata
// ─────────────────────────────────────────────────────────────────

/** Token usage from an AI call. */
export interface TokenUsage {
  /** Total input, or prompt, tokens billed for the call. */
  inputTokens: number;
  /** Total output, or completion, tokens billed for the call. */
  outputTokens: number;
  /** Total billed tokens for the call. */
  totalTokens: number;
  /**
   * Breakdown of input-token classes.
   *
   * The object is always present when usage is present. Individual fields are
   * omitted when the provider did not report them; Crux does not fabricate
   * zeroes for missing detail counts.
   */
  inputTokenDetails: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  /**
   * Breakdown of output-token classes.
   *
   * The object is always present when usage is present. Individual fields are
   * omitted when the provider did not report them.
   */
  outputTokenDetails: {
    reasoningTokens?: number;
  };
}

/**
 * Normalized metadata attached to generate() results by each adapter.
 *
 * Adapters set `result._meta` after SDK calls so devtools middleware,
 * evals, and quality experiments can extract data without knowing which SDK
 * produced it.
 */
export interface TraceMeta {
  usage?: TokenUsage;
  /** Total cost in USD — only present when the provider returns it (e.g. OpenRouter). */
  cost?: number;
  finishReason?: string;
  /** Neutral stop condition that ended a tool loop, when Crux stopped before provider completion. */
  stoppedBy?: StopCondition;
  toolCalls?: Array<{ id?: string; name: string; args: unknown }>;
  responseId?: string;
  actualModelId?: string;
  /** Constraint audit trail — present when constraints ran during generation. */
  constraints?: ConstraintAudit;
  /** Guardrail audit trail — present when guardrails ran during generation. */
  guardrails?: GuardrailAudit;
}
