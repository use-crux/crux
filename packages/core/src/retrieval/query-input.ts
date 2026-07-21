/** Retrieval input normalization and privacy-safe query labels. @module */

import { EmbeddingModalityError, normalizeEmbeddingInput } from '../embedding'
import type { DenseEmbedding, EmbeddingInput, EmbeddingModality, SparseEmbedding } from '../embedding'
import type { RetrieveRequest } from './request'

const ALL_EMBEDDING_MODALITIES = ['text', 'image', 'audio', 'video', 'document'] as const

/** Canonical query input prepared before embedding or recipe execution. */
export interface PreparedRetrievalInput<
  TModality extends EmbeddingModality = EmbeddingModality,
> {
  readonly input: EmbeddingInput<TModality>
  readonly modality: TModality
  readonly label: string
  readonly text?: string
  readonly media: boolean
}

/** Normalize a request input and validate store-backed modality support. */
export async function prepareRetrievalInput<TModality extends EmbeddingModality>(
  request: RetrieveRequest<import('../storage').ExactFilter, TModality>,
  config: { readonly dense?: DenseEmbedding<TModality>; readonly sparse?: SparseEmbedding },
): Promise<PreparedRetrievalInput<TModality>> {
  const prepared = await prepareNormalizedRetrievalInput(request, {
    embeddingName: config.dense?.name ?? config.sparse?.name ?? 'retriever',
    supported: config.dense?.modalities ?? ['text'],
  })
  // Runtime normalization above proves the modality belongs to the embedding's
  // declared set; this cast preserves that existential relationship internally.
  return prepared as unknown as PreparedRetrievalInput<TModality>
}

/** Normalize a recipe input without imposing one source retriever's capabilities. */
export function prepareRecipeRetrievalInput(
  request: RetrieveRequest,
): Promise<PreparedRetrievalInput> {
  return prepareNormalizedRetrievalInput(request, {
    embeddingName: 'retrieval recipe',
    supported: ALL_EMBEDDING_MODALITIES,
  })
}

async function prepareNormalizedRetrievalInput(
  request: RetrieveRequest,
  options: { readonly embeddingName: string; readonly supported: readonly EmbeddingModality[] },
): Promise<PreparedRetrievalInput> {
  const normalized = await normalizeEmbeddingInput(
    'query' in request && request.query !== undefined ? request.query : request.input,
    options,
  )
  if (normalized.type === 'text') {
    return {
      input: normalized.text,
      modality: 'text',
      label: normalized.text,
      text: normalized.text,
      media: false,
    }
  }
  return {
    input: { type: normalized.type, source: normalized.asset },
    modality: normalized.type,
    label: `<media:${normalized.type}>`,
    media: true,
  }
}

/** Throw the standard text-only error for sparse media retrieval. */
export function assertSparseRetrievalInput<TModality extends EmbeddingModality>(
  prepared: PreparedRetrievalInput<TModality>,
  sparse: SparseEmbedding,
): asserts prepared is PreparedRetrievalInput<TModality> & { readonly text: string; readonly media: false } {
  if (!prepared.media && prepared.text !== undefined) return
  throw new EmbeddingModalityError({
    embeddingName: sparse.name,
    modality: prepared.modality,
    supported: sparse.modalities,
  })
}
