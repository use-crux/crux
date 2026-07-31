/**
 * Resolver output contracts — the SDK-agnostic shapes produced by prompt
 * resolution and inspection.
 *
 * The `resolver/` domain owns these because they are the boundary's return
 * types: `compilePrompt(...).resolve()` yields a {@link ResolvedPrompt}, and
 * `compilePrompt(...).inspect()` yields an {@link InspectResult}. Adapters,
 * prompt instances, and tests consume these contracts without depending on the
 * resolution pipeline internals.
 *
 * Authoring inputs (prompt/context config) live in the `prompt/` domain;
 * provider-neutral base aliases and generation settings live in the root type
 * module. This module composes those lower-level contracts into the
 * resolution-time output surface and is re-exported from the root `types.ts`
 * shim so existing `@use-crux/core` and `./types` importers keep resolving
 * unchanged.
 *
 * @module
 */

import type { z } from "zod";
import type {
  CruxArtifactId,
  CruxContextInjectableKind,
} from "../observability/contract";
import type { ToolMiddleware } from "../tools/types";
import type { ToolSource } from "../tools/tool-source";
import type {
  ApprovalDeclaration,
  ToolApprovalInspection,
} from "../tools/approval-policy";
import type {
  ContextEntry,
  ContextTextSegment,
  MemoryEntry,
} from "../prompt/context-types";
import type { MergedInput } from "../prompt/type-utils";
import type { AnyMessage, AnyToolSet } from "../types";
import type { GenerationSettings } from "../generation/types";
import type { HistoryProjection } from "../request/history/source";
import type { ResolvedRepresentationPolicy } from "../request/representation/ladder-types";
import type { Constraint } from "../safety/constraint/types";
import type { Guardrail } from "../safety/guardrail/types";

// ─────────────────────────────────────────────────────────────────
// System Blocks
// ─────────────────────────────────────────────────────────────────

/**
 * A typed block within the resolved system message.
 *
 * Each context contribution and the prompt's own system text become
 * separate blocks. Adapters that support provider caching (e.g., Anthropic)
 * use `providerCache` and `cacheBoundary` to emit native cache markers at the
 * stable-prefix boundary.
 */
