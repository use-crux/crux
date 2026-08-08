/**
 * Deterministic prompt batching for connected-knowledge derivation.
 *
 * @module
 */

import { z } from 'zod'
import type { CruxChunk, CruxDocument } from '../../indexing/types'
import type { AssertionStage } from '../assertions/assertions'
import type { RelationStage, RelationTypeSpec } from '../relate/relate'
import { MAX_DERIVE_BATCH_CHARS, MAX_DERIVE_PROMPT_CHARS } from './bounds'
import { chunkKey } from './target-selection'
import { compileAssertionWire, type AssertionWireManifest } from './assertion-wire'

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
  /** The subset of chunk in {@link DerivePromptBatch.chunks} that may be cited as evidence. */
  readonly targetChunks: readonly CruxChunk[]
  /** Transport-only labels decoded to canonical chunks before claim validation. */
  readonly evidenceRefs: readonly EvidenceRef[]
}

export interface EvidenceRef {
  readonly label: string
  readonly chunk: CruxChunk
  readonly citeable: boolean
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
  targetKeys?: ReadonlySet<string>,
): readonly DerivePromptBatch[] {
  const { manifest } = compileAssertionWire(stage.types)
  return renderBatches({
    stageId: stage.id,
    document,
    chunks,
    targetKeys,
    vocabulary: assertionWireVocabulary(manifest),
    chunkLabel: (chunk) => `${chunk.sourceId}/${chunk.chunkId}`,
    evidenceAliases: true,
    instructions: stage.instructions,
  })
}

function assertionWireVocabulary(manifest: AssertionWireManifest): readonly string[] {
  return [
    'Return every required slot. Use [] when that assertion kind is absent.',
    'Do not duplicate an assertion across slots or batches. Cite only target evidence and only emit evidence-supported claims.',
    'Choose provenance exact for explicit text or derived for a supported inference.',
    ...manifest.slots.map((entry) => `${entry.slot} = ${entry.type}; ${entry.mode === 'typed'
      ? `data: ${entry.expectedShape}`
      : `dataJson: JSON string encoding ${entry.expectedShape}`}`),
  ]
}

/** Add repair instructions and re-apply the final prompt bound. */
export function renderBoundedRepairPrompt(args: {
  readonly stageId: string
  readonly sourceId: string
  readonly prompt: string
  /** Slots containing invalid material; every other slot must be returned as []. */
  readonly invalidSlots?: readonly string[]
  readonly errors: readonly string[]
}): BoundedDerivePrompt {
  return boundWithWarning(
    `${args.prompt}\n\nRepair only these invalid slots: ${args.invalidSlots?.join(', ') || '(none; remove unknown slots)'}. ` +
    `Return [] for every retained slot so valid first-pass material is not repeated. Remove unknown slots.\n` +
    `Fix these validation errors:\n${args.errors.join('\n')}`,
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
  readonly targetKeys?: ReadonlySet<string>
  readonly evidenceAliases?: boolean
}): readonly DerivePromptBatch[] {
  const ordered = orderDeriveChunks(args.chunks)
  const groups = chunkBatches(args, ordered)
  return groups.length > 0
    ? groups.map((group, index) => renderBatch(args, group, index))
    : [renderBatch(args, { chunks: [], dropped: [] }, 0)]
}

