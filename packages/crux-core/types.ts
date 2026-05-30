import type { z } from 'zod'
import type { CruxArtifactId } from './observability/contract'
import type { SkillMeta } from './skill/types'
import type { ToolMiddleware } from './tool-middleware'

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
// Utility Types
// ─────────────────────────────────────────────────────────────────

/** Flatten intersection types into a single object for clean IDE tooltips. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {}

// ─────────────────────────────────────────────────────────────────
// Cache Types
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
}

/**
 * Cache configuration for a context.
 *
 * Controls both application-level resolver caching (TTL) and
 * provider-level token caching (e.g., Anthropic `cache_control`).
 *
 * Shorthands:
 * - `number` — TTL in ms, `providerCache` defaults to `true`
 * - `true` — 5-minute TTL, `providerCache` defaults to `true`
 * - `false` — no caching
 *
 * Object form for fine-grained control:
 * - `{ ttl?: number; providerCache?: boolean }`
 */
export type CacheOption =
  | number
  | boolean
  | {
      /** TTL in ms for caching the resolver output. */
      ttl?: number
      /**
       * Whether to hint the LLM provider to cache this content block.
       * Anthropic: emits `cache_control` breakpoint. OpenAI: no-op (automatic).
       * @default true (when cache is set)
       */
      providerCache?: boolean
    }

// ─────────────────────────────────────────────────────────────────
// Semantic Response Cache Types
// ─────────────────────────────────────────────────────────────────

export type SemanticCacheMode = 'readwrite' | 'readonly' | 'writeonly' | 'off'

/**
 * Context passed to a prompt-level semantic cache `query` callback.
 *
 * Generic over the prompt's merged input shape so `ctx.input.<field>`
 * autocompletes when the option is set inline on a `prompt()`.
 */
export interface SemanticCacheQueryContext<TInput = Record<string, unknown>> {
  promptId: string | undefined
  input: TInput
  resolved: ResolvedPrompt
  preparedArgs: Record<string, unknown>
  operation: 'generate' | 'stream'
}

export interface SemanticCachePromptOptions<TInput = Record<string, unknown>> {
  mode?: SemanticCacheMode
  version?: string
  ttl?: number
  threshold?: number
  query?: (ctx: SemanticCacheQueryContext<TInput>) => string | Promise<string>
}

export interface PromptCacheOptions<TInput = Record<string, unknown>> {
  semantic?: boolean | SemanticCachePromptOptions<TInput>
}

// ─────────────────────────────────────────────────────────────────
// Context Types
// ─────────────────────────────────────────────────────────────────

/** Argument passed to a context's dynamic `system` function. */
export interface ContextSystemArg<TInput> {
  /** The merged input object, typed to include this context's declared fields. */
  input: TInput
}

/**
 * Configuration object for `context()`.
 *
 * @template TInput - Zod schema declaring what input fields this context needs.
 *
 * @example
 * ```ts
 * // Static context — always contributes the same system text
 * { system: '## Rules\n...' }
 *
 * // Dynamic context — reads from input to conditionally contribute
 * {
 *   input: z.object({ lang: z.string().optional() }),
 *   system: ({ input }) => input.lang ? `Respond in ${input.lang}.` : '',
 * }
 * ```
 */
