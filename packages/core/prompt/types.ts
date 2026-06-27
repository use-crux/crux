/**
 * Public type surface for the prompt authoring domain.
 *
 * This is the curated barrel: the concrete definitions are split by concern
 * into `context-types.ts` (context authoring + `use:` entry contracts) and
 * `prompt-types.ts` (the `prompt()` config, instance, hooks, and cache types).
 * Inference helpers live separately in `type-utils.ts`.
 *
 * @module
 */

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
} from './context-types'

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
} from './prompt-types'
