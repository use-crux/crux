/**
 * Chunking strategy implementations.
 *
 * Structured (part-aware, with table windowing), parent-child (coarse parents
 * + fine children), and semantic (embedding/model boundary) chunkers. These
 * back the {@link chunker} registry.
 *
 * @module
 */

import { DEFAULT_MAX_CHARS, normalizeChunkingOptions } from './chunking-options'
import { createStableId } from './hash'
import {
  coarseProvenance,
  mergeProvenance,
  provenanceForPart,
  sourceSpanForContent,
} from './provenance'
import { embeddingBoundaries, normalizeBoundaries, sentenceSegments, splitDocument } from './text-split'
import type {
  ChunkerContext,
  ChunkingResult,
  ChunkProvenance,
  CruxChunk,
  CruxDocument,
  CruxIngestPart,
  CruxParentChunk,
  ParentChildChunkerOptions,
  SemanticBoundary,
  SemanticChunkerOptions,
  StructuredChunkerOptions,
  ChunkingOptions,
} from './types'

/** Structured chunker: splits each typed part, windowing table rows. */
export function chunkDocumentStructured(
  document: CruxDocument,
  ctx: ChunkerContext,
  options: StructuredChunkerOptions | ChunkingOptions = {},
): ChunkingResult {
  const normalized = normalizeChunkingOptions({
    maxChars: options.maxChars ?? ctx.chunking.maxChars,
    overlapChars: options.overlapChars ?? ctx.chunking.overlapChars,
  })
  const parts = document.parts?.length
    ? document.parts
    : [{ id: 'text:1', kind: 'text' as const, content: document.content }]
  const chunks: CruxChunk[] = []
  const tableRowsPerChunk = 'tableRowsPerChunk' in options ? (options.tableRowsPerChunk ?? 25) : 25

  for (const part of parts) {
    if (part.kind === 'table') {
      chunks.push(...chunkTablePart(document, part, tableRowsPerChunk))
      continue
    }
    if (part.kind === 'json') {
      chunks.push(createPartChunk(document, part.content, chunks.length, provenanceForPart(document, part)))
      continue
    }
    if (part.kind === 'sheet') {
      chunks.push(createPartChunk(document, part.content, chunks.length, provenanceForPart(document, part)))
      continue
    }

    const rawChunks = splitDocument(part.content, normalized)
    rawChunks.forEach((content) => {
      chunks.push(createPartChunk(document, content, chunks.length, provenanceForPart(document, part, content)))
    })
  }

  return { chunks }
}

function chunkTablePart(
  document: CruxDocument,
  part: Extract<CruxIngestPart, { kind: 'table' }>,
  rowsPerChunk: number,
): CruxChunk[] {
  const rows = part.rows?.length
    ? part.rows
    : part.content.split('\n').map((row) => row.split('|').map((cell) => cell.trim()))
  if (!rows.length) return []
  const header = part.columns ?? rows[0]
  const bodyRows = rows.length > 1 && arraysEqual(rows[0], header) ? rows.slice(1) : rows
  const chunks: CruxChunk[] = []
  for (let index = 0; index < bodyRows.length; index += rowsPerChunk) {
    const windowRows = bodyRows.slice(index, index + rowsPerChunk)
    const renderedRows = [header, ...windowRows].map((row) => row.join(' | ')).join('\n')
    chunks.push(
      createPartChunk(document, renderedRows, chunks.length, {
        ...provenanceForPart(document, part),
        sourceSpans: sourceSpanForContent(document, part.content, part.id),
      }),
    )
  }
  return chunks
}

function createPartChunk(
  document: CruxDocument,
  content: string,
  ordinal: number,
  provenance?: ChunkProvenance,
): CruxChunk {
  return {
    namespace: document.namespace,
    sourceId: document.sourceId,
    chunkId: createStableId('chunk', {
      sourceId: document.sourceId,
      ordinal,
      content,
      provenance,
    }),
    ordinal,
    content,
    metadata: document.metadata ?? {},
    ...(document.title ? { parent: { title: document.title } } : {}),
    ...(provenance ? { provenance } : {}),
  }
}

