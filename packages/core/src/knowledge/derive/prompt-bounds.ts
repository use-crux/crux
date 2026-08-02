/**
 * Deterministic prompt batching for connected-knowledge derivation.
 *
 * @module
 */

import { z } from 'zod'
import { stableStringify } from '../../indexing/hash'
import type { CruxChunk, CruxDocument } from '../../indexing/types'
import type { AssertionStage } from '../assertions/assertions'
import type { RelationStage, RelationTypeSpec } from '../relate/relate'
import { MAX_DERIVE_BATCH_CHARS, MAX_DERIVE_PROMPT_CHARS } from './bounds'

const MEDIA_PART_ESTIMATE_CHARS = 3000

/** Rendered derive prompt plus deterministic truncation warnings. */
export interface BoundedDerivePrompt {
  /** Prompt text after applying derive prompt bounds. */
  readonly prompt: string
  /** Warnings for every deterministic truncation applied while rendering. */
  readonly warnings: readonly string[]
}

/** One complete generated extraction batch for a source/stage pair. */
export interface DerivePromptBatch extends BoundedDerivePrompt {
  /** Zero-based batch ordinal after deterministic chunk ordering. */
  readonly ordinal: number
  /** Chunks visible to this batch. */
  readonly chunks: readonly CruxChunk[]
}

/** Sort chunks into the deterministic derive processing order. */
export function orderDeriveChunks(chunks: readonly CruxChunk[]): readonly CruxChunk[] {
  return [...chunks].sort((left, right) =>
    left.ordinal - right.ordinal ||
    left.sourceId.localeCompare(right.sourceId) ||
    left.chunkId.localeCompare(right.chunkId))
}

/** Render bounded relation derive batches. */
export function renderBoundedRelationBatches(
  document: CruxDocument,
  chunks: readonly CruxChunk[],
  stage: RelationStage<Record<string, RelationTypeSpec>>,
): readonly DerivePromptBatch[] {
  return renderBatches({
    stageId: stage.id,
    document,
    chunks,
    vocabulary: Object.entries(stage.types).map(([name, spec]) =>
      `${name}: ${spec.description}; from ${spec.from.join('|')}; to ${spec.to.join('|')}`),
    chunkLabel: (chunk) => `[${chunk.chunkId}]`,
    instructions: stage.instructions,
  })
}

/** Render bounded assertion derive batches. */
export function renderBoundedAssertionBatches(
  document: CruxDocument,
  chunks: readonly CruxChunk[],
  stage: AssertionStage<Record<string, z.ZodType<unknown>>>,
): readonly DerivePromptBatch[] {
  return renderBatches({
    stageId: stage.id,
    document,
    chunks,
    vocabulary: Object.entries(stage.types).map(([name, schema]) =>
      `${name}: ${stableStringify(z.toJSONSchema(schema))}`),
    chunkLabel: (chunk) => `[${chunk.sourceId}/${chunk.chunkId}]`,
    instructions: stage.instructions,
  })
}

/** Add repair instructions and re-apply the final prompt bound. */
export function renderBoundedRepairPrompt(args: {
  readonly stageId: string
  readonly sourceId: string
  readonly prompt: string
  readonly errors: readonly string[]
}): BoundedDerivePrompt {
  return boundWithWarning(
    `${args.prompt}\n\nFix these validation errors:\n${args.errors.join('\n')}`,
    MAX_DERIVE_PROMPT_CHARS,
    promptWarning(args.stageId, args.sourceId, 'repair prompt'),
  )
}

function renderBatches(args: {
  readonly stageId: string
  readonly document: CruxDocument
  readonly chunks: readonly CruxChunk[]
  readonly vocabulary: readonly string[]
  readonly chunkLabel: (chunk: CruxChunk) => string
  readonly instructions?: string
}): readonly DerivePromptBatch[] {
  const ordered = orderDeriveChunks(args.chunks)
  const batches = chunkBatches(args, ordered)
  return batches.length > 0
    ? batches.map((batch, index) => renderBatch(args, batch, index))
    : [renderBatch(args, [], 0)]
}