export interface ContextDef<TInput extends z.ZodType = z.ZodType> {
  /** Unique identifier for introspection and debugging. */
  id?: string
  /** Human-readable description (surfaces in IDE hover). */
  description?: string
  /** Zod schema for input fields this context requires. Merges into the prompt's input type. */
  input?: TInput
  /**
   * System message contribution — either a static string or a function
   * that receives the resolved input. Return `''` to contribute nothing.
   */
  system: string | ((arg: ContextSystemArg<z.infer<TInput>>) => string | Promise<string>)
  /**
   * Nested composable entries that this context contributes before its own
   * system text. This lets reusable contexts bundle retrieval, grounding,
   * memory, blackboards, or custom injectable primitives.
   */
  use?: readonly ContextEntry[]
  /**
   * Priority for token-aware rendering (0–100). Higher = kept first when
   * token budget is tight. Contexts without priority default to `50`.
   */
  priority?: number
  /**
   * Tools to contribute to any prompt that `use`s this context.
   * Either a static tool set or a function that receives the resolved input
   * and returns a tool set. Tools from contexts are merged (lowest precedence)
   * with prompt-level and call-site tools.
   */
  tools?: AnyToolSet | ((arg: ContextSystemArg<z.infer<TInput>>) => AnyToolSet)
  /**
   * Input fields that contain trusted, pre-formatted content (HTML, Markdown)
   * and should NOT be auto-escaped. Only relevant when auto-escape is enabled.
   *
   * Typed against this context's own input — IDE autocomplete shows field
   * names declared by the schema.
   */
  rawFields?: readonly Extract<keyof z.infer<TInput>, string>[]
  /**
   * Predicate evaluated at resolve time against this context's own input.
   * When it returns `false`, the context is excluded entirely — no `systemFn`
   * call, no tool contribution, no token counting.
   *
   * Typed against this context's own input schema for full autocomplete.
   *
   * @example
   * ```ts
   * context({
   *   input: z.object({ lang: z.string().optional() }),
   *   when: ({ input }) => !!input.lang && input.lang !== 'English',
   *   system: ({ input }) => `Respond in ${input.lang}.`,
   * })
   * ```
   */
  when?: (arg: ContextSystemArg<z.infer<TInput>>) => boolean

  /**
   * Cache configuration for this context.
   *
   * - `number` — TTL in ms. Enables both resolver caching and provider cache hints.
   * - `true` — 5-minute TTL with provider caching.
   * - `{ ttl?, providerCache? }` — Fine-grained control over each layer.
   * - `false` / omitted — No caching.
   *
   * Requires `id` when `ttl > 0` (needed for cache key derivation).
   * Static string `system` contexts silently skip TTL caching (nothing to cache).
   */
  cache?: CacheOption

  /**
   * Constraints contributed by this context. Merged into any prompt that
   * `use`s this context via union merge (per-call wins over per-prompt
   * wins over context-level).
   */
  constraints?: import('./safety/constraint/types').Constraint[]

  /**
   * Guardrails contributed by this context. Merged into any prompt that
   * `use`s this context via union merge (per-call wins over per-prompt
   * wins over context-level).
   */
  guardrails?: import('./safety/guardrail/types').Guardrail[]
}

/**
 * A reusable, typed context fragment created by `context()`.
 *
 * Contexts contribute to the system message of any prompt that references
 * them via `use`. If the context declares an `input` schema, those fields
 * are merged into the prompt's required input type.
 *
 * @template TInput - Zod schema for this context's input fields.
 */
export interface Context<TInput extends z.ZodType = z.ZodType> {
  /** Discriminant tag for runtime type checking. */
  readonly _tag: 'Context'
  /** Unique identifier for introspection. */
  readonly id: string | undefined
  /** Human-readable description. */
  readonly description: string | undefined
  /** The Zod schema for this context's input, or `undefined` if static. */
  readonly inputSchema: TInput | undefined
  /** The top-level keys declared in the input schema (for conflict detection). */
  readonly inputKeys: readonly string[]
  /** Resolves the system message contribution given the merged input. */
  readonly systemFn: (input: Record<string, unknown>) => string | Promise<string>
  /** Nested `use` entries contributed before this context's own system text. */
  readonly useEntries: readonly ContextEntry[]
  /** Priority for token-aware rendering (0–100). Default: `50`. */
  readonly priority: number
  /** Resolves tools to contribute, or `undefined` if no tools. */
  readonly toolsFn: ((input: Record<string, unknown>) => AnyToolSet) | undefined
  /** Input fields that should skip auto-escaping (trusted content). */
  readonly rawFields: readonly string[]
  /**
   * Predicate evaluated at resolve time. When it returns `false`,
   * the context is excluded entirely (no systemFn, no tools, no tokens).
   * `undefined` means the context is always active.
   */
  readonly when: ((input: Record<string, unknown>) => boolean) | undefined
  /** Cache TTL in milliseconds for resolver output. `0` means no caching. */
  readonly cacheTtl: number
  /** Whether to hint the LLM provider to cache this content block. */
  readonly providerCache: boolean
  /** Constraints contributed by this context. Merged at resolution time. */
  readonly constraints: readonly import('./safety/constraint/types').Constraint[]
  /** Guardrails contributed by this context. Merged at resolution time. */
  readonly guardrails: readonly import('./safety/guardrail/types').Guardrail[]
}

