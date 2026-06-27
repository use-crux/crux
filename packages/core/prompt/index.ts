/**
 * Prompt authoring domain — the SDK-agnostic surface for composing prompts
 * and contexts.
 *
 * This curated barrel is the intra-package entry point for the prompt domain:
 * other Core domains import authoring primitives and prompt/context types from
 * `../prompt` rather than reaching into individual files. The published
 * `@use-crux/core` root barrel re-exports the same surface.
 *
 * @module
 */

// ─────────────────────────────────────────────────────────────────
// Authoring values
// ─────────────────────────────────────────────────────────────────

export { prompt, getPromptDefinitionSource } from './prompt'
export { context, createContexts, when, match, getContextDefinitionSource } from './context'
export { createPrompts } from './prompts-tree'
export { injectable, isInjectableEntry, getInputShapeKeys } from './injectable'
export { contributor, isContributorEntry } from './contributor'

// ─────────────────────────────────────────────────────────────────
// Authoring-local types (config + tree result helpers)
// ─────────────────────────────────────────────────────────────────

export type { ContributorConfig } from './contributor'
export type { InjectableConfig } from './injectable'
export type { LeafContextOf, ContextTreeResult } from './context'
export type { PromptTree, LeafPromptOf, PromptTreeResult } from './prompts-tree'

// ─────────────────────────────────────────────────────────────────
// Domain type surface
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
} from './types'

export type { Simplify, DeepReadonly, MergeContextInputs, MergedInput } from './type-utils'
