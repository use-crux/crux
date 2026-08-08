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
  sourceSpanForPartSlice,
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
  CruxIngestPageTableBlock,
  CruxIngestPageTextBlock,
  CruxParentChunk,
  ParentChildChunkerOptions,
  SemanticBoundary,
  SemanticChunkerOptions,
  StructuredChunkerOptions,
  ChunkingOptions,
  SpreadsheetCellProvenance,
  SpreadsheetProvenance,
} from './types'

/** Structured chunker: splits each typed part, windowing table rows. */
export function chunkDocumentStructured(
  document: CruxDocument,
  ctx: ChunkerContext,
  options: StructuredChunkerOptions | ChunkingOptions = {},
): ChunkingResult {
  return { chunks: chunkDocumentStructuredUnits(document, ctx, options).map((unit) => unit.chunk) }
}

interface StructuredUnit {
  readonly chunk: CruxChunk
  readonly pageId?: string
  readonly headingPath: readonly string[]
  readonly headingInstanceIds: readonly string[]
  readonly kind: 'narrative' | 'table' | 'media'
}

function chunkDocumentStructuredUnits(
  document: CruxDocument,
  ctx: ChunkerContext,
  options: StructuredChunkerOptions | ChunkingOptions = {},
): StructuredUnit[] {
  const normalized = normalizeChunkingOptions({
    maxChars: options.maxChars ?? ctx.chunking.maxChars,
    overlapChars: options.overlapChars ?? ctx.chunking.overlapChars,
  })
  const parts = document.parts?.length
    ? document.parts
    : [{ id: 'text:1', kind: 'text' as const, content: document.content ?? '' }]
  const units: StructuredUnit[] = []
  const requestedTableRows = 'tableRowsPerChunk' in options ? (options.tableRowsPerChunk ?? 25) : 25
  const tableRowsPerChunk = Number.isFinite(requestedTableRows) && requestedTableRows > 0
    ? Math.max(1, Math.floor(requestedTableRows))
    : 1

  for (const part of parts) {
    if (part.kind === 'media') {
      units.push({
        chunk: createMediaPartChunk(document, part, units.length),
        headingPath: [], headingInstanceIds: [], kind: 'media',
      })
      continue
    }
    if (part.kind === 'table') {
      units.push(...chunkTablePart(document, part, tableRowsPerChunk).map((chunk) => ({
        chunk, headingPath: [], headingInstanceIds: [], kind: 'table' as const,
      })))
      continue
    }
    if (part.kind === 'json') {
      units.push({
        chunk: createPartChunk(document, part.content, units.length, provenanceForPart(document, part)),
        headingPath: [], headingInstanceIds: [], kind: 'narrative',
      })
      continue
    }
    if (part.kind === 'sheet') {
      units.push({
        chunk: createPartChunk(document, part.content, units.length, provenanceForPart(document, part)),
        headingPath: [], headingInstanceIds: [], kind: 'narrative',
      })
      continue
    }
    if (part.kind === 'page' && part.blocks?.length) {
      units.push(...chunkPageNarrative(document, part, normalized, tableRowsPerChunk, units.length))
      continue
    }

    const rawChunks = splitDocumentSlices(part.content, normalized)
    rawChunks.forEach((slice) => {
      units.push({
        chunk: createPartChunk(
          document,
          slice.content,
          units.length,
          provenanceForPart(document, part, slice.content, { start: slice.start, end: slice.end }),
        ),
        headingPath: [],
        headingInstanceIds: [],
        kind: 'narrative',
      })
    })
  }

  return units
}

