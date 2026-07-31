/**
 * Context authoring contracts and the `use:` entry union.
 *
 * Everything a prompt can compose through `use` is described here: plain
 * {@link Context} fragments, the {@link ConditionalContext} / {@link MatchSpec}
 * gating wrappers, and the lowered {@link ContributorEntry} contract. Built-in
 * primitives can also participate through a private structural lowering shape.
 * The runtime factories that build these shapes live in `prompt/context.ts`
 * and `prompt/contributor.ts`.
 *
 * @module
 */

import type { z } from "zod";
import type { CruxContextInjectableKind } from "../observability/contract";
import type { SkillMeta } from "../skill/types";
import type { Constraint } from "../safety/constraint/types";
import type { Guardrail } from "../safety/guardrail/types";
import type { ToolMiddleware } from "../tools/types";
import type { ToolApprovalMap } from "../tools/approval-policy";
import type { AnyToolSet } from "../types";
import type { InternalInjectableEntry } from "./internal-injection";
import type { ToolSource } from "../tools/tool-source";
import type { RecentHistoryProjection } from "../request/history/source";
import type { RepresentationEntry } from "../request/representation/ladder-types";
import type { PromptText } from "../prompt-text";

// ─────────────────────────────────────────────────────────────────
// Definition warnings
// ─────────────────────────────────────────────────────────────────

/** @internal Definition-time fact emitted by prompt compilation. */
export interface ContextDefinitionWarning {
  readonly code: "memo-cache-contradiction";
  readonly message: string;
}

// ─────────────────────────────────────────────────────────────────
// System content segmentation
// ─────────────────────────────────────────────────────────────────

/** A contiguous span of resolved prompt/context text for observability. */
export interface ContextTextSegment {
  /** Resolved text for this span. */
  text: string;
  /** Whether the span came from runtime input/interpolation rather than static author text. */
  dynamic: boolean;
  /** Optional source key for dynamic spans, such as `account.plan` or `workspace.name`. */
  source?: string;
  /** Source-observation timestamp in milliseconds since Unix epoch, when a primitive knows it. */
  observedAt?: number;
  /** Source version identifier, when a primitive can report one. */
  sourceVersion?: string;
}

/** Structured system/context content for precise observability segmentation. */
export interface ContextSystemContent {
  /** Resolved segments in display order. Empty segments are ignored. */
  segments: readonly ContextTextSegment[];
}

/** A supported system contribution before resolver normalization. */
export type ContextSystemResult = string | ContextSystemContent | PromptText;

/** Argument passed to a context's dynamic `system` function. */
export interface ContextSystemArg<TInput> {
  /** The merged input object, typed to include this context's declared fields. */
  input: TInput;
}