function chunkBatches(
  args: Parameters<typeof renderBatches>[0],
  chunks: readonly CruxChunk[],
): readonly (readonly CruxChunk[])[] {
  const batches: CruxChunk[][] = []
  let current: CruxChunk[] = []
  for (const chunk of chunks) {
    const candidate = [...current, chunk]
    if (fitsWithoutDocument(args, candidate)) {
      current = candidate
      continue
    }
    if (current.length > 0) {
      batches.push(current)
      current = []
    }
    current.push(fitsWithoutDocument(args, [chunk]) ? chunk : truncateSingleChunk(args, chunk))
    batches.push(current)
    current = []
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function renderBatch(
  args: Parameters<typeof renderBatches>[0],
  chunks: readonly CruxChunk[],
  ordinal: number,
): DerivePromptBatch {
  const warnings = chunks.flatMap((chunk) => truncationWarning(args.stageId, chunk))
  const documentExcerpt = ordinal === 0 ? fitDocumentExcerpt(args, chunks) : ''
  return { ordinal, chunks, prompt: promptText(args, chunks, documentExcerpt), warnings }
}

function fitsWithoutDocument(args: Parameters<typeof renderBatches>[0], chunks: readonly CruxChunk[]): boolean {
  if (estimatedChunkChars(chunks) > MAX_DERIVE_BATCH_CHARS) return false
  return promptText(args, chunks, '').length <= MAX_DERIVE_PROMPT_CHARS
}

function truncateSingleChunk(args: Parameters<typeof renderBatches>[0], chunk: CruxChunk): CruxChunk {
  if (chunk.content.length === 0) return chunk
  let low = 0
  let high = Math.min(chunk.content.length, MAX_DERIVE_BATCH_CHARS)
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = { ...chunk, content: chunk.content.slice(0, mid) }
    if (promptText(args, [candidate], '').length <= MAX_DERIVE_PROMPT_CHARS) low = mid
    else high = mid - 1
  }
  return { ...chunk, content: chunk.content.slice(0, low), metadata: { ...chunk.metadata, _deriveTruncatedFrom: chunk.content.length } }
}

function fitDocumentExcerpt(args: Parameters<typeof renderBatches>[0], chunks: readonly CruxChunk[]): string {
  const content = args.document.content ?? ''
  let low = 0
  let high = content.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (promptText(args, chunks, content.slice(0, mid)).length <= MAX_DERIVE_PROMPT_CHARS) low = mid
    else high = mid - 1
  }
  return content.slice(0, low)
}

function promptText(
  args: Parameters<typeof renderBatches>[0],
  chunks: readonly CruxChunk[],
  documentExcerpt: string,
): string {
  return [
    args.instructions ?? '',
    `Source: ${args.document.sourceId}`,
    args.document.title ? `Title: ${args.document.title}` : '',
    `Vocabulary:\n${args.vocabulary.join('\n')}`,
    documentExcerpt ? `Document:\n${documentExcerpt}` : '',
    `Chunks:\n${chunks.map((chunk) => `${args.chunkLabel(chunk)} ${chunk.content}`).join('\n')}`,
  ].filter(Boolean).join('\n\n')
}

function estimatedChunkChars(chunks: readonly CruxChunk[]): number {
  return chunks.reduce((total, chunk) => total + (isMediaOnlyChunk(chunk) ? MEDIA_PART_ESTIMATE_CHARS : chunk.content.length), 0)
}

function isMediaOnlyChunk(chunk: CruxChunk): boolean {
  return chunk.content.trim().length === 0 && Boolean(chunk.source?.mediaType)
}

function truncationWarning(stageId: string, chunk: CruxChunk): readonly string[] {
  const original = chunk.metadata._deriveTruncatedFrom
  return typeof original === 'number'
    ? [`Derive ${stageId} truncated chunk for source ${chunk.sourceId} chunk ${chunk.chunkId}: ${original} -> ${chunk.content.length} chars.`]
    : []
}

function boundWithWarning(
  value: string,
  max: number,
  warning: (originalLength: number, boundedLength: number) => string,
): BoundedDerivePrompt {
  if (value.length <= max) return { prompt: value, warnings: [] }
  const bounded = value.slice(0, max)
  return { prompt: bounded, warnings: [warning(value.length, bounded.length)] }
}

function promptWarning(
  stageId: string,
  sourceId: string,
  subject: 'repair prompt',
): (originalLength: number, boundedLength: number) => string {
  return (originalLength, boundedLength) =>
    `Derive ${stageId} truncated ${subject} for source ${sourceId}: ${originalLength} -> ${boundedLength} chars.`
}
