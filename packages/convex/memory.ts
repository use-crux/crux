/**
 * Convex runtime profile for `@crux/core/memory`.
 *
 * This subpath mirrors the core memory API. The only behavioral difference is
 * that `memory()` can late-bind the Convex Crux store and default namespace
 * from the active Convex runtime.
 *
 * @module
 */

import { memory as coreMemory } from '@crux/core/memory'
import type { Memory, MemoryConfig, MemoryNamespace } from '@crux/core/memory'
import { convexRuntimeStore, resolveConvexMemoryNamespace } from './runtime'

export {
  inMemoryCruxStore,
  memoryBlock,
  recentMessages,
  workingState,
  episodes,
  facts,
  procedures,
  reflections,
  toMemoryEntry,
  toStoreValue,
} from '@crux/core/memory'

export type {
  CruxStore,
  EmbedFn,
  JsonObject,
  ListOptions,
  ListResult,
  Memory,
  MemoryBlock,
  MemoryBlockConfig,
  MemoryBlockContext,
  MemoryBlockKind,
  MemoryConfig,
  MemoryEntryApi,
  MemoryMessage,
  MemoryNamespace,
  MemoryPolicy,
  MemoryProposal,
  MemoryProposalStatus,
  MemoryRuntimeOptions,
  MemoryToolEvent,
  MemoryTurn,
  MemoryWriteMode,
  RawMemoryDocument,
  ScoredEntry,
  SparseVector,
  StoreEntry,
  ToolConfig,
  VectorSearchOptions,
  VectorSearchQuery,
} from '@crux/core/memory'

export type ConvexMemoryConfig = Omit<MemoryConfig, 'namespace'> & {
  namespace?: MemoryNamespace
}

export function memory(config: ConvexMemoryConfig): Memory {
  return coreMemory({
    ...config,
    store: config.store ?? convexRuntimeStore,
    namespace: config.namespace ?? ((args) => resolveConvexMemoryNamespace(args)),
  })
}
