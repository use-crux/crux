/**
 * Context compaction primitives.
 *
 * @module
 */

// Compaction primitives
export { summarizeMessages } from './summarize'
export { createSlidingWindow } from './sliding-window'
export { createBudgetManager } from './budget'
export { extractKeyFacts } from './extract'

// Types
export type {
  GenerateTextFn,
  GenerateObjectFn,
  SummarizeConfig,
  SlidingWindowConfig,
  SlidingWindow,
  SlidingWindowStats,
  BudgetConfig,
  BudgetManager,
  BudgetState,
  ExtractConfig,
} from './types'

// Re-export CompactionResult from messages for convenience
export type { CompactionResult } from '../messages'
