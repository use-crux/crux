/**
 * Public modality and input contracts for native embeddings.
 *
 * Inputs preserve their modality until normalization. Bare strings require
 * text support; bare assets require at least one declared media modality and
 * are inferred from their media type before provider execution.
 *
 * @module
 */

import type { Asset } from '../asset'
import type { MediaSource } from '../types/content'

/** Modalities a native embedding model can encode into one vector space. */
export type EmbeddingModality = 'text' | 'image' | 'audio' | 'video' | 'document'

/** Typed embedding inputs keyed by the modality they encode. */
export interface EmbeddingInputByModality {
  readonly text: { readonly type: 'text'; readonly text: string }
  readonly image: { readonly type: 'image'; readonly source: MediaSource; readonly mediaType?: string }
  readonly audio: { readonly type: 'audio'; readonly source: MediaSource; readonly mediaType?: string }
  readonly video: { readonly type: 'video'; readonly source: MediaSource; readonly mediaType?: string }
  readonly document: { readonly type: 'document'; readonly source: MediaSource; readonly mediaType?: string }
}

/**
 * One input accepted by an embedding supporting `TModality`.
 *
 * Bare strings are available only when text is supported. Bare assets are
 * available only when at least one media modality is supported; refs are never
 * model input and must first be hydrated by their owning asset store.
 */
export type EmbeddingInput<TModality extends EmbeddingModality = EmbeddingModality> =
  | ('text' extends TModality ? string : never)
  | (Exclude<TModality, 'text'> extends never ? never : Asset)
  | EmbeddingInputByModality[TModality]

/** A validated embedding input ready for a provider adapter. */
export type NormalizedEmbeddingInput =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: Exclude<EmbeddingModality, 'text'>
      readonly asset: Asset
      /** SHA-256 of media bytes already available without provider or network I/O. */
      readonly sha256?: string
    }

/**
 * Infer an embedding modality from a MIME media type.
 *
 * @param mediaType - MIME type whose essence determines the modality.
 * @returns The inferred modality, or `undefined` when no media type is known.
 */
export function inferModality(mediaType: string | undefined): EmbeddingModality | undefined {
  const normalized = mediaType?.split(';', 1)[0]?.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized.startsWith('image/')) return 'image'
  if (normalized.startsWith('audio/')) return 'audio'
  if (normalized.startsWith('video/')) return 'video'
  return 'document'
}