export interface SystemBlock {
  /** Where this block came from: `'prompt'` or `'context:<id>'`. */
  readonly source: string;
  /** The resolved text content of this block. */
  readonly text: string;
  /** Whether the LLM provider should cache this block. */
  readonly providerCache: boolean;
  /** Marks the final provider-cache block where adapters place the native cache breakpoint. */
  readonly cacheBoundary?: true;
  /** Canonical observability artifact for this block, when emitted during prompt resolution. */
  readonly artifactId?: CruxArtifactId;
  /** Segmented static/dynamic text for this block, when available. */
  readonly segments?: readonly ContextTextSegment[];
  /** Estimated tokens for static segments. */
  readonly staticTokens?: number;
  /** Estimated tokens for dynamic segments. */
  readonly dynamicTokens?: number;
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
 * const resolved = myPrompt.resolve({ input: { ... } })
 * // Use with any SDK:
 * await generateObject({ model: myModel, ...resolved })
 * ```
 */
export interface ResolvedPrompt {
  /** Stateless history policy selected by the resolved `use` graph. */
  historyProjection?: HistoryProjection;
  /** Resolved representation policy consumed by managed request planning. @internal */
  representations?: readonly ResolvedRepresentationPolicy[];
  /** The assembled system message (own system + context contributions + adaptations). */
  system?: string;
  /** The user prompt text (if using system+prompt mode). */
  prompt?: string;
  /** Multi-turn messages (if using messages mode). */
  messages?: AnyMessage[];
  /** The Zod output schema for structured generation. */
  schema?: z.ZodType;
  /** Merged tools from contexts and config. */
  tools?: AnyToolSet;
  /** Inert sources selected during prompt composition, materialized only by execution dialects. */
  toolSources?: readonly ToolSource[];
  /** Middleware applied to merged tools before adapter execution. */
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[];
  /**
   * Approval policy declarations collected from context and prompt composition
   * layers. Call-site declarations are added by adapters at execution time.
   */
  toolApprovalDeclarations?: readonly ApprovalDeclaration[];
  /** Tool name filter. */
  activeTools?: string[];
  /** Merged generation settings (config < adapt < call-site). */
  settings: GenerationSettings;
  /**
   * Structured system blocks — same content as `system` but with per-block
   * source attribution and provider cache hints. Adapters that support caching
   * (e.g., Anthropic) use this to emit native cache breakpoints. Adapters that
   * don't need caching can ignore this and use the flat `system` string.
   *
   * Only present when `system` is present. Joining all `block.text` with
   * `\n\n` produces the `system` string.
   */
  systemBlocks?: readonly SystemBlock[];
  /** Constraints collected from prompt config + contexts (merged at resolution). */
  constraints?: Constraint[];
  /** Guardrails collected from prompt config + contexts (merged at resolution). */
  guardrails?: Guardrail[];
  /** Metadata contributed by injectable `use` entries during resolution. */
  metadata?: Readonly<Record<string, unknown>>;
  /** Stateful memory entries used by this prompt. Adapters use these for post-generation capture. */
  memoryBindings?: Array<{
    memory: MemoryEntry;
    input: Record<string, unknown>;
    promptId?: string;
  }>;
}

// ─────────────────────────────────────────────────────────────────
// Resolve Options
// ─────────────────────────────────────────────────────────────────

/**
 * Options passed to Prompt resolution and compiler inspection.
 *
 * SDK-agnostic — no model reference. Adapters add model and SDK-specific
 * fields in their own options types.
 */
export type ResolveOptions<
  TOwnInput extends z.ZodType,
  TContexts extends readonly ContextEntry[],
> = {
  /**
   * Provider identifier for adaptation matching (e.g. `'openai'`, `'anthropic'`).
   * Adapters auto-detect this from the model; set manually when using `.resolve()` directly.
   */
  provider?: string;
  /**
   * Model ID for adaptation matching (e.g. `'gpt-4o'`, `'openai/gpt-4o'`).
   * Used for OpenRouter-style `modelId` prefix matching in the `adapt` map.
   */
  modelId?: string;
} & GenerationSettings &
  ([keyof MergedInput<TOwnInput, TContexts>] extends [never]
    ? { input?: undefined }
    : { input: MergedInput<TOwnInput, TContexts> });

// ─────────────────────────────────────────────────────────────────
// Inspect Result
// ─────────────────────────────────────────────────────────────────

/** A context that was dropped due to token budget constraints. */
export interface DroppedContext {
  /** Context source identifier (id or positional label). */
  source: string;
  /** Primitive kind that produced this contribution. */
  injectableKind?: CruxContextInjectableKind;
  /** The text that would have been contributed. */
  text: string;
  /** Estimated token count of the dropped text. */
  tokens: number;
  /** The priority value that caused it to be dropped. */
  priority: number;
  /** Tool names this context still contributes even when its text is dropped. */
  injectedTools?: readonly string[];
  /** Segmented static/dynamic text for this dropped contribution, when available. */
  segments?: readonly ContextTextSegment[];
  /** Estimated tokens for static segments. */
  staticTokens?: number;
  /** Estimated tokens for dynamic segments. */
  dynamicTokens?: number;
  /** Whether this contribution was resolved live or served from resolver memo. */
  servedFrom?: "live" | "memo";
  /** Clock timestamp for the original context resolution. */
  resolvedAt?: number;
  /** Age in milliseconds for memo hits. */
  age?: number;
  /** Oldest source-observation timestamp summarized from structured segments. */
  observedAt?: number;
  /** First source version summarized from structured segments. */
  sourceVersion?: string;
}

/** A single part of the assembled system message, with token attribution. */
export interface InspectPart {
  /** Where this part came from: `'prompt'` for the prompt's own system, or `'context:<id>'` for a context. */
  source: string;
  /** The resolved text of this part. */
  text: string;
  /** Estimated token count. */
  tokens: number;
  /** Whether this part was skipped (empty string returned by dynamic context). */
  skipped: boolean;
  /** Segmented static/dynamic text for this part, when available. */
  segments?: readonly ContextTextSegment[];
  /** Estimated tokens for static segments. */
  staticTokens?: number;
  /** Estimated tokens for dynamic segments. */
  dynamicTokens?: number;
  /** Whether this contribution was resolved live or served from resolver memo. */
  servedFrom?: "live" | "memo";
  /** Clock timestamp for the original context resolution. */
  resolvedAt?: number;
  /** Age in milliseconds for memo hits. */
  age?: number;
  /** Oldest source-observation timestamp summarized from structured segments. */
  observedAt?: number;
  /** First source version summarized from structured segments. */
  sourceVersion?: string;
}

/** A context that was excluded by a `when` or `match` condition. */
export interface ExcludedContext {
  /** Context source identifier (id or positional label). */
  source: string;
  /** Human-readable reason for exclusion. */
  reason: string;
}

/**
 * Structured breakdown of an assembled prompt returned by compiler inspection.
 *
 * Provides per-part text and token counts, dropped contexts, and totals.
 * Uses the same resolution pipeline as `.resolve()` but returns the trace.
 */
export interface InspectResult {
  /** Breakdown of the system message parts. */
  system: {
    /** The fully assembled system message text. */
    total: string;
    /** Individual parts with source attribution and token counts. */
    parts: InspectPart[];
    /** Total estimated tokens for the system message. */
    totalTokens: number;
  };
  /** The user prompt text (if using system+prompt mode). */
  prompt:
    | {
        text: string;
        tokens: number;
        /** Structural PromptText segments, when the prompt was authored with `md`. */
        segments?: readonly ContextTextSegment[];
        /** Estimated tokens in authored literal segments. */
        staticTokens?: number;
        /** Estimated tokens in interpolated segments. */
        dynamicTokens?: number;
      }
    | undefined;
  /** Total estimated tokens across system + prompt. */
  totalTokens: number;
  /** Contexts that were dropped due to token budget constraints. */
  droppedContexts: DroppedContext[];
  /** Contexts that were excluded by `when` or `match` conditions (never resolved). */
  excludedContexts: ExcludedContext[];
  /** Names of all tools that would be included (context + config), if any. */
  tools: string[] | undefined;
  /** Effective prompt-time approval policy per composed tool. */
  toolApprovals?: ToolApprovalInspection[];
}