/** Parent-child chunker: coarse parents grouping fine, overlapping children. */
export function chunkDocumentParentChild(
  document: CruxDocument,
  options: Required<ParentChildChunkerOptions>,
): ChunkingResult {
  const structured = chunkDocumentStructured(
    document,
    { chunking: { maxChars: options.parentMaxChars, overlapChars: 0 } },
    { maxChars: options.parentMaxChars, overlapChars: 0 },
  )
  const parents: CruxParentChunk[] = []
  const children: CruxChunk[] = []
  let currentParentContent = ''
  let currentParentChunks: CruxChunk[] = []

  for (const sourceChunk of structured.chunks) {
    const candidate = currentParentContent ? `${currentParentContent}\n\n${sourceChunk.content}` : sourceChunk.content
    if (candidate.length > options.parentMaxChars && currentParentChunks.length > 0) {
      flushParent()
      currentParentContent = sourceChunk.content
      currentParentChunks = [sourceChunk]
      continue
    }
    currentParentContent = candidate
    currentParentChunks.push(sourceChunk)
  }
  flushParent()

  return { chunks: children, parents }

  function flushParent(): void {
    if (!currentParentContent) return
    const parentOrdinal = parents.length
    const parentId = createStableId('parent', {
      sourceId: document.sourceId,
      ordinal: parentOrdinal,
      content: currentParentContent,
    })
    const provenance = mergeProvenance(
      currentParentChunks.map((chunk) => chunk.provenance).filter(Boolean) as ChunkProvenance[],
    )
    parents.push({
      namespace: document.namespace,
      sourceId: document.sourceId,
      parentId,
      ordinal: parentOrdinal,
      content: currentParentContent,
      metadata: document.metadata ?? {},
      ...(provenance ? { provenance } : {}),
    })
    const rawChildren = splitDocument(currentParentContent, {
      maxChars: options.childMaxChars,
      overlapChars: options.childOverlapChars,
    })
    rawChildren.forEach((content) => {
      children.push({
        namespace: document.namespace,
        sourceId: document.sourceId,
        chunkId: createStableId('chunk', {
          sourceId: document.sourceId,
          parentId,
          ordinal: children.length,
          content,
        }),
        ordinal: children.length,
        content,
        metadata: document.metadata ?? {},
        parent: {
          parentId,
          ...(document.title ? { title: document.title } : {}),
        },
        ...(provenance ? { provenance } : {}),
      })
    })
    currentParentContent = ''
    currentParentChunks = []
  }
}

/** Semantic chunker: splits at embedding/model-derived boundaries. */
export async function chunkDocumentSemantic(
  document: CruxDocument,
  options: SemanticChunkerOptions,
): Promise<ChunkingResult> {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const minChars = 'minChars' in options ? (options.minChars ?? 200) : 200
  const segments = sentenceSegments(document.content)
  let boundaries: SemanticBoundary[] = []

  if (options.strategy === 'model' || options.strategy === 'custom') {
    boundaries = await options.segment({ document, segments }, { maxChars, minChars })
  } else if (options.strategy === 'hybrid') {
    boundaries = await options.segment({ document, segments }, { maxChars, minChars })
    if (!boundaries.length) {
      boundaries = await embeddingBoundaries(document, segments, options.dense, {
        maxChars,
        minChars,
        similarityThreshold: options.similarityThreshold,
      })
    }
  } else if (options.strategy === 'embedding') {
    boundaries = await embeddingBoundaries(document, segments, options.dense, {
      maxChars,
      minChars,
      similarityThreshold: options.similarityThreshold,
    })
  }

  const normalized = normalizeBoundaries(boundaries, document.content.length)
  const chunks = normalized.map((boundary, ordinal) => {
    const content = document.content.slice(boundary.start, boundary.end).trim()
    return {
      namespace: document.namespace,
      sourceId: document.sourceId,
      chunkId: createStableId('chunk', { sourceId: document.sourceId, boundary, content }),
      ordinal,
      content,
      metadata: {
        ...(document.metadata ?? {}),
        semanticReason: boundary.reason ?? options.strategy,
        ...(boundary.confidence !== undefined ? { semanticConfidence: boundary.confidence } : {}),
      },
      ...(document.title ? { parent: { title: document.title } } : {}),
      provenance: {
        sourceSpans: [{ start: boundary.start, end: boundary.end }],
        confidence: 'exact' as const,
      },
    }
  })
  return { chunks }
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}
