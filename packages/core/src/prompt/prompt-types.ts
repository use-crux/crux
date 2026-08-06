/**
 * Prompt authoring contracts: `prompt()` config, the resolved {@link Prompt}
 * instance, lifecycle hooks, structured-output result typing, and prompt-level
 * cache intent.
 *
 * These types describe the user-facing prompt surface. Resolution output
 * ({@link ResolvedPrompt}) is owned by `resolver/types.ts`
 * and provider-neutral generation settings by `generation/types.ts`; this module
 * composes them into the authoring API.
 *
 * @module
 */

import type { z } from "zod";
import type { ContextEntry } from "./context-types";
import type { PromptCallback, PromptContent } from "./content-types";
import type { MergedInput } from "./type-utils";
import type { AnyToolSet } from "../types";
import type {
  ProviderAdaptations,
  GenerationSettings,
  GenerateResultMeta,
  TokenUsage,
} from "../generation/types";
import type {
  DroppedContext,
  ResolveOptions,
  ResolvedPrompt,
} from "../resolver/types";
import type { ToolMiddleware } from "../tools/types";
import type { ToolApprovalMap } from "../tools/approval-policy";
import type { Constraint } from "../safety/constraint/types";
import type { Guardrail } from "../safety/guardrail/types";

// ─────────────────────────────────────────────────────────────────
// Semantic Response Cache
// ─────────────────────────────────────────────────────────────────

export type SemanticCacheMode = "readwrite" | "readonly" | "writeonly" | "off";

/**
 * Context passed to a prompt-level semantic cache `query` callback.
 *
 * Generic over the prompt's merged input shape so `ctx.input.<field>`
 * autocompletes when the option is set inline on a `prompt()`.
 */
export interface SemanticCacheQueryContext<TInput = Record<string, unknown>> {
  promptId: string | undefined;
  input: TInput;
  resolved: ResolvedPrompt;
  preparedArgs: Record<string, unknown>;
  operation: "generate" | "stream";
}

export interface SemanticCachePromptOptions<TInput = Record<string, unknown>> {
  mode?: SemanticCacheMode;
  version?: string;
  ttl?: number;
  threshold?: number;
  query?: PromptCallback<
    [ctx: SemanticCacheQueryContext<TInput>],
    string | Promise<string>
  >;
}

