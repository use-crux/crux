/**
 * Core SDK-agnostic type surface.
 *
 * This module owns the provider-neutral generation/resolution contracts —
 * base SDK aliases, {@link GenerationSettings}, provider adaptation,
 * {@link ResolvedPrompt}/{@link InspectResult}, runtime middleware, and model
 * metadata.
 *
 * Prompt/context authoring types now live in the `prompt/` domain
 * (`prompt/context-types.ts`, `prompt/prompt-types.ts`, `prompt/type-utils.ts`).
 * They are re-exported here so the many existing `./types` importers keep
 * resolving unchanged during the structure refactor. This re-export shim is
 * temporary: later phases drain the remaining contracts into their own domain
 * type files and reduce this module to its intentional, minimal surface.
 *
 * @module
 */

import type { z } from 'zod'
import type { CruxArtifactId, CruxContextInjectableKind } from './observability/contract'
import type { ToolMiddleware } from './tool-middleware'
import type { ContextEntry, ContextTextSegment, MemoryEntry } from './prompt/context-types'
import type { AnyPromptConfig } from './prompt/prompt-types'
import type { MergedInput } from './prompt/type-utils'

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
// Base Types (SDK-agnostic)
// ─────────────────────────────────────────────────────────────────

/** SDK-agnostic model reference. Each adapter narrows this to its SDK's model type. */
export type AnyModel = unknown

/** SDK-agnostic tool set. Each adapter narrows this to its SDK's tool format. */
export type AnyToolSet = Record<string, unknown>

/** SDK-agnostic message for multi-turn prompts. */
export type AnyMessage = { role: string; content: unknown }

// ─────────────────────────────────────────────────────────────────
// System Blocks
// ─────────────────────────────────────────────────────────────────

/**
 * A typed block within the resolved system message.
 *
 * Each context contribution and the prompt's own system text become
 * separate blocks. Adapters that support provider caching (e.g., Anthropic)
 * use `providerCache` to emit native cache markers on each block.
 */
export interface SystemBlock {
  /** Where this block came from: `'prompt'` or `'context:<id>'`. */
  readonly source: string
  /** The resolved text content of this block. */
  readonly text: string
  /** Whether the LLM provider should cache this block. */
  readonly providerCache: boolean
  /** Canonical observability artifact for this block, when emitted during prompt resolution. */
  readonly artifactId?: CruxArtifactId
  /** Segmented static/dynamic text for this block, when available. */
  readonly segments?: readonly ContextTextSegment[]
  /** Estimated tokens for static segments. */
  readonly staticTokens?: number
  /** Estimated tokens for dynamic segments. */
  readonly dynamicTokens?: number
}

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
// Resolved Prompt (returned by .resolve())
// ─────────────────────────────────────────────────────────────────

/**
 * SDK-agnostic resolved prompt data — the output of `.resolve()`.
 *
 * Contains everything needed to make an SDK call: assembled system message,
 * user prompt, output schema, merged tools, and merged settings.
 * Does NOT include a model reference — that's an adapter concern.
 *
 * @example
 * ```ts
 * const resolved = myPrompt.resolve({ input: { ... }, tokenBudget: 4000 })
 * // Use with any SDK:
 * await generateObject({ model: myModel, ...resolved })
 * ```
 */
export interface ResolvedPrompt {
  /** The assembled system message (own system + context contributions + adaptations). */
  system?: string
  /** The user prompt text (if using system+prompt mode). */
  prompt?: string
  /** Multi-turn messages (if using messages mode). */
  messages?: AnyMessage[]
  /** The Zod output schema for structured generation. */
  schema?: z.ZodType
  /** Merged tools from contexts and config. */
  tools?: AnyToolSet
  /** Middleware applied to merged tools before adapter execution. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[]
  /** Tool choice strategy from config. */
  toolChoice?: unknown
  /** Stop condition from config. */
  stopWhen?: unknown
  /** Tool name filter. */
  activeTools?: string[]
  /** Merged generation settings (config < adapt < call-site). */
  settings: GenerationSettings
  /**
   * Structured system blocks — same content as `system` but with per-block
   * source attribution and provider cache hints. Adapters that support caching
   * (e.g., Anthropic) use this to emit native cache breakpoints. Adapters that
   * don't need caching can ignore this and use the flat `system` string.
   *
   * Only present when `system` is present. Joining all `block.text` with
   * `\n\n` produces the `system` string.
   */
  systemBlocks?: readonly SystemBlock[]
  /** Prompt budget artifact emitted while resolving this prompt, when token-budget decisions were recorded. */
  promptBudgetArtifactId?: CruxArtifactId
  /** Constraints collected from prompt config + contexts (merged at resolution). */
  constraints?: import('./safety/constraint/types').Constraint[]
  /** Guardrails collected from prompt config + contexts (merged at resolution). */
  guardrails?: import('./safety/guardrail/types').Guardrail[]
  /** Metadata contributed by injectable `use` entries during resolution. */
  metadata?: Readonly<Record<string, unknown>>
  /** Stateful memory entries used by this prompt. Adapters use these for post-generation capture. */
  memoryBindings?: Array<{
    memory: MemoryEntry
    input: Record<string, unknown>
    promptId?: string
  }>
}

