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
export { contributor, isContributorEntry } from './contributor'

// ─────────────────────────────────────────────────────────────────
// Authoring-local types (config + tree result helpers)
// ─────────────────────────────────────────────────────────────────

export type { ContributorConfig } from './contributor'
export type { LeafContextOf, ContextTreeResult } from './context'
export type { PromptTree, LeafPromptOf, PromptTreeResult } from './prompts-tree'

// ─────────────────────────────────────────────────────────────────
// Domain type surface
// ─────────────────────────────────────────────────────────────────

export type {
  ContextDefinitionWarning,
  ContextTextSegment,
  ContextSystemContent,
  ContextSystemResult,
  ContextSystemArg,
  ContextDef,
  Context,
  ConditionalContext,
  MatchCases,
  MatchSpec,
  ContextEntry,
  Contribution,
  ContributorEntry,
  SkillEntry,
  MemoryEntry,
  ThreadHistoryEntry,
  ThreadTurnCommitInput,
  BlackboardEntry,
  ContextTree,
  SemanticCacheMode,
  SemanticCacheQueryContext,
  SemanticCachePromptOptions,
  PromptCacheOptions,
  PromptCallback,
  SystemField,
  PromptField,
  PromptContent,
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
