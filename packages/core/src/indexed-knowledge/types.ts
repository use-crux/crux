/**
 * Internal contracts for the indexed knowledge read model.
 *
 * This module is intentionally not exported from the package root. Public
 * callers continue to use `indexer()`, `retriever()`, retrieval pipelines, and
 * built-in stages while this boundary owns the persisted record contract.
 *
 * @module
 */

import type { CruxChunk, CruxParentChunk } from '../indexing/types'
import type { ExactFilter, RecordStore, SparseVector, VectorStore } from '../storage'
import type { RetrieverHit } from '../retrieval/types'

/** Storage ports required by the indexed knowledge read model. */
export interface IndexedKnowledgeStoreConfig {
  /** Indexer id used for persisted key derivation. */
  readonly indexerId: string
  /** Namespace for all records handled by this store instance. */
  readonly namespace: string
  /** Durable JSON records containing chunk and parent records. */
  readonly records: RecordStore
  /** Optional split vector store for dense, sparse, or hybrid search. */
  readonly vectors?: VectorStore
}

/** Internal read-model API for indexed chunks and parent records. */
export interface IndexedKnowledgeStore {
  /** Persist one active generation of chunk and parent records. */
  persistGeneration(input: PersistIndexedGenerationInput): Promise<PersistIndexedGenerationResult>
  /** Search active chunk records and map them to retriever hits. */
  searchChunks(query: IndexedChunkSearchQuery): Promise<readonly RetrieverHit[]>
  /** Load a parent record by stored or derived parent reference. */
  getParent(ref: IndexedParentRef): Promise<IndexedParentRecord | null>
  /** Hydrate one hit with its parent record when a parent reference exists. */
  expandParent(hit: RetrieverHit, options?: ParentExpansionOptions): Promise<RetrieverHit>
  /** Mark older active records for the given sources inactive. */
  deactivatePreviousGenerations(sourceIds: readonly string[], activeGenerationId: string): Promise<void>
  /** Delete every record and vector for one source. */
  deleteSource(sourceId: string): Promise<number>
  /** Delete every record and vector in this index namespace. */
  clearNamespace(): Promise<number>
}

/** Input for writing one indexed generation. */
export interface PersistIndexedGenerationInput {
  /** Child chunks to persist. */
  readonly chunks: readonly CruxChunk[]
  /** Parent chunks to persist. */
  readonly parents: readonly CruxParentChunk[]
  /** Dense embeddings aligned by index with `chunks`. */
  readonly dense?: readonly number[][]
  /** Sparse embeddings aligned by index with `chunks`. */
  readonly sparse?: readonly SparseVector[]
  /** Whether older active generations for these sources should be deactivated. */
  readonly replaceSources: boolean
  /** Optional write timestamp, mostly useful for deterministic tests. */
  readonly now?: number
}

/** Result returned after one generation is persisted. */
export interface PersistIndexedGenerationResult {
  /** Generated id assigned to every record in the batch. */
  readonly generationId: string
  /** Number of unique source ids written. */
  readonly sourceCount: number
  /** Number of chunk records written. */
  readonly chunkCount: number
}

/** Search query over active indexed chunks. */
export interface IndexedChunkSearchQuery {
  /** Vector search mode. */
  readonly mode: 'dense' | 'sparse' | 'hybrid'
  /** Dense query vector for dense or hybrid search. */
  readonly dense?: readonly number[]
  /** Sparse query vector for sparse or hybrid search. */
  readonly sparse?: SparseVector
  /** Maximum number of hits to return. */
  readonly limit?: number
  /** Minimum vector similarity score. */
  readonly threshold?: number
  /** User filter merged with namespace, record type, and active-generation filters. */
  readonly filter?: ExactFilter
  /** Optional fusion algorithm for hybrid-capable vector stores. */
  readonly fusion?: 'rrf' | 'dbsf'
}

/** Reference to an indexed parent record. */
export interface IndexedParentRef {
  /** Source id that owns the parent record. */
  readonly sourceId: string
  /** Parent id within the source. */
  readonly parentId?: string
  /** Fully derived parent key, when already stored on a hit. */
  readonly key?: string
}

/** Options for parent hydration. */
export interface ParentExpansionOptions {
  /** Maximum parent content length to attach to the hit. */
  readonly maxParentChars?: number
  /** Behavior when a referenced parent record is missing. Defaults to `warn`. */
  readonly missing?: 'ignore' | 'warn' | 'error'
}

/** Persisted active parent record exposed inside the read-model boundary. */
export interface IndexedParentRecord {
  readonly parentId: string
  readonly sourceId: string
  readonly content: string
  readonly metadata: Record<string, unknown>
}
