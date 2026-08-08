/** Normalize exact schema-2 documents into Core's chunking input. */

import type {
  DocumentBlock,
  IngestedDocument,
  ListBlock,
  SheetBlock,
  SourceCoordinate,
  TableBlock,
  TableCell,
  TextBlock,
} from './ingested-document'
import type { CruxDocument, CruxIngestPart, CruxSourceFacts, SpreadsheetCellProvenance, SpreadsheetProvenance } from './types'

const NORMALIZATION_VERSION = 'crux:ingested-document:2'

/** Convert every established schema-2 block without deriving source locations from rendered text. */
export function normalizeIngestedDocument(
  document: IngestedDocument,
  identity: { readonly namespace: string; readonly sourceId: string; readonly source?: CruxSourceFacts; readonly title?: string },
): CruxDocument {
  const parts = document.blocks.flatMap((block) => normalizeBlock(block, []))
  return {
    namespace: identity.namespace,
    sourceId: identity.sourceId,
    content: parts.map(partContent).filter(Boolean).join('\n\n'),
    source: { ...(identity.source ?? {}), mediaType: document.source.mediaType },
    ...(identity.title ? { title: identity.title } : {}),
    metadata: { ...document.metadata },
    parts,
    evidence: {
      documentSha256: document.source.documentSha256,
      producer: document.producer,
      normalizationVersion: NORMALIZATION_VERSION,
    },
  }
}

/** Compatibility guard for callers that intentionally accept spreadsheet documents only. */
export function normalizeXlsxDocument(
  document: IngestedDocument,
  identity?: { readonly namespace: string; readonly sourceId: string },
): CruxDocument {
  if (document.source.format !== 'xlsx' && document.source.format !== 'xlsm') {
    throw new Error('normalizeXlsxDocument only accepts XLSX or XLSM schema-2 documents.')
  }
  for (const block of document.blocks) {
    if (block.kind !== 'sheet') {
      throw new Error(`normalizeXlsxDocument only accepts sheet blocks; received ${block.kind}.`)
    }
  }
  if (!identity) {
    throw new Error('normalizeXlsxDocument requires namespace and sourceId.')
  }
  return normalizeIngestedDocument(document, identity)
}

function normalizeBlock(block: DocumentBlock, ancestors: readonly string[], sheet?: SheetBlock): CruxIngestPart[] {
  const blockIds = [...ancestors, block.id]
  if (block.kind === 'text') {
    return [textPart(block, blockIds)]
  }
  if (block.kind === 'list') {
    return [listPart(block, blockIds)]
  }
  if (block.kind === 'table') {
    return [tablePart(block, blockIds, sheet)]
  }
  if (block.kind === 'sheet') {
    return block.blocks.flatMap((child) => normalizeBlock(child, blockIds, block))
  }
  if (block.kind === 'page' || block.kind === 'slide') {
    const nested = block.blocks.flatMap((child) => normalizeBlock(child, blockIds, sheet))
    const notes = block.kind === 'slide' ? block.notes.flatMap((note) => normalizeBlock(note, blockIds, sheet)) : []
    return [...nested, ...notes]
  }
  return []
}

function textPart(block: TextBlock, blockIds: readonly string[]): CruxIngestPart {
  return {
    id: block.id,
    kind: 'text',
    content: block.text,
    role: block.role,
    headingPath: [...block.headingPath],
    evidence: { coordinate: block.coordinate, blockIds },
  }
}

function listPart(block: ListBlock, blockIds: readonly string[]): CruxIngestPart {
  return {
    id: block.id,
    kind: 'text',
    content: renderList(block),
    role: 'list',
    headingPath: [...block.headingPath],
    evidence: { coordinate: block.coordinate, blockIds: [...blockIds, ...listDescendantIds(block)] },
  }
}

function tablePart(table: TableBlock, blockIds: readonly string[], sheet: SheetBlock | undefined): CruxIngestPart {
  const rows = table.rows.map((row) => row.map(cellValue))
  const spreadsheet = sheet ? spreadsheetProvenance(sheet, table) : undefined
  return {
    id: table.id,
    kind: 'table',
    content: rows.map((row) => row.join(' | ')).join('\n'),
    columns: [...table.columns],
    rows,
    ...(spreadsheet ? { sheetName: spreadsheet.sheet, spreadsheet } : {}),
    evidence: { coordinate: table.coordinate, blockIds: [...blockIds, ...table.rows.flatMap((row) => row.map((cell) => cell.id))] },
  }
}

function spreadsheetProvenance(sheet: SheetBlock, table: TableBlock): SpreadsheetProvenance {
  return {
    sheetBlockId: sheet.id,
    tableBlockId: table.id,
    sheet: sheet.sheet,
    index: sheet.index,
    range: sheet.range,
    cells: table.rows.flatMap((row) => row.map(cellProvenance)),
  }
}

function cellProvenance(cell: TableCell): SpreadsheetCellProvenance {
  return {
    id: cell.id,
    address: cellAddress(cell.coordinate),
    row: cell.row,
    column: cell.column,
    displayedValue: cellValue(cell),
    ...(cell.formula ? { formula: cell.formula } : {}),
    ...(cell.mergeRange ? { mergeMaster: cell.mergeRange.split(':')[0], mergeRange: cell.mergeRange } : {}),
  }
}

function cellAddress(coordinate: SourceCoordinate): string {
  if (coordinate.kind !== 'sheet-range') {
    throw new Error('Schema-2 spreadsheet table cells must have sheet-range coordinates.')
  }
  return coordinate.range
}

function cellValue(cell: TableCell): string {
  return cell.displayedValue ?? cell.blocks.map(blockText).join('')
}

function blockText(block: TextBlock | ListBlock): string {
  return block.kind === 'text' ? block.text : renderList(block)
}

function renderList(block: ListBlock): string {
  return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${item.blocks.map(blockText).join(' ')}`).join('\n')
}

function listDescendantIds(block: ListBlock): string[] {
  return block.items.flatMap((item) => [item.id, ...item.blocks.flatMap((child) => child.kind === 'list' ? [child.id, ...listDescendantIds(child)] : [child.id])])
}

function partContent(part: CruxIngestPart): string {
  return part.kind === 'media' ? (part.caption ?? '') : part.content
}
