import type { Content } from '@google/genai'
import type { EmbeddingModality } from '@use-crux/core/embedding'
import type { GoogleCachedContentCallOptions } from './cached-content'

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
   * `SystemBlock.providerCache` in `@use-crux/core`.
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

interface GoogleEmbeddingConfigBase<
  TModel extends string = string,
  TModalities extends readonly EmbeddingModality[] | undefined =
    | readonly EmbeddingModality[]
    | undefined,
> {
  /** Google embedding model id. */
  readonly model: TModel
  /** Native input modalities. Known literal model ids receive verified defaults. */
  readonly modalities?: TModalities
  /** Additional vector-semantic revision appended to the derived request identity. */
  readonly version?: string
  /** Batch sizing and concurrency hints for Crux embedding calls. */
  readonly batch?: {
    readonly maxSize?: number
    readonly concurrency?: number
  }
  /**
   * Role-specific Google task types for models that support `taskType`.
   * Gemini Embedding 2 does not; encode its text task instructions in input.
   */
  readonly tasks?: { readonly query?: string; readonly document?: string }
  /** Optional title for retrieval-document embeddings. */
  readonly title?: string
  /** Optional MIME type hint. */
  readonly mimeType?: string
  /** Whether Google may truncate inputs automatically. */
  readonly autoTruncate?: boolean
}

interface GoogleEmbeddingSizing {
  /** Crux embedding name. */
  readonly name: string
  /** Output vector dimensionality. */
  readonly dimensions: number
  /** Maximum input tokens advertised to Crux callers. */
  readonly maxInputTokens: number
}

/** Configuration for a Crux dense embedding backed by Google embeddings. */
export type GoogleEmbeddingConfig<
  TModel extends string = string,
  TModalities extends readonly EmbeddingModality[] | undefined =
    | readonly EmbeddingModality[]
    | undefined,
> = GoogleEmbeddingConfigBase<TModel, TModalities> & (
  TModel extends 'gemini-embedding-2'
    ? Partial<GoogleEmbeddingSizing>
    : GoogleEmbeddingSizing
)