/** Flat part/split chunking used by strategies that do not interpret page blocks. */
export function chunkDocumentFlat(
  document: CruxDocument,
  ctx: ChunkerContext,
  options: ChunkingOptions = {},
): ChunkingResult {
  const normalized = normalizeChunkingOptions({
    maxChars: options.maxChars ?? ctx.chunking.maxChars,
    overlapChars: options.overlapChars ?? ctx.chunking.overlapChars,
  })
  const parts = document.parts?.length
    ? document.parts
    : [{ id: 'text:1', kind: 'text' as const, content: document.content ?? '' }]
  const chunks: CruxChunk[] = []

  for (const part of parts) {
    if (part.kind === 'media') {
      chunks.push(createMediaPartChunk(document, part, chunks.length))
      continue
    }
    if (part.kind === 'table') {
      chunks.push(...chunkTablePart(document, part, 25))
      continue
    }
    if (part.kind === 'json' || part.kind === 'sheet') {
      chunks.push(createPartChunk(document, part.content, chunks.length, provenanceForPart(document, part)))
      continue
    }
    for (const slice of splitDocumentSlices(part.content, normalized)) {
      chunks.push(createPartChunk(
        document,
        slice.content,
        chunks.length,
        provenanceForPart(document, part, slice.content, { start: slice.start, end: slice.end }),
      ))
    }
  }

  return { chunks }
}

function chunkPageNarrative(
  document: CruxDocument,
  page: Extract<CruxIngestPart, { kind: 'page' }>,
  options: Required<ChunkingOptions>,
  tableRowsPerChunk: number,
  ordinalOffset: number,
): StructuredUnit[] {
  const units: StructuredUnit[] = []
  let headingPath: readonly string[] = []
  let headingIds: string[] = []
  let sectionHasContent = false
  let body: Array<{ block: CruxIngestPageTextBlock; content: string; range?: { start: number; end: number } }> = []

  for (const block of page.blocks ?? []) {
    if (block.kind === 'table') {
      if (!block.columns?.length && !block.rows.length) continue
      flushSection(false)
      reconcileHeadingPath(block.headingPath ?? [])
      emitTable(block)
      continue
    }
    if (block.role === 'heading' && block.headingPath?.length) {
      flushSection(true)
      const common = commonPrefixLength(headingPath, block.headingPath ?? [])
      const ancestorCount = Math.min(common, block.headingPath.length - 1)
      headingIds = [...headingIds.slice(0, ancestorCount), block.id]
      headingPath = block.headingPath ?? []
      continue
    }
    if (!block.content.trim()) continue
    addBody(block)
  }
  flushSection(true)
  return units

  function addBody(block: CruxIngestPageTextBlock): void {
    const blockPath = block.role === 'heading' && !block.headingPath?.length
      ? headingPath
      : block.headingPath ?? []
    reconcileHeadingPath(blockPath)
    const hasExactRange = block.sourceRange !== undefined &&
      page.content.slice(block.sourceRange.start, block.sourceRange.end) === block.content
    const pieces = block.content.length > options.maxChars
      ? splitDocumentSlices(block.content, options)
      : [{ content: block.content, start: 0, end: block.content.length }]
    for (const piece of pieces) {
      const candidate = body.length
        ? `${body.map((item) => item.content).join('\n\n')}\n\n${piece.content}`
        : piece.content
      if (body.length && candidate.length > options.maxChars) flushBody()
      body.push({
        block,
        content: piece.content,
        ...(hasExactRange && block.sourceRange ? {
          range: { start: block.sourceRange.start + piece.start, end: block.sourceRange.start + piece.end },
        } : {}),
      })
      if (piece.content.length >= options.maxChars) flushBody()
    }
  }

  function reconcileHeadingPath(blockPath: readonly string[]): void {
    if (arraysEqual(headingPath, blockPath)) return
    flushSection(true)
    const common = commonPrefixLength(headingPath, blockPath)
    headingPath = blockPath
    headingIds = headingIds.slice(0, common)
  }

  function flushSection(headingBoundary: boolean): void {
    if (body.length) flushBody()
    else if (headingBoundary && headingPath.length && !sectionHasContent) {
      emit(headingPrefix(headingPath).trimEnd(), [], true)
    }
    if (headingBoundary) sectionHasContent = false
  }

  function flushBody(): void {
    const items = body
    body = []
    const prefix = headingPrefix(headingPath)
    emit(`${prefix}${items.map((item) => item.content).join('\n\n')}`, items, prefix.length > 0)
    sectionHasContent = true
  }

  function emitTable(block: CruxIngestPageTableBlock): void {
    const blockIds = [...new Set([...headingIds, block.id])]
    const prefix = headingPrefix(headingPath)
    for (const payload of tableWindows(block, tableRowsPerChunk, options.maxChars)) {
      units.push({
        chunk: createPartChunk(document, `${prefix}${payload}`, ordinalOffset + units.length, {
          partIds: [page.id],
          blockIds,
          pages: [page.pageNumber],
          tables: [block.id],
          ...(page.sourceLocation ? { sourceLocations: [page.sourceLocation] } : {}),
          confidence: 'derived',
        }),
        pageId: page.id,
        headingPath: [...headingPath],
        headingInstanceIds: [...headingIds],
        kind: 'table',
      })
      sectionHasContent = true
    }
  }

  function emit(
    content: string,
    items: Array<{ block: CruxIngestPageTextBlock; content: string; range?: { start: number; end: number } }>,
    derived: boolean,
  ): void {
    const blockIds = [...new Set([...headingIds, ...items.map((item) => item.block.id)])]
    const exactItem = !derived && items.length === 1 ? items[0] : undefined
    const rangeMatches = exactItem?.range !== undefined &&
      page.content.slice(exactItem.range.start, exactItem.range.end) === content
    const sourceSpans = rangeMatches && exactItem?.range
      ? sourceSpanForPartSlice(document, page, exactItem.range)
      : []
    units.push({
      chunk: createPartChunk(document, content, ordinalOffset + units.length, {
        partIds: [page.id],
        ...(blockIds.length ? { blockIds } : {}),
        pages: [page.pageNumber],
        ...(page.sourceLocation ? { sourceLocations: [page.sourceLocation] } : {}),
        ...(sourceSpans.length ? { sourceSpans } : {}),
        confidence: sourceSpans.length ? 'exact' : 'derived',
      }),
      pageId: page.id,
      headingPath: [...headingPath],
      headingInstanceIds: [...headingIds],
      kind: 'narrative',
    })
  }
}

