/**
 * Convex runtime profile for `@use-crux/core/memory`.
 *
 * This subpath mirrors the core memory API. The only behavioral difference is
 * that `memory()` can late-bind Convex-backed storage and default namespace
 * from the active Convex runtime.
 *
 * @module
 */

import { memory as coreMemory } from '@use-crux/core/memory'
import type { Memory, MemoryConfig, MemoryNamespace } from '@use-crux/core/memory'
import { convexRuntimeStorage, resolveConvexMemoryNamespace } from './runtime'

export {
  inMemoryRecordStore,
  inMemoryStorage,
  inMemorySearchStore,
  memoryBlock,
  workingState,
  episodes,
  facts,
  procedures,
  reflections,
  toStoreValue,
} from '@use-crux/core/memory'

export type {
  ExactFilter,
  JsonObject,
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
  RecordEntry,
  RecordListOptions,
  RecordPage,
  RecordStore,
  SearchHit,
  SearchQuery,
  SearchStore,
  SparseVector,
  Storage,
} from '@use-crux/core/memory'

export type { SearchRecord } from '@use-crux/core/storage'

export type ConvexMemoryConfig = Omit<MemoryConfig, 'namespace'> & {
  namespace?: MemoryNamespace
}

export function memory(config: ConvexMemoryConfig): Memory {
  const resolved = config.storage || config.records || config.search ? config : { ...config, storage: convexRuntimeStorage }
  return coreMemory({
    ...resolved,
    namespace: config.namespace ?? ((args) => resolveConvexMemoryNamespace(args)),
  })
}
