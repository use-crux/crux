/** Input selection and modality validation for indexing embeddings. @module */

import { EmbeddingModalityError } from '../embedding'
import type { CruxEmbedding, DenseEmbedding, EmbeddingInput } from '../embedding'
import type { CruxChunk } from './types'

/** Embed selected chunks with the indexing document role. */
export async function embedStageChunks<TVector>(
  embedding: CruxEmbedding,
  chunks: readonly CruxChunk[],
): Promise<TVector[]> {
  if (embedding.kind === 'sparse') {
    return embedding.embedMany(chunks.map((chunk) => chunk.content)) as Promise<TVector[]>
  }
  const inputs: EmbeddingInput[] = chunks.map((chunk) => chunk.media
    ? { type: chunk.media.modality, source: chunk.media.asset }
    : { type: 'text', text: chunk.content })
  return embedding.embedMany(inputs, { role: 'document' }) as Promise<TVector[]>
}

/** Fail before provider I/O when indexed media exceeds dense capabilities. */
export function assertStageModalities(embedding: DenseEmbedding, chunks: readonly CruxChunk[]): void {
  const modalities = embedding.modalities ?? ['text']
  const unsupported = chunks.filter((chunk) =>
    chunk.media && !modalities.includes(chunk.media.modality),
  )
  if (unsupported.length === 0) return
  const error = new EmbeddingModalityError({
    embeddingName: embedding.name,
    modality: unsupported[0].media?.modality ?? 'text',
    supported: modalities,
  })
  error.message += ` Offending sourceIds: ${[...new Set(unsupported.map((chunk) => chunk.sourceId))].join(', ')}.`
  throw error
}

/** Count privacy-safe embedding inputs by modality. */
export function stageModalityCounts(chunks: readonly CruxChunk[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const chunk of chunks) {
    const modality = chunk.media?.modality ?? 'text'
    counts[modality] = (counts[modality] ?? 0) + 1
  }
  return counts
}
