/**
 * `@use-crux/core/memory` — Block-based memory for AI applications.
 *
 * Use `memory()` to compose reusable memory blocks into prompts and agents.
 * Blocks can also be used directly from application code, cron jobs, and
 * admin workflows by passing `{ records, namespace }`.
 *
 * @module
 */

// Storage helpers
export { toStoreValue } from './utils'
export type { RawMemoryDocument } from './utils'

// Re-export Storage Beta helpers for convenience
export { inMemoryRecordStore, inMemoryStorage, inMemoryVectorStore } from '../storage'
export type {
  ExactFilter,
  JsonObject,
  RecordEntry,
  RecordListOptions,
  RecordPage,
  RecordStore,
  SparseVector,
  VectorSearchQuery,
  Storage,
  VectorHit,
  VectorStore,
} from '../storage'

// Block-based memory primitives
export {
  memory,
  memoryBlock,
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
