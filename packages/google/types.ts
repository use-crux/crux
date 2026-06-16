import type { Content } from '@google/genai'

/** Google GenAI function declaration for tool use. */
export interface GoogleFunctionDeclaration {
  readonly name: string
  readonly description: string
  readonly parameters?: {
    readonly type: string
    readonly properties: Record<string, unknown>
    readonly required?: string[]
  }
}

/** Provider-specific extra options for the Google adapter. */
export interface GoogleExtra extends Record<string, unknown> {
  /** Function declarations for tool use, bypassing Crux tool conversion. */
  readonly tools?: GoogleFunctionDeclaration[]
  /**
   * Per-call CachedContent controls.
   *
   * These options affect only the current request. `skip` falls back to a
   * plain `systemInstruction`, while `ttlSeconds` overrides the adapter-level
   * default TTL for a newly-created cache and participates in local cache
   * reuse keys.
   */
  readonly cache?: {
    /** Force skip caching for this call. */
    readonly skip?: boolean
    /** TTL in seconds for this call's Google CachedContent object. */
    readonly ttlSeconds?: number
  }
}

/** Provider-native Google generation request assembled by the profile. */
export interface GoogleRequest extends Record<string, unknown> {
  /** Google model identifier. */
  readonly model: string
  /** Google content transcript. */
  readonly contents: Content[] | string
  /** Google generation config. */
  readonly config?: Record<string, unknown>
}

/** Configuration for a Crux dense embedding backed by Google embeddings. */
export interface GoogleEmbeddingConfig {
  /** Crux embedding name. */
  readonly name: string
  /** Google embedding model id. */
  readonly model: string
  /** Output vector dimensionality. */
  readonly dimensions: number
  /** Maximum input tokens advertised to Crux callers. */
  readonly maxInputTokens: number
  /** Batch sizing and concurrency hints for Crux embedding calls. */
  readonly batch?: {
    readonly maxSize?: number
    readonly concurrency?: number
  }
  /** Google embedding task type. */
  readonly taskType?: string
  /** Optional title for retrieval-document embeddings. */
  readonly title?: string
  /** Optional MIME type hint. */
  readonly mimeType?: string
  /** Whether Google may truncate inputs automatically. */
  readonly autoTruncate?: boolean
}
