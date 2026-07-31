/**
 * Public type surface for the prompt authoring domain.
 *
 * This is the curated barrel: the concrete definitions are split by concern
 * into `context-types.ts` (context authoring + `use:` entry contracts),
 * `content-types.ts` (prompt content-mode union helpers), and `prompt-types.ts`
 * (the `prompt()` config, instance, hooks, and cache types). Inference helpers
 * live separately in `type-utils.ts`.
 *
 * @module
 */

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
} from './context-types'

export type { PromptCallback, SystemField, PromptField, PromptContent } from './content-types'

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