// ─────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────

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
  id?: string;
  /** Human-readable description (surfaces in IDE hover). */
  description?: string;
  /** Zod schema for input fields this context requires. Merges into the prompt's input type. */
  input?: TInput;
  /**
   * System message contribution as static authored content or a function that
   * receives the resolved input. Return `''` to contribute nothing.
   */
  system:
    | string
    | ContextSystemContent
    | PromptText
    | ((
        arg: ContextSystemArg<z.infer<TInput>>,
      ) => ContextSystemResult | Promise<ContextSystemResult>);
  /**
   * Nested composable entries that this context contributes before its own
   * system text. This lets reusable contexts bundle retrieval, grounding,
   * memory, blackboards, or custom injectable primitives.
   */
  use?: readonly ContextEntry[];
  /**
   * Priority for token-aware rendering (0–100). Higher = kept first when
   * token budget is tight. Contexts without priority default to `50`.
   */
  priority?: number;
  /**
   * Tools to contribute to any prompt that `use`s this context.
   * Either a static tool set or a function that receives the resolved input
   * and returns a tool set. Context tool names must be unique across the
   * prompt-time tool surface; collisions throw with both owners named. Only
   * call-site `generate()`/`stream()` tools intentionally override.
   */
  tools?: AnyToolSet | ((arg: ContextSystemArg<z.infer<TInput>>) => AnyToolSet);
  /**
   * Approval policy for tools contributed by this context.
   *
   * Exact keys must name tools this context contributes. The `'*'` key applies
   * only to this context's own tools, never to prompt or call-site tools.
   */
  toolApproval?: ToolApprovalMap;
  /**
   * Input fields that contain trusted, pre-formatted content (HTML, Markdown)
   * and should NOT be auto-escaped. Only relevant when auto-escape is enabled.
   *
   * Typed against this context's own input — IDE autocomplete shows field
   * names declared by the schema.
   */
  rawFields?: readonly Extract<keyof z.infer<TInput>, string>[];
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
  when?: (arg: ContextSystemArg<z.infer<TInput>>) => boolean;

  /** Provider cache hint: request a prompt-cache breakpoint for this block. Nothing app-side. */
  cache?: boolean;

  /** Memoize this context's resolution app-side. Requires `id`. Dynamic `system` only. */
  memo?: { ttl: number };

  /**
   * Constraints contributed by this context. Merged into any prompt that
   * `use`s this context via union merge (per-call wins over per-prompt
   * wins over context-level).
   */
  constraints?: Constraint[];

  /**
   * Guardrails contributed by this context. Merged into any prompt that
   * `use`s this context via union merge (per-call wins over per-prompt
   * wins over context-level).
   */
  guardrails?: Guardrail[];
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
  readonly _tag: "Context";
  /** Unique identifier for introspection. */
  readonly id: string | undefined;
  /** Human-readable description. */
  readonly description: string | undefined;
  /** The Zod schema for this context's input, or `undefined` if static. */
  readonly inputSchema: TInput | undefined;
  /** The top-level keys declared in the input schema (for conflict detection). */
  readonly inputKeys: readonly string[];
  /** Resolves the system message contribution given the merged input. */
  readonly systemFn: (
    input: Record<string, unknown>,
  ) => ContextSystemResult | Promise<ContextSystemResult>;
  /** Whether plain string results from this context should be treated as static or dynamic for observability. */
  readonly systemKind?: "static" | "dynamic";
  /** Nested `use` entries contributed before this context's own system text. */
  readonly useEntries: readonly ContextEntry[];
  /** Priority for token-aware rendering (0–100). Default: `50`. */
  readonly priority: number;
  /** Resolves tools to contribute, or `undefined` if no tools. */
  readonly toolsFn:
    | ((input: Record<string, unknown>) => AnyToolSet)
    | undefined;
  /** Approval policy scoped to this context's contributed tools. */
  readonly toolApproval?: ToolApprovalMap;
  /** Input fields that should skip auto-escaping (trusted content). */
  readonly rawFields: readonly string[];
  /**
   * Predicate evaluated at resolve time. When it returns `false`,
   * the context is excluded entirely (no systemFn, no tools, no tokens).
   * `undefined` means the context is always active.
   */
  readonly when: ((input: Record<string, unknown>) => boolean) | undefined;
  /** Memo TTL in milliseconds for resolver output. `0` means no memoization. */
  readonly memoTtl: number;
  /** Whether to hint the LLM provider to cache this content block. */
  readonly providerCache: boolean;
  /** @internal Definition facts emitted by prompt compilation. */
  readonly definitionWarnings: readonly ContextDefinitionWarning[];
  /**
   * Family label for observability grouping, declared by the primitive
   * factory that produced this context (`memory`, `blackboard`, `retriever`,
   * `skill`). `undefined` means a plain application context.
   */
  readonly family?: CruxContextInjectableKind;
  /** Constraints contributed by this context. Merged at resolution time. */
  readonly constraints: readonly Constraint[];
  /** Guardrails contributed by this context. Merged at resolution time. */
  readonly guardrails: readonly Guardrail[];
}

// ─────────────────────────────────────────────────────────────────
// Conditional context wrappers
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
export interface ConditionalContext<
  TCtx extends Context<z.ZodType> = Context<z.ZodType>,
> {
  /** Discriminant tag for runtime type checking. */
  readonly _tag: "ConditionalContext";
  /** The wrapped context instance. */
  readonly context: TCtx;
  /** Predicate evaluated against the merged input at resolve time. */
  readonly predicate: (input: Record<string, unknown>) => boolean;
}

/** Case map accepted by `match()`: one context or an ordered context tuple per discriminator value. */
export type MatchCases = Record<
  string,
  Context<z.ZodType> | readonly Context<z.ZodType>[]
>;

/**
 * A multi-way context switch created by `match()`.
 *
 * Selects which context(s) to include based on a discriminator value
 * derived from the input. Only the matching branch is resolved.
 */
export interface MatchSpec<TCases extends MatchCases = MatchCases> {
  /** Discriminant tag for runtime type checking. */
  readonly _tag: "MatchSpec";
  /** Extracts the discriminator value from the merged input. */
  readonly on: (input: Record<string, unknown>) => string;
  /** Map of discriminator values to context(s). */
  readonly cases: Readonly<TCases>;
  /** Fallback context(s) when no case matches. */
  readonly default?: Context<z.ZodType> | readonly Context<z.ZodType>[];
}

// ─────────────────────────────────────────────────────────────────
// Use-entry contracts (contributor / primitive entries)
// ─────────────────────────────────────────────────────────────────

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
  | InternalInjectableEntry
  | ContributorEntry<z.ZodType>
  | ToolSource
  | RecentHistoryProjection
  | RepresentationEntry
  | false
  | null
  | undefined;

