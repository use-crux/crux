/** Normalize schema-2 documents into the established Core indexing input. */

import type {
  DocumentBlock,
  IngestedDocument,
  SheetBlock,
  SourceCoordinate,
  TableBlock,
  TableCell,
  TextBlock,
} from './ingested-document'
import type { CruxDocument, CruxIngestPart, SpreadsheetCellProvenance, SpreadsheetProvenance } from './types'

/**
 * Normalize schema-2 blocks without deriving location facts from rendered text.
 *
 * Spreadsheet tables retain their original worksheet range and every physical
 * cell descriptor as chunk provenance. Core owns this bridge and intentionally
 * has no dependency on any parser or Ingest package.
 */
export function normalizeIngestedDocument(
  document: IngestedDocument,
  identity: { readonly namespace: string; readonly sourceId: string },
): CruxDocument {
  const parts = document.blocks.flatMap((block) => normalizeBlock(block))

  return {
    namespace: identity.namespace,
    sourceId: identity.sourceId,
    content: parts.map(partContent).filter(Boolean).join('\n\n'),
    source: { mediaType: document.source.mediaType },
    metadata: { ...document.metadata },
    parts,
  }
}

function partContent(part: CruxIngestPart): string {
  return part.kind === 'media' ? (part.caption ?? '') : part.content
}

function normalizeBlock(block: DocumentBlock, sheet?: SheetBlock): CruxIngestPart[] {
  switch (block.kind) {
    case 'text':
      return [textPart(block)]
    case 'table':
      return [tablePart(block, sheet)]
    case 'sheet':
      return block.blocks.flatMap((child) => normalizeBlock(child, block))
    case 'page':
    case 'slide':
      return block.blocks.flatMap((child) => normalizeBlock(child))
    case 'list':
      return block.items.flatMap((item) => item.blocks.flatMap((child) => normalizeBlock(child)))
  }
}

function textPart(block: TextBlock): CruxIngestPart {
  return {
    id: block.id,
    kind: 'text',
    content: block.text,
    role: block.role,
    headingPath: [...block.headingPath],
  }
}

function tablePart(table: TableBlock, sheet: SheetBlock | undefined): CruxIngestPart {
  const rows = table.rows.map((row) => row.map(cellValue))
  const spreadsheet = sheet ? spreadsheetProvenance(sheet, table) : undefined
  return {
    id: table.id,
    kind: 'table',
    content: rows.map((row) => row.join(' | ')).join('\n'),
    columns: [...table.columns],
    rows,
    ...(spreadsheet ? { sheetName: spreadsheet.sheet, spreadsheet } : {}),
  }
}

function spreadsheetProvenance(sheet: SheetBlock, table: TableBlock): SpreadsheetProvenance {
  return {
    sheet: sheet.sheet,
    index: sheet.index,
    range: sheet.range,
    cells: table.rows.flatMap((row) => row.map(cellProvenance)),
  }
}

function cellProvenance(cell: TableCell): SpreadsheetCellProvenance {
  const address = cellAddress(cell.coordinate)
  const mergeMaster = cell.mergeRange ? cell.mergeRange.split(':')[0] : undefined
  return {
    address,
    row: cell.row,
    column: cell.column,
    displayedValue: cell.displayedValue ?? cell.blocks.map((block) => block.kind === 'text' ? block.text : '').join(''),
    ...(cell.formula ? { formula: cell.formula } : {}),
    ...(mergeMaster ? { mergeMaster } : {}),
    ...(cell.mergeRange ? { mergeRange: cell.mergeRange } : {}),
  }
}

function cellAddress(coordinate: SourceCoordinate): string {
  if (coordinate.kind !== 'sheet-range') {
    throw new Error('Schema-2 spreadsheet table cells must have sheet-range coordinates.')
  }
  return coordinate.range
}

function cellValue(cell: TableCell): string {
  return cell.displayedValue ?? cell.blocks.map((block) => block.kind === 'text' ? block.text : '').join('')
}
