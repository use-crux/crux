/**
 * Core SDK-agnostic type surface.
 *
 * This module owns the provider-neutral generation contracts — base SDK
 * aliases, {@link GenerationSettings}, provider adaptation, runtime middleware,
 * the project tool catalog, and model metadata.
 *
 * Prompt/context authoring types live in the `prompt/` domain
 * (`prompt/context-types.ts`, `prompt/prompt-types.ts`, `prompt/type-utils.ts`),
 * and prompt resolution/inspection output contracts ({@link ResolvedPrompt},
 * {@link ResolveOptions}, {@link SystemBlock}, {@link InspectResult}, and the
 * dropped/excluded context shapes) live in the `resolver/` domain
 * (`resolver/types.ts`). Both are re-exported here so the many existing
 * `./types` importers keep resolving unchanged during the structure refactor.
 * This re-export shim is temporary: later phases drain the remaining contracts
 * (generation settings/adaptation, runtime middleware) into their own domain
 * type files and reduce this module to its intentional, minimal surface.
 *
 * @module
 */

import type { z } from 'zod'
import type { AnyPromptConfig } from './prompt/prompt-types'
import type { ResolvedPrompt } from './resolver/types'

// ─────────────────────────────────────────────────────────────────
// Prompt authoring re-export shim (owned by the `prompt/` domain)
// ─────────────────────────────────────────────────────────────────

export type {
  CacheOption,
  ContextTextSegment,
  ContextSystemContent,
  ContextSystemResult,
  ContextSystemArg,
  ContextDef,
  Context,
  ConditionalContext,
  MatchSpec,
  ContextEntry,
  PromptInjection,
  InjectableEntry,
  ContributorContribution,
  ContributorEntry,
  SkillEntry,
  MemoryEntry,
  BlackboardEntry,
  ContextTree,
} from './prompt/context-types'

export type {
  SemanticCacheMode,
  SemanticCacheQueryContext,
  SemanticCachePromptOptions,
  PromptCacheOptions,
  PromptInputArg,
  PromptConfig,
  PrepareHookArgs,
  GenerateHookArgs,
  ErrorHookArgs,
  PromptResult,
  PromptHooks,
  Prompt,
  AnyPrompt,
  AnyPromptConfig,
} from './prompt/prompt-types'

export type { Simplify, DeepReadonly, MergeContextInputs, MergedInput } from './prompt/type-utils'

// ─────────────────────────────────────────────────────────────────
// Resolver output re-export shim (owned by the `resolver/` domain)
// ─────────────────────────────────────────────────────────────────

export type {
  SystemBlock,
  ResolvedPrompt,
  ResolveOptions,
  DroppedContext,
  InspectPart,
  ExcludedContext,
  InspectResult,
} from './resolver/types'

// ─────────────────────────────────────────────────────────────────
// Base Types (SDK-agnostic)
// ─────────────────────────────────────────────────────────────────

/** SDK-agnostic model reference. Each adapter narrows this to its SDK's model type. */
export type AnyModel = unknown

/** SDK-agnostic tool set. Each adapter narrows this to its SDK's tool format. */
export type AnyToolSet = Record<string, unknown>

/** SDK-agnostic message for multi-turn prompts. */
export type AnyMessage = { role: string; content: unknown }

// ─────────────────────────────────────────────────────────────────
// Project Tool Catalog
// ─────────────────────────────────────────────────────────────────

/**
 * Declarative tool definition for the project tool catalog — name,
 * description, and parameter schema.
 *
 * These are plain data (no runtime implementation). Local tooling discovers
 * statically visible tool definitions from source so devtools and the project
 * index can present the tool surface alongside prompts and contexts.
 *
 * @example
 * ```ts
 * import { z } from 'zod'
 *
 * const searchDocs: FlowToolDef = {
 *   name: 'search_docs',
 *   description: 'Search the documentation index for relevant pages.',
 *   parameters: z.object({ query: z.string() }),
 * }
 * ```
 */
export interface FlowToolDef {
  /** Tool name as the model will see it. */
  name: string
  /** Description shown to the model. */
  description: string
  /** Zod schema for the tool's parameters. */
  parameters: z.ZodType
}

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
 * The index signature allows SDK-specific settings to pass through.
 */
