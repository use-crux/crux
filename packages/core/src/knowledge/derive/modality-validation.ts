/**
 * Multimodal evidence validation for connected knowledge generation.
 *
 * Target media chunks are fail-closed: uncovered evidence is never silently
 * omitted. Context-only media chunks are context, not evidence — they render
 * when they can and are dropped with a warning when they cannot.
 *
 * @module
 */

import type { z } from 'zod'
import type { AssetStore } from '../../asset'
import type { CruxChunk } from '../../indexing/types'
import type { KnowledgeContentPart, KnowledgeModality, KnowledgeModel } from '../model'
import { chunkKey } from './target-selection'

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
  /** Optional target chunk keys; media outside the target set is context-only. */
  readonly targetKeys?: ReadonlySet<string>
}

/** Generate a structured object, routing multimodal chunks through content parts. */
export async function generateObjectWithEvidence<T>(
  input: KnowledgeGenerationRequest<T>,
): Promise<{ object: T; warnings: readonly string[] }> {
  const uncovered = mediaOnlyChunks(input.chunks)
  if (uncovered.length === 0) {
    return { ...(await generatePlain(input)), warnings: [] }
  }

  const generate = input.model.generateObjectFromParts
  const parts: KnowledgeContentPart[] = []
  const warnings: string[] = []
  for (const chunk of uncovered) {
    const isTarget = input.targetKeys === undefined || input.targetKeys.has(chunkKey(chunk))
    try {
      if (!generate) throw new Error(`${diagnosticPrefix(input, [chunk])} missing generateObjectFromParts.`)
      parts.push(...(await contentPartsFor(input, generate, chunk)))
    } catch (error) {
      if (isTarget) throw error
      warnings.push(`${diagnosticPrefix(input, [chunk])}; dropped context media chunk.`)
    }
  }

  if (!generate || parts.length === 0) {
    return { ...(await generatePlain(input)), warnings }
  }
  const generated = await generate({
    system: input.system,
    parts: [{ kind: 'text', text: input.prompt }, ...parts],
    schema: input.schema,
  })
  return { ...generated, warnings }
}

async function contentPartsFor<T>(
  input: KnowledgeGenerationRequest<T>,
  generate: NonNullable<KnowledgeGenerationRequest<T>['model']['generateObjectFromParts']>,
  chunk: MediaOnlyChunk,
): Promise<readonly KnowledgeContentPart[]> {
  const declared = new Set(input.model.modalities ?? ['text'])
  if (chunk.modality === 'media' || !declared.has(chunk.modality)) {
    throw new Error(diagnosticPrefix(input, [chunk]))
  }
  if (!input.assets) {
    throw new Error(`${diagnosticPrefix(input, [chunk])} missing config.storage.assets.`)
  }
  if (!chunk.assetRef) {
    throw new Error(`${diagnosticPrefix(input, [chunk])} missing source.assetRef.`)
  }
  const bytesRef = await input.assets.get(chunk.assetRef)
  const isTarget = input.targetKeys === undefined || input.targetKeys.has(chunkKey(chunk))
  return [
    { kind: 'text', text: `${isTarget ? 'Media evidence' : 'Media'}: ${chunk.sourceId}/${chunk.chunkId}` },
    { kind: 'media', mediaType: chunk.mediaType, bytesRef },
  ]
}

function generatePlain<T>(input: KnowledgeGenerationRequest<T>): Promise<{ object: T }> {
  return input.model.generateObject({
    system: input.system,
    prompt: input.prompt,
    schema: input.schema,
  })
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
