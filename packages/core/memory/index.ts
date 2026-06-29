/**
 * `@use-crux/core/memory` — Block-based memory for AI applications.
 *
 * Use `memory()` to compose reusable memory blocks into prompts and agents.
 * Blocks can also be used directly from application code, cron jobs, and
 * admin workflows by passing `{ store, namespace }`.
 *
 * @module
 */

// Storage helpers
export { toStoreValue, toMemoryEntry } from './utils'
export type { RawMemoryDocument } from './utils'

// Re-export CruxStore types for convenience
export { inMemoryCruxStore } from '../store/memory'
export type {
  CruxStore,
  JsonObject,
  StoreEntry,
  ListOptions,
  ListResult,
  ScoredEntry,
  SparseVector,
  VectorSearchOptions,
  VectorSearchQuery,
  EmbedFn,
  ToolConfig,
} from '../store/types'

// Block-based memory primitives
export {
  memory,
  memoryBlock,
  recentMessages,
  workingState,
  episodes,
  facts,
  procedures,
  reflections,
} from './block-system'
export type {
  Memory,
  MemoryBudget,
  MemoryBlock,
  MemoryBlockConfig,
  MemoryBlockContext,
  MemoryBlockKind,
  MemoryCaptureConfig,
  MemoryCaptureMode,
  MemoryConfig,
  MemoryEntryApi,
  MemoryEntryRenderStrategy,
  MemoryListRenderStrategy,
  MemoryMessage,
  MemoryNamespace,
  MemoryPolicy,
  MemoryProposal,
  MemoryProposalStatus,
  MemoryRenderQuery,
  MemoryRuntimeOptions,
  MemorySemanticRenderStrategy,
  MemoryToolEvent,
  MemoryTurn,
  MemoryWriteMode,
} from './block-system'
