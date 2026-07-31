/**
 * Context compaction primitives.
 *
 * @module
 */

// Compaction primitives
export { summarizeMessages } from './summarize'
export { compactConversation } from './compact-conversation'
export { createBudgetManager } from './budget'
export { extractKeyFacts } from './extract'
export { createGenerateObjectFnFromGenerate } from './generate-object'

// Types
export type {
  GenerateTextFn,
  CompactionMediaConfig,
  GenerateObjectFn,
  SummarizeConfig,
  CompactConversationArgs,
  BudgetConfig,
  BudgetManager,
  BudgetState,
  ExtractConfig,
} from './types'
export type { GenerateObjectAdapterGenerateFn, GenerateObjectBridgeOptions } from './generate-object'

// Re-export CompactionResult from messages for convenience
export type { CompactionResult } from '../generation/messages'
