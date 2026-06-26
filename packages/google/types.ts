import type { Content } from '@google/genai'
import type { GoogleCachedContentCallOptions } from './cache-types'

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
   * Per-call Google CachedContent controls.
   *
   * These options affect only the current request. Use `skip` to bypass
   * CachedContent resolution and send a plain `systemInstruction`, or
   * `ttlSeconds` to override the adapter default for any new cache created by
   * this request. Provider-neutral cache hints still come from
   * `SystemBlock.providerCache` in `@crux/core`.
   */
  readonly cachedContent?: GoogleCachedContentCallOptions
}

/** Provider-native Google generation request assembled by the provider runtime. */
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
