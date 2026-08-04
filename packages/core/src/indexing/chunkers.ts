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
import { createMediaPartChunk, mediaParts } from './media-chunks'
import {
  coarseProvenance,
  mergeProvenance,
  provenanceForPart,
} from './provenance'
import { sourceFactsWithLocations } from './source-facts'
import { embeddingBoundaries, normalizeBoundaries, sentenceSegments, splitDocumentSlices } from './text-split'
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
    : [{ id: 'text:1', kind: 'text' as const, content: document.content ?? '' }]
  const chunks: CruxChunk[] = []
  const tableRowsPerChunk = 'tableRowsPerChunk' in options ? (options.tableRowsPerChunk ?? 25) : 25

  for (const part of parts) {
    if (part.kind === 'media') {
      chunks.push(createMediaPartChunk(document, part, chunks.length))
      continue
    }
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

    const rawChunks = splitDocumentSlices(part.content, normalized)
    rawChunks.forEach((slice) => {
      chunks.push(
        createPartChunk(
          document,
          slice.content,
          chunks.length,
          provenanceForPart(document, part, slice.content, { start: slice.start, end: slice.end }),
        ),
      )
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
        ...coarseProvenance([part]),
        confidence: 'derived',
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
  const source = sourceFactsWithLocations(document.source, provenance?.sourceLocations ?? [])
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
    ...(source ? { source } : {}),
    ...(document.title ? { parent: { title: document.title } } : {}),
    ...(provenance ? { provenance } : {}),
  }
}

function provenanceForChildSlice(
  document: CruxDocument,
  parentContent: string,
  parentProvenance: ChunkProvenance | undefined,
  slice: { readonly start: number; readonly end: number },
): ChunkProvenance | undefined {
  if (!parentProvenance) return undefined
  const { sourceSpans: _sourceSpans, ...coarse } = parentProvenance
  const parentSpan = parentProvenance.sourceSpans?.length === 1 ? parentProvenance.sourceSpans[0] : undefined
  const canTranslate =
    parentProvenance.confidence === 'exact' &&
    parentSpan !== undefined &&
    document.content?.slice(parentSpan.start, parentSpan.end) === parentContent
  if (!canTranslate || parentSpan === undefined) {
    return { ...coarse, confidence: 'derived' }
  }
  return {
    ...coarse,
    sourceSpans: [{
      start: parentSpan.start + slice.start,
      end: parentSpan.start + slice.end,
      ...(parentSpan.partId ? { partId: parentSpan.partId } : {}),
    }],
    confidence: 'exact',
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
    if (sourceChunk.media) {
      flushParent()
      children.push({ ...sourceChunk, ordinal: children.length })
      continue
    }
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
    const source = sourceFactsWithLocations(document.source, provenance?.sourceLocations ?? [])
    parents.push({
      namespace: document.namespace,
      sourceId: document.sourceId,
      parentId,
      ordinal: parentOrdinal,
      content: currentParentContent,
      metadata: document.metadata ?? {},
      ...(source ? { source } : {}),
      ...(provenance ? { provenance } : {}),
    })
    const rawChildren = splitDocumentSlices(currentParentContent, {
      maxChars: options.childMaxChars,
      overlapChars: options.childOverlapChars,
    })
    rawChildren.forEach((slice) => {
      const childProvenance = provenanceForChildSlice(document, currentParentContent, provenance, slice)
      const childSource = sourceFactsWithLocations(document.source, childProvenance?.sourceLocations ?? [])
      children.push({
        namespace: document.namespace,
        sourceId: document.sourceId,
        chunkId: createStableId('chunk', {
          sourceId: document.sourceId,
          parentId,
          ordinal: children.length,
          content: slice.content,
        }),
        ordinal: children.length,
        content: slice.content,
        metadata: document.metadata ?? {},
        ...(childSource ? { source: childSource } : {}),
        parent: {
          parentId,
          ...(document.title ? { title: document.title } : {}),
        },
        ...(childProvenance ? { provenance: childProvenance } : {}),
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
  const content = document.content ?? document.parts
    ?.filter((part) => part.kind !== 'media')
    .map((part) => part.content)
    .join('\n\n') ?? ''
  if (!content) {
    return {
      chunks: mediaParts(document).map((part, ordinal) =>
        createMediaPartChunk(document, part, ordinal)),
    }
  }
  const textDocument = { ...document, content }
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const minChars = 'minChars' in options ? (options.minChars ?? 200) : 200
  const segments = sentenceSegments(content)
  let boundaries: SemanticBoundary[] = []

  if (options.strategy === 'model' || options.strategy === 'custom') {
    boundaries = await options.segment({ document, segments }, { maxChars, minChars })
  } else if (options.strategy === 'hybrid') {
    boundaries = await options.segment({ document, segments }, { maxChars, minChars })
    if (!boundaries.length) {
      boundaries = await embeddingBoundaries(textDocument, segments, options.dense, {
        maxChars,
        minChars,
        similarityThreshold: options.similarityThreshold,
      })
    }
  } else if (options.strategy === 'embedding') {
    boundaries = await embeddingBoundaries(textDocument, segments, options.dense, {
      maxChars,
      minChars,
      similarityThreshold: options.similarityThreshold,
    })
  }

  const normalized = content ? normalizeBoundaries(boundaries, content.length) : []
  const chunks: CruxChunk[] = normalized.map((boundary, ordinal) => {
    const chunkContent = content.slice(boundary.start, boundary.end)
    const sourceSpans = document.content === content
      ? [{ start: boundary.start, end: boundary.end }]
      : []
    return {
      namespace: document.namespace,
      sourceId: document.sourceId,
      chunkId: createStableId('chunk', { sourceId: document.sourceId, boundary, content: chunkContent }),
      ordinal,
      content: chunkContent,
      metadata: {
        ...(document.metadata ?? {}),
        semanticReason: boundary.reason ?? options.strategy,
        ...(boundary.confidence !== undefined ? { semanticConfidence: boundary.confidence } : {}),
      },
      ...(document.source ? { source: document.source } : {}),
      ...(document.title ? { parent: { title: document.title } } : {}),
      provenance: {
        ...(sourceSpans.length ? { sourceSpans } : {}),
        confidence: sourceSpans.length ? 'exact' as const : 'derived' as const,
      },
    }
  })
  for (const part of mediaParts(document)) {
    chunks.push(createMediaPartChunk(document, part, chunks.length))
  }
  return { chunks }
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}