export interface PromptCacheOptions<TInput = Record<string, unknown>> {
  semantic?: boolean | SemanticCachePromptOptions<TInput>;
  /** Provider cache hint for the prompt-owned system block. Used by provider-prefix composition. */
  provider?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Prompt Configuration
// ─────────────────────────────────────────────────────────────────

/** Argument passed to a prompt's dynamic `system` and `prompt` functions. */
export interface PromptInputArg<TInput> {
  /** The fully merged input object (prompt's own fields + all context fields). */
  input: TInput;
}

/**
 * Shared prompt configuration fields, excluding the mutually exclusive content
 * mode represented by {@link PromptContent}.
 *
 * @template TOwnInput  - Zod schema for this prompt's own input fields.
 * @template TOutput    - Zod schema for structured output, or `undefined` for text mode.
 * @template TContexts  - Tuple of contexts referenced via `use`.
 */
export interface PromptBaseConfig<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
  TTools extends AnyToolSet | undefined = undefined,
> {
  /** Unique identifier for registry lookup and introspection. */
  id?: string;
  /** Human-readable description (surfaces in IDE hover). */
  description?: string;
  /** Tags for categorization and registry filtering. */
  tags?: readonly string[];
  /**
   * Contexts to compose into this prompt. Their input schemas merge into
   * the prompt's input type, and their system contributions are appended
   * to the system message in array order.
   */
  use?: TContexts;
  /** Zod schema for this prompt's own input fields. */
  input?: TOwnInput;
  /**
   * Zod schema for structured output. Adapters use this to determine
   * whether to call structured generation (e.g. `generateObject`) or
   * text generation (e.g. `generateText`).
   */
  output?: TOutput;

  /** Default generation settings. Overridden by `adapt` settings and call-site settings. */
  settings?: GenerationSettings;
  /** Provider-specific prompt/settings adaptations. */
  adapt?: ProviderAdaptations;
  /** Lifecycle hooks for observability and debugging. */
  hooks?: PromptHooks<TOutput>;
  /**
   * Prompt-level cache intent.
   *
   * `cache.semantic` is consumed by `createSemanticCache()` from
   * `@use-crux/core/cache`. It is inert without that plugin; Crux emits a
   * development warning when a prompt declares semantic cache but no plugin is
   * installed.
   */
  cache?: PromptCacheOptions<MergedInput<TOwnInput, TContexts>>;

  /**
   * Tools available to the model during generation.
   *
   * Prompt-level tools are merged after skill, context, contributor, and
   * blackboard tools. Any same-name prompt-time collision throws with both
   * owners named. Call-site `generate()`/`stream()` tools are the only
   * override path and intentionally win after prompt resolution.
   */
  tools?: TTools;
  /**
   * Approval policy for the prompt's full composed toolset.
   *
   * Exact-name entries and `'*'` are resolved with context and call-site
   * declarations at execution time. Tool definitions themselves remain
   * policy-free.
   */
  toolApproval?: ToolApprovalMap;
  /** Middleware applied to tools before adapter execution. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[];

  /**
   * Constraints to check after structural (Zod) validation passes during generation.
   * Combined with context-level and per-call constraints via union merge (per-call wins).
   * For I/O safety filtering, use guardrails instead.
   */
  constraints?: Constraint[];

  /**
   * Guardrails to run on input/output during generation.
   * Combined with context-level and per-call guardrails via union merge (per-call wins).
   * For semantic output quality validation with retry, use constraints instead.
   */
  guardrails?: Guardrail[];

  /**
   * Top-level input fields that contain trusted, pre-formatted content (HTML, Markdown)
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
  rawFields?: readonly Extract<
    keyof MergedInput<TOwnInput, TContexts>,
    string
  >[];

  /**
   * Top-level input fields whose nested arrays/plain records should be copied
   * and XML-escaped recursively before prompt and context callbacks run.
   * Only relevant when auto-escape is enabled.
   *
   * If a field is also listed in `rawFields`, `escapeFields` wins.
   * Field names are typed against the merged input.
   */
  escapeFields?: readonly Extract<
    keyof MergedInput<TOwnInput, TContexts>,
    string
  >[];

  /**
   * Custom sanitization hook — runs after Zod validation and before auto-escape,
   * system/prompt functions, and context resolution. Use for truncation, domain-specific
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
  sanitize?: PromptCallback<
    [input: MergedInput<TOwnInput, TContexts>],
    MergedInput<TOwnInput, TContexts>
  >;
}

/**
 * Configuration object for `prompt()`.
 *
 * The common authoring fields are intersected with a content-mode union so
 * `messages` is exclusive with `system`/`prompt` at compile time.
 */
export type PromptConfig<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
  TTools extends AnyToolSet | undefined = undefined,
> = PromptBaseConfig<TOwnInput, TOutput, TContexts, TTools> &
  PromptContent<PromptInputArg<MergedInput<TOwnInput, TContexts>>>;

// ─────────────────────────────────────────────────────────────────
// Lifecycle Hooks
// ─────────────────────────────────────────────────────────────────

/** Arguments passed to `onPrepare` hooks. */
export interface PrepareHookArgs {
  /** The prompt ID (if set). */
  promptId: string | undefined;
  /** The assembled system message. */
  system: string | undefined;
  /** The user prompt text (if using system+prompt mode). */
  prompt: string | undefined;
  /** Estimated token count of the system message. */
  systemTokens: number;
  /** Contexts that were dropped due to token budget. */
  droppedContexts: DroppedContext[];
}

/** Arguments passed to `onGenerate` hooks, alongside the result. */
export interface GenerateHookArgs {
  /** The prompt ID (if set). */
  promptId: string | undefined;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

/** Arguments passed to `onError` hooks. */
export interface ErrorHookArgs {
  /** The prompt ID (if set). */
  promptId: string | undefined;
  /** The error that was thrown. */
  error: unknown;
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
  text?: string;
  usage?: TokenUsage;
  /** Provider facts plus the exact core operation that produced the result. */
  _meta: GenerateResultMeta;
  [key: string]: unknown;
} & (TOutput extends z.ZodType<infer O> ? { object: O } : { text: string });

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
export interface PromptHooks<
  TOutput extends z.ZodType | undefined = undefined,
> {
  /** Called after the system message is assembled. */
  onPrepare?: (args: PrepareHookArgs) => void;
  /**
   * Called after generation completes successfully.
   *
   * `result.object` is typed from the prompt's output schema when set;
   * text-only prompts receive a typed `result.text`.
   */
  onGenerate?: (args: GenerateHookArgs, result: PromptResult<TOutput>) => void;
  /** Called when generation throws an error. */
  onError?: (args: ErrorHookArgs) => void;
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
  TTools extends AnyToolSet | undefined = undefined,
> {
  /** Discriminant tag for runtime type checking. */
  readonly _tag: "Prompt";
  /** Unique identifier for registry lookup and introspection. */
  readonly id: string | undefined;
  /** Human-readable description. */
  readonly description: string | undefined;
  /** Tags for categorization. */
  readonly tags: readonly string[];
  /** The contexts this prompt composes via `use`. */
  readonly contexts: TContexts;
  /** The merged Zod input schema (prompt's own + all context inputs), for runtime validation. */
  readonly inputSchema: z.ZodType | undefined;
  /** The Zod output schema, or `undefined` for text mode. */
  readonly outputSchema: TOutput;
  /** `true` if this prompt has an `output` schema (structured mode), `false` otherwise. */
  readonly hasOutput: TOutput extends z.ZodType ? true : false;
  /** The raw prompt configuration — exposed for adapters and preview. */
  readonly config: PromptConfig<TOwnInput, TOutput, TContexts, TTools>;

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
  resolve(opts: ResolveOptions<TOwnInput, TContexts>): Promise<ResolvedPrompt>;

}

/**
 * Base prompt type for heterogeneous collections (e.g., swarm agent maps).
 * Any `Prompt<TInput, TOutput, TContexts>` is assignable to `AnyPrompt`.
 */
export type AnyPrompt = Prompt<
  z.ZodType,
  z.ZodType | undefined,
  readonly ContextEntry[],
  AnyToolSet | undefined
>;

/**
 * Base prompt config for heterogeneous collections and middleware contexts.
 * Any `PromptConfig<TInput, TOutput, TContexts>` is assignable to `AnyPromptConfig`.
 */
type ErasedPromptBaseConfig = Omit<
  PromptBaseConfig<z.ZodType, z.ZodType | undefined, readonly ContextEntry[], AnyToolSet | undefined>,
  "cache" | "rawFields" | "escapeFields" | "sanitize"
> & {
  cache?: PromptCacheOptions<Record<string, unknown>>;
  rawFields?: readonly string[];
  escapeFields?: readonly string[];
  sanitize?: PromptCallback<
    [input: Record<string, unknown>],
    Record<string, unknown>
  >;
};

export type AnyPromptConfig = ErasedPromptBaseConfig &
  PromptContent<PromptInputArg<unknown>>;