function chunkBatches(
  args: Parameters<typeof renderBatches>[0],
  chunks: readonly CruxChunk[],
): readonly { readonly chunks: readonly CruxChunk[]; readonly dropped: readonly CruxChunk[] }[] {
  if (args.targetKeys === undefined) {
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
      if (fitsWithoutDocument(args, [chunk])) {
        current = [chunk]
      } else {
        batches.push([truncateSingleChunk(args, chunk)])
      }
    }
    if (current.length > 0) batches.push(current)
    return batches.map((batch) => ({ chunks: batch, dropped: [] }))
  }

  const targets = chunks.filter((chunk) => args.targetKeys!.has(chunkKey(chunk)))
  if (targets.length === 0) return []
  const groups: { readonly chunks: readonly CruxChunk[]; readonly dropped: readonly CruxChunk[] }[] = []
  for (const target of targets) {
    const batch: CruxChunk[] = [target]
    const dropped: CruxChunk[] = []
    if (fitsWithoutDocument(args, batch)) {
      const targetIndex = chunks.indexOf(target)
      let left = targetIndex - 1
      let right = targetIndex + 1
      while (left >= 0 || right < chunks.length) {
        const leftDistance = left < 0 ? Number.POSITIVE_INFINITY : targetIndex - left
        const rightDistance = right >= chunks.length ? Number.POSITIVE_INFINITY : right - targetIndex
        const fromLeft = leftDistance <= rightDistance
        const candidate = fromLeft ? chunks[left]! : chunks[right]!
        const stopSide = (): void => {
          if (fromLeft) left = -1
          else right = chunks.length
        }
        if (args.targetKeys!.has(chunkKey(candidate))) {
          stopSide()
          continue
        }
        const next = [...batch, candidate]
        if (fitsWithoutDocument(args, next)) {
          batch.push(candidate)
        } else {
          dropped.push(candidate)
        }
        if (fromLeft) left -= 1
        else right += 1
      }
    } else {
      batch[0] = truncateSingleChunk(args, target)
    }
    groups.push({ chunks: batch, dropped })
  }
  return groups
}

function renderBatch(
  args: Parameters<typeof renderBatches>[0],
  group: { readonly chunks: readonly CruxChunk[]; readonly dropped: readonly CruxChunk[] },
  ordinal: number,
): DerivePromptBatch {
  const { chunks } = group
  const evidenceRefs = batchEvidenceRefs(chunks, args.targetKeys)
  const warnings = [
    ...chunks.flatMap((chunk) => truncationWarning(args.stageId, chunk)),
    ...group.dropped.map((chunk) =>
      `Derive ${args.stageId} dropped context chunk for source ${chunk.sourceId} chunk ${chunk.chunkId} from batch ${ordinal}.`),
  ]
  const documentExcerpt = ordinal === 0 ? fitDocumentExcerpt(args, chunks) : ''
  const targetKeys = args.targetKeys
  return {
    ordinal,
    chunks,
    targetChunks: targetKeys === undefined ? chunks : chunks.filter((chunk) => targetKeys.has(chunkKey(chunk))),
    evidenceRefs,
    prompt: promptText(args, chunks, documentExcerpt),
    warnings,
  }
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
  const evidenceRefs = batchEvidenceRefs(chunks, args.targetKeys)
  const chunkLines = args.evidenceAliases === true
    ? evidenceRefs.map(({ label, chunk, citeable }) =>
        `${citeable ? '[TARGET:]' : '[CONTEXT:]'} [${label} | ${args.chunkLabel(chunk)}] ${chunk.content}`)
    : chunks.map((chunk) => `${roleLabel(args.targetKeys, chunks, chunk)}${args.chunkLabel(chunk)} ${chunk.content}`)
  return [
    args.instructions ?? '',
    `Source: ${args.document.sourceId}`,
    args.document.title ? `Title: ${args.document.title}` : '',
    `Vocabulary:\n${args.vocabulary.join('\n')}`,
    documentExcerpt ? `Document:\n${documentExcerpt}` : '',
    `Chunks:\n${chunkLines.join('\n')}`,
  ].filter(Boolean).join('\n\n')
}

function batchEvidenceRefs(
  chunks: readonly CruxChunk[],
  targetKeys: ReadonlySet<string> | undefined,
): readonly EvidenceRef[] {
  let evidenceOrdinal = 0
  let contextOrdinal = 0

  return chunks.map((chunk) => {
    const citeable = targetKeys === undefined || targetKeys.has(chunkKey(chunk))
    const label = citeable ? `e${evidenceOrdinal++}` : `c${contextOrdinal++}`

    return { label, chunk, citeable }
  })
}

/** Render a role marker only when a batch actually mixes target and context chunks. */
function roleLabel(targetKeys: ReadonlySet<string> | undefined, chunks: readonly CruxChunk[], chunk: CruxChunk): string {
  if (targetKeys === undefined) return ''
  const hasContext = chunks.some((candidate) => !targetKeys.has(chunkKey(candidate)))
  if (!hasContext) return ''
  return targetKeys.has(chunkKey(chunk)) ? '[TARGET:] ' : '[CONTEXT:] '
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
