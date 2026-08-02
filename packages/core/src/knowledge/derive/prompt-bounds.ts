/**
 * Bounded prompt rendering for connected-knowledge derivation.
 *
 * @module
 */

import { z } from 'zod'
import { stableStringify } from '../../indexing/hash'
import type { CruxChunk, CruxDocument } from '../../indexing/types'
import type { AssertionStage } from '../assertions/assertions'
import type { RelationStage, RelationTypeSpec } from '../relate/relate'
import { MAX_DERIVE_CHUNK_CHARS, MAX_DERIVE_PROMPT_CHARS } from './bounds'

/** Rendered derive prompt plus deterministic truncation warnings. */
export interface BoundedDerivePrompt {
  /** Prompt text after applying derive prompt bounds. */
  readonly prompt: string
  /** Warnings for every deterministic truncation applied while rendering. */
  readonly warnings: readonly string[]
}

/** Render a bounded relation derive prompt. */
export function renderBoundedRelationPrompt(
  document: CruxDocument,
  chunks: readonly CruxChunk[],
  stage: RelationStage<Record<string, RelationTypeSpec>>,
): BoundedDerivePrompt {
  const vocabulary = Object.entries(stage.types).map(([name, spec]) =>
    `${name}: ${spec.description}; from ${spec.from.join('|')}; to ${spec.to.join('|')}`)
  return renderBoundedPrompt({
    stageId: stage.id,
    document,
    chunks,
    vocabulary,
    chunkLabel: (chunk) => `[${chunk.chunkId}]`,
    instructions: stage.instructions,
  })
}

/** Render a bounded assertion derive prompt. */
export function renderBoundedAssertionPrompt(
  document: CruxDocument,
  chunks: readonly CruxChunk[],
  stage: AssertionStage<Record<string, z.ZodType<unknown>>>,
): BoundedDerivePrompt {
  const vocabulary = Object.entries(stage.types).map(([name, schema]) =>
    `${name}: ${stableStringify(z.toJSONSchema(schema))}`)
  return renderBoundedPrompt({
    stageId: stage.id,
    document,
    chunks,
    vocabulary,
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

function renderBoundedPrompt(args: {
  readonly stageId: string
  readonly document: CruxDocument
  readonly chunks: readonly CruxChunk[]
  readonly vocabulary: readonly string[]
  readonly chunkLabel: (chunk: CruxChunk) => string
  readonly instructions?: string
}): BoundedDerivePrompt {
  const warnings: string[] = []
  const boundedDocument = boundWithWarning(
    args.document.content ?? '',
    MAX_DERIVE_CHUNK_CHARS,
    contentWarning(args.stageId, args.document.sourceId, 'document body'),
  )
  warnings.push(...boundedDocument.warnings)
  const boundedChunks = args.chunks.map((chunk) => {
    const bounded = boundWithWarning(
      chunk.content,
      MAX_DERIVE_CHUNK_CHARS,
      contentWarning(args.stageId, chunk.sourceId, 'chunk', chunk.chunkId),
    )
    warnings.push(...bounded.warnings)
    return `${args.chunkLabel(chunk)} ${bounded.prompt}`
  })
  const prompt = boundWithWarning([
    args.instructions ?? '',
    `Source: ${args.document.sourceId}`,
    args.document.title ? `Title: ${args.document.title}` : '',
    `Vocabulary:\n${args.vocabulary.join('\n')}`,
    `Document:\n${boundedDocument.prompt}`,
    `Chunks:\n${boundedChunks.join('\n')}`,
  ].filter(Boolean).join('\n\n'), MAX_DERIVE_PROMPT_CHARS, promptWarning(args.stageId, args.document.sourceId, 'prompt'))
  warnings.push(...prompt.warnings)
  return { prompt: prompt.prompt, warnings }
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

function contentWarning(
  stageId: string,
  sourceId: string,
  subject: 'document body' | 'chunk',
  chunkId?: string,
): (originalLength: number, boundedLength: number) => string {
  return (originalLength, boundedLength) =>
    `Derive ${stageId} truncated ${subject} for source ${sourceId}` +
    `${chunkId ? ` chunk ${chunkId}` : ''}: ${originalLength} -> ${boundedLength} chars.`
}

function promptWarning(
  stageId: string,
  sourceId: string,
  subject: 'prompt' | 'repair prompt',
): (originalLength: number, boundedLength: number) => string {
  return (originalLength, boundedLength) =>
    `Derive ${stageId} truncated ${subject} for source ${sourceId}: ${originalLength} -> ${boundedLength} chars.`
}
