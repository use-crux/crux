/**
 * Core SDK-agnostic type surface.
 *
 * This module owns the few remaining provider-neutral base contracts — the SDK
 * aliases ({@link AnyModel}, {@link AnyToolSet}, {@link AnyMessage}), the project
 * tool catalog ({@link FlowToolDef}), and model metadata ({@link ModelInfo}).
 *
 * Every domain-owned type now lives in its domain:
 * - prompt/context authoring → `prompt/` (`prompt/context-types.ts`,
 *   `prompt/prompt-types.ts`, `prompt/type-utils.ts`);
 * - prompt resolution/inspection output → `resolver/` (`resolver/types.ts`);
 * - runtime middleware contracts → `runtime/` (`runtime/types.ts`);
 * - generation policy ({@link GenerationSettings}, {@link PromptAdaptation},
 *   {@link AdapterMap}, {@link TokenUsage}, {@link TraceMeta}) → `generation/`
 *   (`generation/types.ts`).
 *
 * All of those are re-exported here so the many existing `./types` importers keep
 * resolving unchanged during the structure refactor. These re-export shims are
 * temporary: the final cleanup phase reduces this module to its intentional,
 * minimal surface.
 *
 * @module
 */

import type { z } from 'zod'

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
// Runtime middleware re-export shim (owned by the `runtime/` domain)
// ─────────────────────────────────────────────────────────────────

export type { PromptMiddlewareArgs, MiddlewareResult, PromptMiddleware } from './runtime/types'

// ─────────────────────────────────────────────────────────────────
// Generation policy re-export shim (owned by the `generation/` domain)
// ─────────────────────────────────────────────────────────────────

export type { GenerationSettings, PromptAdaptation, AdapterMap, TokenUsage, TraceMeta } from './generation/types'

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
// Model Info (used by adapters and resolve pipeline)
// ─────────────────────────────────────────────────────────────────

/** Extracted provider and model ID, used for adaptation matching. */
export interface ModelInfo {
  /** Provider identifier (e.g. `"openai"`, `"anthropic"`, `"google"`). */
  provider: string
  /** Model identifier (e.g. `"gpt-4o"`, `"openai/gpt-4o"`). */
  modelId: string
}