// ─────────────────────────────────────────────────────────────────
// Conditional Context Types
// ─────────────────────────────────────────────────────────────────

/**
 * A context wrapped with a runtime predicate via the `when()` function.
 *
 * When the predicate returns `false` at resolve time, the wrapped context
 * is excluded entirely — no `systemFn` call, no tool contribution.
 * Its input keys become `Partial<>` in the merged prompt input type.
 *
 * @template TCtx - The wrapped context type.
 */
export interface ConditionalContext<TCtx extends Context<z.ZodType> = Context<z.ZodType>> {
  /** Discriminant tag for runtime type checking. */
  readonly _tag: 'ConditionalContext'
  /** The wrapped context instance. */
  readonly context: TCtx
  /** Predicate evaluated against the merged input at resolve time. */
  readonly predicate: (input: Record<string, unknown>) => boolean
}

/**
 * A multi-way context switch created by `match()`.
 *
 * Selects which context(s) to include based on a discriminator value
 * derived from the input. Only the matching branch is resolved.
 */
export interface MatchSpec {
  /** Discriminant tag for runtime type checking. */
  readonly _tag: 'MatchSpec'
  /** Extracts the discriminator value from the merged input. */
  readonly on: (input: Record<string, unknown>) => string
  /** Map of discriminator values to context(s). */
  readonly cases: Readonly<Record<string, Context<z.ZodType> | readonly Context<z.ZodType>[]>>
  /** Fallback context(s) when no case matches. */
  readonly default?: Context<z.ZodType> | readonly Context<z.ZodType>[]
}

/**
 * An entry in the `use` array of `prompt()`.
 *
 * Supports plain contexts, conditional wrappers, match specs, and
 * falsy values (for the `flag && ctx` pattern).
 */
export type ContextEntry =
  | Context<z.ZodType>
  | ConditionalContext<Context<z.ZodType>>
  | MatchSpec
  | SkillEntry
  | MemoryEntry
  | BlackboardEntry
  | InjectableEntry
  | false
  | null
  | undefined

export interface PromptInjection {
  contexts?: readonly Context<z.ZodType>[]
  tools?: AnyToolSet
  constraints?: readonly import('./safety/constraint/types').Constraint[]
  guardrails?: readonly import('./safety/guardrail/types').Guardrail[]
  metadata?: Readonly<Record<string, unknown>>
}

export interface InjectableEntry {
  readonly _tag: string
  readonly id: string
  readonly inputSchema?: z.ZodType | undefined
  readonly inputKeys?: readonly string[]
  inject(args: { input: Record<string, unknown>; promptId?: string }): PromptInjection | Promise<PromptInjection>
}

/**
 * A Skill entry in a prompt's `use` array.
 * Imported from @crux/core/skill — this is the minimal interface
 * needed by the resolution pipeline.
 */
export interface SkillEntry {
  readonly _tag: 'Skill'
  readonly id: string
  readonly description: string
  readonly instructions: string
  readonly references: readonly { readonly name: string; readonly content: string }[]
  readonly meta: SkillMeta
  dump(): string
}