/**
 * What a custom contributor adds to a prompt.
 *
 * Returned `use` entries re-enter the resolution pipeline with *any* entry kind
 * (skills, memories, blackboards, further contributors). Re-entered entries are
 * gated and recursed exactly like top-level `use:` entries.
 */
export interface Contribution {
  /** Contexts to resolve and append (re-entered through the pipeline, like injectable contexts). */
  contexts?: readonly Context<z.ZodType>[];
  /** Arbitrary entries to re-enter the pipeline with (gated, recursive). */
  use?: readonly ContextEntry[];
  /** Tools to merge — name collisions with other entries throw at resolve time. */
  tools?: AnyToolSet;
  /** Inert tool sources to materialize when an adapter executes the prompt. */
  toolSources?: readonly ToolSource[];
  /** Middleware applied to tools contributed by the resolved prompt. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[];
  constraints?: readonly Constraint[];
  guardrails?: readonly Guardrail[];
  /** Merged into `ResolvedPrompt.metadata` (last write wins per key). */
  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A custom prompt contributor created by `contributor()`.
 *
 * A first-class citizen of the `use:` array: it can gate itself with `when`,
 * bundle nested entries via `useEntries`, and write to every prompt channel
 * from `contribute()`.
 */
export interface ContributorEntry<TInput extends z.ZodType = z.ZodType> {
  readonly _tag: "Contributor";
  readonly id: string;
  readonly inputSchema?: TInput | undefined;
  readonly inputKeys?: readonly string[];
  /** Predicate gating participation, evaluated against the merged input at resolve time. */
  readonly when?: (input: Record<string, unknown>) => boolean;
  /** Nested entries resolved before this contributor's own contribution. */
  readonly useEntries: readonly ContextEntry[];
  contribute(args: {
    input: Record<string, unknown>;
    promptId?: string;
  }): Contribution | Promise<Contribution>;
}

/**
 * A Skill entry in a prompt's `use` array.
 * Imported from @use-crux/core/skill — this is the minimal interface
 * needed by the resolution pipeline.
 */
export interface SkillEntry {
  readonly _tag: "Skill";
  readonly id: string;
  readonly description: string;
  readonly instructions: string;
  readonly references: readonly {
    readonly name: string;
    readonly content: string;
  }[];
  readonly meta: SkillMeta;
  dump(): string;
}

/**
 * A memory entry in a prompt's `use` array.
 *
 * This is intentionally structural to avoid a core type cycle: the concrete
 * implementation lives in `@use-crux/core/memory`, while prompt resolution only
 * needs to expand it into context/tools and retain a lifecycle binding.
 */
export interface MemoryEntry {
  readonly _tag: "Memory";
  readonly id: string;
  readonly config?: {
    readonly capture?: {
      /** @default 'deferred' */
      readonly mode?: "inline" | "deferred";
    };
  };
  asContext(): Context<z.ZodType>;
  asTools(options?: {
    input?: Record<string, unknown>;
    namespace?: string;
  }): AnyToolSet;
  captureTurn(
    turn: {
      readonly messages: readonly {
        readonly role: string;
        readonly content: string;
        readonly metadata?: Readonly<Record<string, unknown>>;
      }[];
      readonly toolEvents?: readonly {
        readonly toolCallId?: string;
        readonly toolName: string;
        readonly args?: unknown;
        readonly result?: unknown;
        readonly error?: string;
      }[];
      readonly source?: {
        readonly traceId?: string;
        readonly promptId?: string;
      };
      readonly metadata?: Readonly<Record<string, unknown>>;
    },
    options?: Record<string, unknown>,
  ): Promise<void>;
  captureToolEvent(
    event: {
      toolCallId?: string;
      toolName: string;
      args?: unknown;
      result?: unknown;
      error?: string;
    },
    options?: Record<string, unknown>,
  ): Promise<void>;
  flush(options?: Record<string, unknown>): Promise<void>;
}

/**
 * A blackboard entry in a prompt's `use` array.
 *
 * The concrete implementation lives in `@use-crux/core/agent`. Prompt resolution
 * only needs to expand it into context and focused tools.
 */
export interface BlackboardEntry {
  readonly _tag: "Blackboard";
  readonly id: string;
  asContext(): Context<z.ZodType>;
  asTools(): AnyToolSet;
}

// ─────────────────────────────────────────────────────────────────
// Context tree (for createContexts)
// ─────────────────────────────────────────────────────────────────

/** A nested object where leaves are `Context` instances and branches are groups. */
export type ContextTree = { [key: string]: Context<z.ZodType> | ContextTree };
