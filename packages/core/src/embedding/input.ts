/**
 * Embedding input normalization.
 *
 * This module owns the provider-neutral boundary from public embedding inputs
 * to validated inputs. Media validation delegates to the canonical content
 * boundary so embedding and generation reject malformed sources identically.
 *
 * @module
 */

import type {
  EmbeddingInput,
  EmbeddingInputByModality,
  EmbeddingModality,
  NormalizedEmbeddingInput,
} from './modality'
import { normalizeInvocationMediaSource } from '../content/invocation-media'
import { createInvalidMediaSourceError } from '../content/media-errors'
import { sha256Hex } from '../content/sha256'
import { EmbeddingModalityError } from './errors'
import { inferModality } from './modality'
import type { Asset } from '../asset'
import type { MediaSource } from '../types/content'

type MediaModality = Exclude<EmbeddingModality, 'text'>
type TypedMediaInput = EmbeddingInputByModality[MediaModality]

/** Options identifying the embedding whose input is being normalized. */
export interface NormalizeEmbeddingInputOptions {
  /** Human-readable embedding identity used in actionable errors. */
  readonly embeddingName: string
  /** Modalities the embedding can encode into its vector space. */
  readonly supported: readonly EmbeddingModality[]
}

/**
 * Normalize one public embedding input before provider execution.
 *
 * @param input - Text or media accepted by the configured embedding.
 * @param options - Embedding identity and declared modality support.
 * @returns A validated provider-neutral input.
 * @throws {@link EmbeddingModalityError} when the embedding cannot encode the input modality.
 */
export async function normalizeEmbeddingInput(
  input: EmbeddingInput,
  options: NormalizeEmbeddingInputOptions,
): Promise<NormalizedEmbeddingInput> {
  if (typeof input === 'string') {
    assertSupported('text', options)
    return { type: 'text', text: input }
  }
  if (input.type === 'text') {
    assertSupported('text', options)
    return { type: 'text', text: input.text }
  }
  if (isTypedMediaInput(input)) {
    assertSupported(input.type, options)
    return normalizeMediaInput(input.type, input.source, 'embedding.input.source', input.mediaType)
  }
  if (isAssetInput(input)) {
    const modality = inferModality(input.mediaType)
    if (!isMediaModality(modality)) {
      throw createInvalidMediaSourceError({
        path: 'embedding.input',
        reason: 'Bare Asset input requires a mediaType so its modality can be inferred. Use a typed media part such as { type: "image", source: asset }.',
      })
    }
    assertSupported(modality, options)
    return normalizeMediaInput(modality, input, 'embedding.input')
  }
  throw new TypeError(`Embedding "${options.embeddingName}" input is not implemented for this modality.`)
}

function isTypedMediaInput(
  input: Exclude<EmbeddingInput, string>,
): input is TypedMediaInput {
  return input.type === 'image' || input.type === 'audio' || input.type === 'video' || input.type === 'document'
}

function isAssetInput(input: Exclude<EmbeddingInput, string>): input is Asset {
  return input.type === 'data' || input.type === 'url' || input.type === 'provider-file'
}

function assertSupported(
  modality: EmbeddingModality,
  options: NormalizeEmbeddingInputOptions,
): void {
  if (options.supported.includes(modality)) return
  throw new EmbeddingModalityError({
    embeddingName: options.embeddingName,
    modality,
    supported: options.supported,
  })
}

function isMediaModality(
  modality: EmbeddingModality | undefined,
): modality is MediaModality {
  return modality !== undefined && modality !== 'text'
}

async function normalizeMediaInput(
  modality: MediaModality,
  source: MediaSource,
  path: string,
  mediaType?: string,
): Promise<NormalizedEmbeddingInput> {
  const asset = await normalizeInvocationMediaSource({
    kind: modality === 'document' ? 'file' : modality,
    source,
    path,
    mediaType,
  })
  if (asset.type !== 'data' || !(asset.data instanceof Uint8Array)) {
    return { type: modality, asset }
  }
  const sha256 = sha256Hex(asset.data)
  return {
    type: modality,
    asset: { ...asset, sha256 },
    sha256,
  }
}