/**
 * A memory entry in a prompt's `use` array.
 *
 * This is intentionally structural to avoid a core type cycle: the concrete
 * implementation lives in `@crux/core/memory`, while prompt resolution only
 * needs to expand it into context/tools and retain a lifecycle binding.
 */
export interface MemoryEntry {
  readonly _tag: 'Memory'
  readonly id: string
  asContext(): Context<z.ZodType>
  asTools(options?: { input?: Record<string, unknown>; namespace?: string }): AnyToolSet
  captureTurn(
    turn: {
      messages: Array<{ role: string; content: string; metadata?: Record<string, unknown> }>
      toolEvents?: Array<{ toolCallId?: string; toolName: string; args?: unknown; result?: unknown; error?: string }>
      source?: { traceId?: string; promptId?: string }
      metadata?: Record<string, unknown>
    },
    options?: Record<string, unknown>,
  ): Promise<void>
  flush(options?: Record<string, unknown>): Promise<void>
}

/**
 * A blackboard entry in a prompt's `use` array.
 *
 * The concrete implementation lives in `@crux/core/agent`. Prompt resolution
 * only needs to expand it into context and focused tools.
 */
export interface BlackboardEntry {
  readonly _tag: 'Blackboard'
  readonly id: string
  asContext(): Context<z.ZodType>
  asTools(): AnyToolSet
}

// ─────────────────────────────────────────────────────────────────
// Context Tree Types (for createContexts)
// ─────────────────────────────────────────────────────────────────

/** A nested object where leaves are `Context` instances and branches are groups. */
export type ContextTree = { [key: string]: Context<z.ZodType> | ContextTree }

/** Recursively marks all properties as `readonly`, preserving `Context` leaf types. */
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends Context<z.ZodType> ? T[K] : DeepReadonly<T[K]>
}

// ─────────────────────────────────────────────────────────────────
// Input Schema Merging
// ─────────────────────────────────────────────────────────────────

/** Extract inferred type from a Context's input, or `{}` if no input declared. */
type InferContextInput<C> = C extends Context<infer S> ? (S extends z.ZodType ? z.infer<S> : {}) : {}

/**
 * Extract inferred type from a ContextEntry.
 *
 * - `Context<T>` → required (`z.infer<T>`)
 * - `ConditionalContext<Context<T>>` → optional (`Partial<z.infer<T>>`)
 * - `MatchSpec` → `{}` (no type-level contribution; declare fields on prompt input)
 * - `false | null | undefined` → `{}` (filtered out at runtime)
 */
type InferContextEntryInput<E> =
  E extends Context<z.ZodType>
    ? InferContextInput<E>
    : E extends ConditionalContext<infer TCtx>
      ? Partial<InferContextInput<TCtx>>
      : {} // MatchSpec, false, null, undefined

/**
 * Recursively intersect all context entry input types from a tuple.
 *
 * Handles the widened `ContextEntry` union: plain contexts contribute required
 * keys, conditional contexts contribute optional keys, and falsy/match entries
 * contribute nothing.
 *
 * @example
 * Given `[Context<{a: string}>, ConditionalContext<Context<{b: number}>>]`,
 * produces `{a: string} & {b?: number}`.
 */
export type MergeContextInputs<T extends readonly ContextEntry[]> = T extends readonly [
  infer First,
  ...infer Rest extends readonly ContextEntry[],
]
  ? InferContextEntryInput<First> & MergeContextInputs<Rest>
  : {}

/**
 * The final merged input type for a prompt: its own input intersected
 * with all context inputs, flattened via `Simplify` for clean IDE display.
 */
export type MergedInput<TOwnInput extends z.ZodType, TContexts extends readonly ContextEntry[]> = Simplify<
  z.infer<TOwnInput> & MergeContextInputs<TContexts>
>

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
// Prompt Configuration
// ─────────────────────────────────────────────────────────────────

