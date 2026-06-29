/**
 * Prompt authoring contracts: `prompt()` config, the resolved {@link Prompt}
 * instance, lifecycle hooks, structured-output result typing, and prompt-level
 * cache intent.
 *
 * These types describe the user-facing prompt surface. Resolution output
 * ({@link ResolvedPrompt}, {@link InspectResult}) is owned by `resolver/types.ts`
 * and provider-neutral generation settings by `generation/types.ts`; this module
 * composes them into the authoring API.
 *
 * @module
 */

import type { z } from 'zod'
import type { ContextEntry, ContextSystemContent, ContextSystemResult } from './context-types'
import type { MergedInput } from './type-utils'
import type { AnyMessage, AnyToolSet } from '../types'
import type { AdapterMap, GenerationSettings, TokenUsage, TraceMeta } from '../generation/types'
import type { DroppedContext, InspectResult, ResolveOptions, ResolvedPrompt } from '../resolver/types'
import type { ToolMiddleware } from '../tools/types'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'

// ─────────────────────────────────────────────────────────────────
// Semantic Response Cache
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
  system?:
    | string
    | ContextSystemContent
    | ((arg: PromptInputArg<MergedInput<TOwnInput, TContexts>>) => ContextSystemResult | Promise<ContextSystemResult>)
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
   * `@use-crux/core/cache`. It is inert without that plugin; Crux emits a
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
  constraints?: Constraint[]

  /**
   * Guardrails to run on input/output during generation.
   * Combined with context-level and per-call guardrails via union merge (per-call wins).
   * For semantic output quality validation with retry, use constraints instead.
   */
  guardrails?: Guardrail[]

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
   * Colocated test cases for this prompt — Quality rung 0.
   *
   * Cases are pure data (`name?`, `input`, `expected?`): the Quality runner
   * lowers them into an evaluation with id `prompt:<promptId>` that validates
   * each output against the prompt's output schema; `expected` is reported,
   * never matched implicitly. Anything richer (callbacks, scorers, variants)
   * graduates to a `*.eval.ts` file.
   *
   * Input and result types are inferred from the prompt's schemas.
   *
   * @example
   * ```ts
   * prompt({
   *   id: 'support',
   *   input: z.object({ question: z.string() }),
   *   output: z.object({ answer: z.string() }),
   *   tests: [
   *     { input: { question: 'How do refunds work?' } },
   *     { name: 'dutch', input: { question: 'Hoe werkt een refund?' }, expected: '14 dagen' },
   *   ],
   * })
   * ```
   */
  tests?: Array<{
    /** Descriptive name for this test case. Defaults to a content hash of `input`. */
    name?: string
    /** Input to pass to the generate call — typed from the prompt's merged input. */
    input: MergedInput<TOwnInput, TContexts>
    /** Opaque expected payload — reported alongside results, never matched implicitly. */
    expected?: unknown
  }>
}

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