function tableWindows(
  block: CruxIngestPageTableBlock,
  rowsPerChunk: number,
  maxChars: number,
): string[] {
  const header = block.columns?.length ? block.columns : undefined
  const body = block.rows
  if (!header && !body.length) return []
  if (!body.length) return [renderTable(header, [])]

  const windows: string[] = []
  const limit = Math.max(1, Math.floor(rowsPerChunk))
  for (let index = 0; index < body.length;) {
    let rows = body.slice(index, index + limit)
    while (rows.length > 1 && renderTable(header, rows).length > maxChars) rows = rows.slice(0, -1)
    windows.push(renderTable(header, rows))
    index += rows.length
  }
  return windows
}

function renderTable(header: readonly string[] | undefined, rows: readonly (readonly string[])[]): string {
  const width = Math.max(header?.length ?? 0, ...rows.map((row) => row.length))
  const renderRow = (row: readonly string[]): string =>
    `| ${Array.from({ length: width }, (_, index) => normalizeTableCell(row[index] ?? '')).join(' | ')} |`
  return [
    ...(header ? [renderRow(header), renderRow(Array.from({ length: width }, () => '---'))] : []),
    ...rows.map(renderRow),
  ].join('\n')
}

function normalizeTableCell(cell: string): string {
  return cell.replace(/\r\n|\r|\n/g, '<br>').trim().replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

function headingPrefix(path: readonly string[]): string {
  return path.length
    ? `${path.map((heading, index) => `${'#'.repeat(index + 1)} ${heading}`).join('\n')}\n\n`
    : ''
}

function commonPrefixLength(left: readonly string[], right: readonly string[]): number {
  let index = 0
  while (index < left.length && left[index] === right[index]) index++
  return index
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
  const includesHeaderRow = rows.length > 0 && arraysEqual(rows[0], header)
  const bodyRows = includesHeaderRow ? rows.slice(1) : rows
  const windows = bodyRows.length ? bodyRows : [[]]
  const spreadsheetRows = part.spreadsheet ? indexSpreadsheetRows(part.spreadsheet) : undefined
  const chunks: CruxChunk[] = []
  for (let index = 0; index < windows.length; index += rowsPerChunk) {
    const windowRows = windows.slice(index, index + rowsPerChunk)
    const renderedRows = [header, ...windowRows].map((row) => row.join(' | ')).join('\n')
    const sourceRowIndexes = [
      ...(includesHeaderRow && index === 0 ? [0] : []),
      ...windowRows.map((_, rowIndex) => index + rowIndex + (includesHeaderRow ? 1 : 0)),
    ]
    chunks.push(
      createPartChunk(document, renderedRows, chunks.length, {
        ...coarseProvenance([part]),
        ...(part.spreadsheet && spreadsheetRows ? { spreadsheets: [spreadsheetWindow(part.spreadsheet, spreadsheetRows, sourceRowIndexes)] } : {}),
        confidence: 'derived',
      }),
    )
  }
  return chunks
}

function spreadsheetWindow(
  spreadsheet: SpreadsheetProvenance,
  rows: readonly (readonly SpreadsheetCellProvenance[])[],
  sourceRowIndexes: readonly number[],
): SpreadsheetProvenance {
  return { ...spreadsheet, cells: sourceRowIndexes.flatMap((index) => rows[index] ?? []) }
}

function indexSpreadsheetRows(spreadsheet: SpreadsheetProvenance): readonly (readonly SpreadsheetCellProvenance[])[] {
  const rows = new Map<number, SpreadsheetCellProvenance[]>()
  for (const cell of spreadsheet.cells) {
    const row = rows.get(cell.row)
    if (row) {
      row.push(cell)
    } else {
      rows.set(cell.row, [cell])
    }
  }
  return [...rows.values()]
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
  const structured = chunkDocumentStructuredUnits(
    document,
    { chunking: { maxChars: options.parentMaxChars, overlapChars: 0 } },
    { maxChars: options.parentMaxChars, overlapChars: 0 },
  )
  const parents: CruxParentChunk[] = []
  const children: CruxChunk[] = []
  let currentParentContent = ''
  let currentParentChunks: CruxChunk[] = []
  let currentBoundary: Pick<StructuredUnit, 'pageId' | 'headingPath' | 'headingInstanceIds'> | undefined

  for (const unit of structured) {
    const sourceChunk = unit.chunk
    if (unit.kind === 'media') {
      flushParent()
      children.push({ ...sourceChunk, ordinal: children.length })
      continue
    }
    if (unit.kind === 'table') {
      flushParent()
      currentParentContent = sourceChunk.content
      currentParentChunks = [sourceChunk]
      currentBoundary = unit
      flushParent(true)
      continue
    }
    if (!sourceChunk.content) continue
    if (currentBoundary &&
      (currentBoundary.pageId !== unit.pageId ||
        !arraysEqual(currentBoundary.headingPath, unit.headingPath) ||
        !arraysEqual(currentBoundary.headingInstanceIds, unit.headingInstanceIds))) {
      flushParent()
    }
    const candidate = currentParentContent ? `${currentParentContent}\n\n${sourceChunk.content}` : sourceChunk.content
    if (candidate.length > options.parentMaxChars && currentParentChunks.length > 0) {
      flushParent()
      currentParentContent = sourceChunk.content
      currentParentChunks = [sourceChunk]
      currentBoundary = unit
      continue
    }
    currentParentContent = candidate
    currentParentChunks.push(sourceChunk)
    currentBoundary = unit
  }
  flushParent()

  return { chunks: children, parents }

  function flushParent(indivisible = false): void {
    if (!currentParentContent) {
      currentParentContent = ''
      currentParentChunks = []
      currentBoundary = undefined
      return
    }
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
    const rawChildren = indivisible
      ? [{ content: currentParentContent, start: 0, end: currentParentContent.length }]
      : splitDocumentSlices(currentParentContent, {
          maxChars: options.childMaxChars,
          overlapChars: options.childOverlapChars,
        })
    rawChildren.forEach((slice) => {
      const childProvenance = indivisible
        ? provenance
        : provenanceForChildSlice(document, currentParentContent, provenance, slice)
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
    currentBoundary = undefined
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

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}
