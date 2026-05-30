/**
 * Memory storage types for `@crux/core/memory`.
 *
 * Defines the contract between memory primitives and their backing storage.
 * Implementations: `inMemoryStore()` (testing), `cruxConvexStore()` (production).
 *
 * @module
 */

// ─────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────

/** Embed function — developer provides this, any embedding provider works. */
export type EmbedFn = (text: string) => Promise<number[]>

/** Configuration for generated memory tool descriptions. */
export interface ToolConfig {
  /** Custom description for the tool. Overrides the auto-generated default. */
  description: string
}

/** A single entry in a memory store. */
export interface MemoryEntry {
  /** Unique key for this entry. */
  key: string
  /** The text content of this entry. */
  content: string
  /** Arbitrary metadata for filtering and context. */
  metadata: Record<string, unknown>
  /** Pre-computed embedding vector. Set by memory primitives, not the store. */
  embedding?: number[]
  /** When this entry was first created. */
  createdAt: Date
  /** When this entry was last updated. */
  updatedAt: Date
}

/** Options for listing entries. */
export interface ListOptions {
  /** Filter entries whose key starts with this prefix. */
  prefix?: string
  /** Maximum number of entries to return. */
  limit?: number
  /** Cursor for pagination. */
  cursor?: string
  /** Filter by metadata field values. */
  filter?: Record<string, unknown>
}

/** Options for vector similarity search. */
export interface VectorSearchOptions {
  /** Maximum number of results to return. */
  limit?: number
  /** Minimum similarity score (0–1). */
  threshold?: number
  /** Filter by metadata field values. */
  filter?: Record<string, unknown>
}

/** A memory entry with its similarity score from vector search. */
export interface ScoredEntry extends MemoryEntry {
  /** Cosine similarity score (0–1). */
  score: number
}

// ─────────────────────────────────────────────────────────────────
// MemoryStore Interface
// ─────────────────────────────────────────────────────────────────

/**
 * Storage adapter interface for memory primitives.
 *
 * Two-tier interface:
 * 1. **Plain data tier** (always available): CRUD on key-value entries with metadata.
 * 2. **Vector tier** (opt-in per entry): Entries can include a pre-computed `embedding`.
 *    `vectorSearch()` returns entries ranked by similarity. Returns empty array if
 *    no entries have embeddings.
 *
 * Implementations:
 * - `inMemoryStore()` — Map-backed, for testing. Cosine similarity for vector search.
 * - `cruxConvexStore()` — Convex-backed, for production. Native vector search index.
 */
export interface MemoryStore {
  // ── Plain data tier ──

  /** Get a single entry by key. Returns `null` if not found. */
  get(key: string): Promise<MemoryEntry | null>

  /** Set an entry. Creates or overwrites. Timestamps are managed by the store. */
  set(key: string, entry: Omit<MemoryEntry, 'key' | 'createdAt' | 'updatedAt'>): Promise<void>

  /** Delete an entry by key. No-op if not found. */
  delete(key: string): Promise<void>

  /** List entries with optional prefix/metadata filtering. */
  list(options?: ListOptions): Promise<MemoryEntry[]>

  // ── Vector tier (optional) ──

  /**
   * Search entries by vector similarity.
   *
   * Returns entries ranked by cosine similarity to the given embedding.
   * Returns empty array if no entries have embeddings.
   * Optional — stores without vector capabilities can omit this.
   */
  vectorSearch?(embedding: number[], options?: VectorSearchOptions): Promise<ScoredEntry[]>
}