export interface GenerationSettings {
  /** Sampling temperature (0–2). Higher = more random. */
  temperature?: number
  /** Maximum number of tokens to generate. */
  maxTokens?: number
  /** Nucleus sampling threshold. */
  topP?: number
  /** Top-K sampling. */
  topK?: number
  /** Sequences that stop generation. */
  stopSequences?: string[]
  /** Penalize frequent tokens. */
  frequencyPenalty?: number
  /** Penalize already-present tokens. */
  presencePenalty?: number
  /** Extensible — SDK-specific settings pass through. */
  [key: string]: unknown
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
  prependSystem?: string
  /** Text appended to the system message. */
  appendSystem?: string
  /** Text prepended to the user prompt. */
  prependPrompt?: string
  /** Text appended to the user prompt. */
  appendPrompt?: string
  /** Generation settings overrides for this provider. */
  settings?: GenerationSettings
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
export type AdapterMap = {
  [provider: string]: PromptAdaptation
}

// ─────────────────────────────────────────────────────────────────
// Token Usage & Trace Metadata
// ─────────────────────────────────────────────────────────────────

/** Token usage from an AI call. */
export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/**
 * Normalized metadata attached to generate() results by each adapter.
 *
 * Adapters set `result._meta` after SDK calls so devtools middleware,
 * evals, and quality experiments can extract data without knowing which SDK
 * produced it.
 */
export interface TraceMeta {
  usage?: TokenUsage
  /** Total cost in USD — only present when the provider returns it (e.g. OpenRouter). */
  cost?: number
  finishReason?: string
  toolCalls?: Array<{ id?: string; name: string; args: unknown }>
  responseId?: string
  actualModelId?: string
  /** Constraint audit trail — present when constraints ran during generation. */
  constraints?: import('./safety/constraint/types').ConstraintAudit
  /** Guardrail audit trail — present when guardrails ran during generation. */
  guardrails?: import('./safety/guardrail/types').GuardrailAudit
}

// ─────────────────────────────────────────────────────────────────
// Runtime Middleware
// ─────────────────────────────────────────────────────────────────

/**
 * Global middleware function that wraps every adapter `generate()` call.
 *
 * @example
 * ```ts
 * updateRuntime({
 *   middleware: async (args, next) => {
 *     const start = Date.now()
 *     const result = await next(args)
 *     console.log(`${args.promptId} took ${Date.now() - start}ms`)
 *     return result
 *   },
 * })
 * ```
 */
export interface PromptMiddlewareArgs {
  promptId: string | undefined
  preparedArgs: Record<string, unknown>
  operation?: 'generate' | 'stream'
  promptConfig?: AnyPromptConfig
  input?: Record<string, unknown>
  provider?: string
  model?: unknown
  resolved?: ResolvedPrompt
  outputMode?: 'text' | 'object'
  createCachedStreamResult?: (cached: {
    text?: string
    object?: unknown
    meta?: Record<string, unknown>
  }) => MiddlewareResult
}

/**
 * Heterogeneous middleware return value.
 *
 * Adapters return adapter-shaped objects (text + `_meta`, possibly `object` for
 * structured output). Middleware composes around these without knowing the
 * concrete shape, so the structural contract here covers the fields that
 * devtools/cache/etc. read on the way back.
 */
export interface MiddlewareResult {
  text?: string
  object?: unknown
  _meta?: TraceMeta & {
    streaming?: { ttftMs?: number; tokensPerSecond?: number; totalChunks?: number }
    fallback?: { attempts: number; failedModels: string[]; details: unknown[] }
    traceId?: string
    _streamCompletion?: Promise<MiddlewareResult>
    semanticCache?: Record<string, unknown>
  }
  [key: string]: unknown
}

export type PromptMiddleware = (
  args: PromptMiddlewareArgs,
  next: (args: PromptMiddlewareArgs) => Promise<MiddlewareResult>,
) => Promise<MiddlewareResult>

// ─────────────────────────────────────────────────────────────────
// Model Info (used by adapters and resolve pipeline)
// ─────────────────────────────────────────────────────────────────

/** Extracted provider and model ID, used for adaptation matching. */
export interface ModelInfo {
  /** Provider identifier (e.g. `"openai"`, `"anthropic"`, `"google"`). */
  provider: string
  /** Model identifier (e.g. `"gpt-4o"`, `"openai/gpt-4o"`). */
  modelId: string
}
