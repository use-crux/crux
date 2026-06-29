/**
 * Deprecated memory storage compatibility types.
 *
 * The beta Memory Blocks contract uses `CruxStore` from `@use-crux/core/store`.
 * Import store types from `@use-crux/core/store` or `@use-crux/core/memory`
 * instead of this private compatibility file.
 *
 * @module
 */

import type {
  CruxStore,
  EmbedFn,
  ListOptions,
  ScoredEntry,
  StoreEntry,
  ToolConfig,
  VectorSearchOptions,
} from '../store/types'

/**
 * @deprecated Use `CruxStore` from `@use-crux/core/store`.
 */
export type MemoryStore = CruxStore

/**
 * @deprecated Use `StoreEntry` from `@use-crux/core/store`.
 */
export type MemoryEntry = StoreEntry

/**
 * @deprecated Use `ListOptions` from `@use-crux/core/store`.
 */
export type { ListOptions }

/**
 * @deprecated Use `VectorSearchOptions` from `@use-crux/core/store`.
 */
export type { VectorSearchOptions }

/**
 * @deprecated Use `ScoredEntry` from `@use-crux/core/store`.
 */
export type { ScoredEntry }

/**
 * @deprecated Use `EmbedFn` from `@use-crux/core/store`.
 */
export type { EmbedFn }

/**
 * @deprecated Use `ToolConfig` from `@use-crux/core/store`.
 */
export type { ToolConfig }