/** Argument passed to a prompt's dynamic `system` and `prompt` functions. */
export interface PromptInputArg<TInput> {
  /** The fully merged input object (prompt's own fields + all context fields). */
  input: TInput
}

/**
 * Configuration object for `prompt()`.
 *
 * @template TOwnInput  - Zod schema for this prompt's own input fields.
 * @template TOutput    - Zod schema for structured output, or `undefined` for text mode.
 * @template TContexts  - Tuple of contexts referenced via `use`.
 */
export interface PromptConfig<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
> {
  /** Unique identifier for registry lookup and introspection. */
  id?: string
  /** Human-readable description (surfaces in IDE hover). */
  description?: string
  /** Tags for categorization and registry filtering. */
  tags?: readonly string[]
  /**
   * Contexts to compose into this prompt. Their input schemas merge into
   * the prompt's input type, and their system contributions are appended
   * to the system message in array order.
   */
  use?: TContexts
  /** Zod schema for this prompt's own input fields. */
  input?: TOwnInput
  /**
   * Zod schema for structured output. Adapters use this to determine
   * whether to call structured generation (e.g. `generateObject`) or
   * text generation (e.g. `generateText`).
   */
  output?: TOutput

  /**
   * System message — role/identity text that appears first.
   * Mutually exclusive with `messages`.
   */
  system?: string | ((arg: PromptInputArg<MergedInput<TOwnInput, TContexts>>) => string | Promise<string>)
  /**
   * User prompt text.
   * Mutually exclusive with `messages`.
   */
  prompt?: string | ((arg: PromptInputArg<MergedInput<TOwnInput, TContexts>>) => string)
  /**
   * Multi-turn / few-shot messages array. Context system text is prepended
   * to the first system message (or inserted at the start).
   * Mutually exclusive with `system` and `prompt`.
   */
  messages?: (arg: PromptInputArg<MergedInput<TOwnInput, TContexts>>) => AnyMessage[]

  /** Default generation settings. Overridden by `adapt` settings and call-site settings. */
  settings?: GenerationSettings
  /** Provider-specific prompt/settings adaptations. */
  adapt?: AdapterMap
  /** Lifecycle hooks for observability and debugging. */
  hooks?: PromptHooks<TOutput>
  /**
   * Prompt-level cache intent.
   *
   * `cache.semantic` is consumed by `createSemanticCache()` from
   * `@crux/core/cache`. It is inert without that plugin; Crux emits a
   * development warning when a prompt declares semantic cache but no plugin is
   * installed.
   */
  cache?: PromptCacheOptions<MergedInput<TOwnInput, TContexts>>

  /**
   * Tools available to the model during generation.
   * Tools from contexts (via `use`) and call-site tools are merged in at resolve time.
   */
  tools?: AnyToolSet
  /** Middleware applied to tools before adapter execution. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[]
  /** Default tool choice strategy. Adapter-specific format. */
  toolChoice?: unknown
  /** Stop condition(s) for multi-step tool use. Adapter-specific format. */
  stopWhen?: unknown

  /**
   * Constraints to check after structural (Zod) validation passes during generation.
   * Combined with context-level and per-call constraints via union merge (per-call wins).
   * For I/O safety filtering, use guardrails instead.
   */
  constraints?: import('./safety/constraint/types').Constraint[]

  /**
   * Guardrails to run on input/output during generation.
   * Combined with context-level and per-call guardrails via union merge (per-call wins).
   * For semantic output quality validation with retry, use constraints instead.
   */
  guardrails?: import('./safety/guardrail/types').Guardrail[]

  /**
   * Input fields that contain trusted, pre-formatted content (HTML, Markdown)
   * and should NOT be auto-escaped. Only relevant when auto-escape is enabled.
   *
   * Field names are typed against the merged input — IDE autocomplete shows
   * available keys and typos are rejected at compile time.
   *
   * @example
   * ```ts
   * prompt({
   *   input: z.object({ instruction: z.string(), indexedHtml: z.string() }),
   *   rawFields: ['indexedHtml'],
   *   // instruction: auto-escaped, indexedHtml: passed through
   * })
   * ```
   */
  rawFields?: readonly Extract<keyof MergedInput<TOwnInput, TContexts>, string>[]

  /**
   * Custom sanitization hook — runs after Zod validation and auto-escape,
   * before system/prompt functions. Use for truncation, domain-specific
   * validation, or additional transforms.
   *
   * @example
   * ```ts
   * prompt({
   *   input: z.object({ query: z.string() }),
   *   sanitize: (input) => ({
   *     ...input,
   *     query: truncate(input.query, 500),
   *   }),
   * })
   * ```
   */
  sanitize?: (input: MergedInput<TOwnInput, TContexts>) => MergedInput<TOwnInput, TContexts>

  /**
   * Test cases for this prompt. Used by `evaluatePrompt()` when
   * no explicit `cases` are provided.
   *
   * Input and result types are inferred from the prompt's schemas.
   */
  tests?: Array<{
    /** Descriptive name for this test case (used in reports). */
    name: string
    /** Input to pass to the generate call — typed from the prompt's merged input. */
    input: MergedInput<TOwnInput, TContexts>
    /**
     * Assertion — returns `true` if the case passed. May be async.
     * Structured prompts get a typed `result.object`; text prompts get
     * a required `result.text`.
     */
    assert: (
      result: {
        usage?: Record<string, unknown>
        [key: string]: unknown
      } & (TOutput extends z.ZodType<infer O> ? { object: O; text?: string } : { text: string }),
    ) => boolean | Promise<boolean>
  }>
}

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
// Lifecycle Hooks
// ─────────────────────────────────────────────────────────────────

