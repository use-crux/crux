/**
 * Fail-closed multimodal evidence validation for connected knowledge generation.
 *
 * @module
 */

import type { z } from 'zod'
import type { AssetStore } from '../../asset'
import type { CruxChunk } from '../../indexing/types'
import type { KnowledgeContentPart, KnowledgeModality, KnowledgeModel } from '../model'

type NonTextModality = Exclude<KnowledgeModality, 'text'>
type DiagnosticModality = NonTextModality | 'media'

/** Generation request after uncovered media evidence has been checked. */
export interface KnowledgeGenerationRequest<T> {
  readonly model: KnowledgeModel
  readonly system: string
  readonly prompt: string
  readonly schema: z.ZodType<T>
  readonly sourceId: string
  readonly chunks: readonly CruxChunk[]
  readonly subject: string
  readonly assets?: AssetStore
}

/** Generate a structured object without silently omitting media-only evidence. */
export async function generateObjectWithEvidence<T>(
  input: KnowledgeGenerationRequest<T>,
): Promise<{ object: T }> {
  const uncovered = mediaOnlyChunks(input.chunks)
  if (uncovered.length === 0) {
    return input.model.generateObject({
      system: input.system,
      prompt: input.prompt,
      schema: input.schema,
    })
  }

  const parts = await contentPartsFor(input, uncovered)
  const generate = input.model.generateObjectFromParts
  if (!generate) {
    throw new Error(`${diagnosticPrefix(input, uncovered)} missing generateObjectFromParts.`)
  }
  return generate({ system: input.system, parts, schema: input.schema })
}

async function contentPartsFor<T>(
  input: KnowledgeGenerationRequest<T>,
  uncovered: readonly MediaOnlyChunk[],
): Promise<readonly KnowledgeContentPart[]> {
  const declared = new Set(input.model.modalities ?? ['text'])
  for (const chunk of uncovered) {
    if (chunk.modality === 'media' || !declared.has(chunk.modality)) {
      throw new Error(diagnosticPrefix(input, [chunk]))
    }
  }
  if (!input.assets) {
    throw new Error(`${diagnosticPrefix(input, uncovered)} missing config.storage.assets.`)
  }

  const parts: KnowledgeContentPart[] = [{ kind: 'text', text: input.prompt }]
  for (const chunk of uncovered) {
    if (!chunk.assetRef) {
      throw new Error(`${diagnosticPrefix(input, [chunk])} missing source.assetRef.`)
    }
    const bytesRef = await input.assets.get(chunk.assetRef)
    parts.push(
      { kind: 'text', text: `Media evidence: ${chunk.sourceId}/${chunk.chunkId}` },
      { kind: 'media', mediaType: chunk.mediaType, bytesRef },
    )
  }
  return parts
}

interface MediaOnlyChunk {
  readonly sourceId: string
  readonly chunkId: string
  readonly mediaType: string
  readonly modality: DiagnosticModality
  readonly assetRef?: CruxChunk['source'] extends infer T
    ? T extends { readonly assetRef?: infer TRef } ? TRef : never
    : never
}

function mediaOnlyChunks(chunks: readonly CruxChunk[]): readonly MediaOnlyChunk[] {
  return chunks.flatMap((chunk) => {
    if (chunk.content.trim().length > 0 || !chunk.source?.mediaType) return []
    const modality = modalityForMediaType(chunk.source.mediaType)
    if (modality === 'text') return []
    return [{
      sourceId: chunk.sourceId,
      chunkId: chunk.chunkId,
      mediaType: chunk.source.mediaType,
      modality,
      ...(chunk.source.assetRef ? { assetRef: chunk.source.assetRef } : {}),
    }]
  })
}

function modalityForMediaType(mediaType: string): KnowledgeModality | 'media' {
  const essence = mediaType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (essence.startsWith('text/')) return 'text'
  if (essence.startsWith('image/')) return 'image'
  if (essence.startsWith('audio/')) return 'audio'
  if (essence.startsWith('video/')) return 'video'
  return 'media'
}

function diagnosticPrefix<T>(
  input: KnowledgeGenerationRequest<T>,
  chunks: readonly MediaOnlyChunk[],
): string {
  const ids = chunks.map((chunk) => chunk.chunkId).join(', ')
  const modalities = [...new Set(chunks.map((chunk) => chunk.modality))].join(', ')
  return [
    `${input.subject} cannot cover media-only evidence`,
    `source "${input.sourceId}"`,
    `chunks "${ids}"`,
    `modality "${modalities}"`,
    'provide a text representation at ingestion or configure a model declaring the modality.',
  ].join('; ')
}