// ─────────────────────────────────────────────────────────────────
// Resolve Options
// ─────────────────────────────────────────────────────────────────

/**
 * Options passed to `.resolve()` and `.inspect()`.
 *
 * SDK-agnostic — no model reference. Adapters add model and SDK-specific
 * fields in their own options types.
 */
export type ResolveOptions<TOwnInput extends z.ZodType, TContexts extends readonly ContextEntry[]> = {
  /**
   * Provider identifier for adaptation matching (e.g. `'openai'`, `'anthropic'`).
   * Adapters auto-detect this from the model; set manually when using `.resolve()` directly.
   */
  provider?: string
  /**
   * Model ID for adaptation matching (e.g. `'gpt-4o'`, `'openai/gpt-4o'`).
   * Used for OpenRouter-style `modelId` prefix matching in the `adapt` map.
   */
  modelId?: string
  /**
   * Optional token budget for the system message. When set, contexts are
   * sorted by priority and lowest-priority ones are dropped until the
   * assembled system message fits within the budget.
   */
  tokenBudget?: number
} & GenerationSettings &
  ([keyof MergedInput<TOwnInput, TContexts>] extends [never]
    ? { input?: undefined }
    : { input: MergedInput<TOwnInput, TContexts> })

// ─────────────────────────────────────────────────────────────────
// Inspect Result
// ─────────────────────────────────────────────────────────────────

/** A context that was dropped due to token budget constraints. */
export interface DroppedContext {
  /** Context source identifier (id or positional label). */
  source: string
  /** Primitive kind that produced this contribution. */
  injectableKind?: CruxContextInjectableKind
  /** The text that would have been contributed. */
  text: string
  /** Estimated token count of the dropped text. */
  tokens: number
  /** The priority value that caused it to be dropped. */
  priority: number
  /** Tool names this context still contributes even when its text is dropped. */
  injectedTools?: readonly string[]
  /** Segmented static/dynamic text for this dropped contribution, when available. */
  segments?: readonly ContextTextSegment[]
  /** Estimated tokens for static segments. */
  staticTokens?: number
  /** Estimated tokens for dynamic segments. */
  dynamicTokens?: number
}

/** A single part of the assembled system message, with token attribution. */
export interface InspectPart {
  /** Where this part came from: `'prompt'` for the prompt's own system, or `'context:<id>'` for a context. */
  source: string
  /** The resolved text of this part. */
  text: string
  /** Estimated token count. */
  tokens: number
  /** Whether this part was skipped (empty string returned by dynamic context). */
  skipped: boolean
  /** Segmented static/dynamic text for this part, when available. */
  segments?: readonly ContextTextSegment[]
  /** Estimated tokens for static segments. */
  staticTokens?: number
  /** Estimated tokens for dynamic segments. */
  dynamicTokens?: number
}

/** A context that was excluded by a `when` or `match` condition. */
export interface ExcludedContext {
  /** Context source identifier (id or positional label). */
  source: string
  /** Human-readable reason for exclusion. */
  reason: string
}

/**
 * Structured breakdown of the assembled prompt, returned by `.inspect()`.
 *
 * Provides per-part text and token counts, dropped contexts, and totals.
 * Uses the same resolution pipeline as `.resolve()` but returns the trace.
 */
export interface InspectResult {
  /** Breakdown of the system message parts. */
  system: {
    /** The fully assembled system message text. */
    total: string
    /** Individual parts with source attribution and token counts. */
    parts: InspectPart[]
    /** Total estimated tokens for the system message. */
    totalTokens: number
  }
  /** The user prompt text (if using system+prompt mode). */
  prompt:
    | {
        text: string
        tokens: number
      }
    | undefined
  /** Total estimated tokens across system + prompt. */
  totalTokens: number
  /** Contexts that were dropped due to token budget constraints. */
  droppedContexts: DroppedContext[]
  /** Contexts that were excluded by `when` or `match` conditions (never resolved). */
  excludedContexts: ExcludedContext[]
  /** The token budget that was applied, if any. */
  tokenBudget: number | undefined
  /** Names of all tools that would be included (context + config), if any. */
  tools: string[] | undefined
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