/** Arguments passed to `onPrepare` hooks. */
export interface PrepareHookArgs {
  /** The prompt ID (if set). */
  promptId: string | undefined
  /** The assembled system message. */
  system: string | undefined
  /** The user prompt text (if using system+prompt mode). */
  prompt: string | undefined
  /** Estimated token count of the system message. */
  systemTokens: number
  /** Contexts that were dropped due to token budget. */
  droppedContexts: DroppedContext[]
}

/** Arguments passed to `onGenerate` hooks, alongside the result. */
export interface GenerateHookArgs {
  /** The prompt ID (if set). */
  promptId: string | undefined
  /** Wall-clock duration in milliseconds. */
  durationMs: number
}

/** Arguments passed to `onError` hooks. */
export interface ErrorHookArgs {
  /** The prompt ID (if set). */
  promptId: string | undefined
  /** The error that was thrown. */
  error: unknown
}

/**
 * The shape of an adapter result handed to `onGenerate` hooks.
 *
 * Structured output prompts (`TOutput extends z.ZodType`) get a typed
 * `object` field; text-only prompts get `text`. Both carry usage and
 * provider metadata under `_meta`. Adapter-specific fields pass through
 * the index signature.
 */
export type PromptResult<TOutput extends z.ZodType | undefined = undefined> = {
  text?: string
  usage?: TokenUsage
  _meta?: TraceMeta
  [key: string]: unknown
} & (TOutput extends z.ZodType<infer O> ? { object: O } : { text: string })

/**
 * Lifecycle hooks for a single prompt instance.
 *
 * @example
 * ```ts
 * prompt({
 *   output: z.object({ score: z.number() }),
 *   hooks: {
 *     onPrepare: (args) => console.log('System tokens:', args.systemTokens),
 *     onGenerate: (args, result) => trackScore(result.object.score), // typed!
 *     onError: (args) => reportError(args.error),
 *   },
 * })
 * ```
 */
export interface PromptHooks<TOutput extends z.ZodType | undefined = undefined> {
  /** Called after the system message is assembled. */
  onPrepare?: (args: PrepareHookArgs) => void
  /**
   * Called after generation completes successfully.
   *
   * `result.object` is typed from the prompt's output schema when set;
   * text-only prompts receive a typed `result.text`.
   */
  onGenerate?: (args: GenerateHookArgs, result: PromptResult<TOutput>) => void
  /** Called when generation throws an error. */
  onError?: (args: ErrorHookArgs) => void
}

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
// Inspect Result
// ─────────────────────────────────────────────────────────────────

/** A context that was dropped due to token budget constraints. */
export interface DroppedContext {
  /** Context source identifier (id or positional label). */
  source: string
  /** The text that would have been contributed. */
  text: string
  /** Estimated token count of the dropped text. */
  tokens: number
  /** The priority value that caused it to be dropped. */
  priority: number
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
// Prompt Instance
// ─────────────────────────────────────────────────────────────────

/**
 * A defined prompt instance — the main public type returned by `prompt()`.
 *
 * Prompts are SDK-agnostic, portable artifacts. They handle composition,
 * resolution, and inspection. Execution is handled by adapter functions
 * (`generate()`, `stream()`) from adapter subpaths.
 *
 * @template TOwnInput  - Zod schema for this prompt's own input fields.
 * @template TOutput    - Zod schema for structured output, or `undefined` for text mode.
 * @template TContexts  - Tuple of contexts referenced via `use`.
 */
export interface Prompt<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
> {
  /** Discriminant tag for runtime type checking. */
  readonly _tag: 'Prompt'
  /** Unique identifier for registry lookup and introspection. */
  readonly id: string | undefined
  /** Human-readable description. */
  readonly description: string | undefined
  /** Tags for categorization. */
  readonly tags: readonly string[]
  /** The contexts this prompt composes via `use`. */
  readonly contexts: TContexts
  /** The merged Zod input schema (prompt's own + all context inputs), for runtime validation. */
  readonly inputSchema: z.ZodType | undefined
  /** The Zod output schema, or `undefined` for text mode. */
  readonly outputSchema: TOutput
  /** `true` if this prompt has an `output` schema (structured mode), `false` otherwise. */
  readonly hasOutput: TOutput extends z.ZodType ? true : false
  /** The raw prompt configuration — exposed for adapters and the inspector. */
  readonly config: PromptConfig<TOwnInput, TOutput, TContexts>

  /**
   * Resolve the prompt into SDK-agnostic data without executing.
   *
   * Runs the full composition pipeline: input validation, system assembly,
   * context composition, token budgets, provider adaptation, settings merging.
   *
   * @example
   * ```ts
   * const resolved = prompt.resolve({ input: { ... }, provider: 'openai' })
   * // → { system, prompt, schema, tools, settings }
   * ```
   */
  resolve(opts: ResolveOptions<TOwnInput, TContexts>): Promise<ResolvedPrompt>

  /**
   * Inspect the assembled prompt without executing.
   *
   * Returns a structured breakdown of every part of the system message
   * with source attribution and token counts.
   *
   * @example
   * ```ts
   * const debug = await prompt.inspect({ input: { ... }, tokenBudget: 4000 })
   * debug.system.parts     // per-context breakdown
   * debug.totalTokens      // total estimated tokens
   * debug.droppedContexts  // what was dropped for budget
   * ```
   */
  inspect(opts: ResolveOptions<TOwnInput, TContexts>): Promise<InspectResult>
}

/**
 * Base prompt type for heterogeneous collections (e.g., swarm agent maps).
 * Any `Prompt<TInput, TOutput, TContexts>` is assignable to `AnyPrompt`.
 */
export type AnyPrompt = Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>

/**
 * Base prompt config for heterogeneous collections and middleware contexts.
 * Any `PromptConfig<TInput, TOutput, TContexts>` is assignable to `AnyPromptConfig`.
 */
export type AnyPromptConfig = PromptConfig<z.ZodType, z.ZodType | undefined, readonly ContextEntry[]>

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
