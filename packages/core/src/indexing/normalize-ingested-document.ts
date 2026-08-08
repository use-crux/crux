/** Normalize schema-2 documents into the established Core indexing input. */

import type { IngestedDocument, SheetBlock, SourceCoordinate, TableBlock, TableCell } from './ingested-document'
import type { CruxDocument, CruxIngestPart, SpreadsheetCellProvenance, SpreadsheetProvenance } from './types'

/**
 * Normalize schema-2 XLSX blocks without deriving location facts from rendered text.
 *
 * Spreadsheet tables retain their original worksheet range and every physical
 * cell descriptor as chunk provenance. Core owns this bridge and intentionally
 * has no dependency on any parser or Ingest package.
 */
export function normalizeXlsxDocument(
  document: IngestedDocument,
  identity: { readonly namespace: string; readonly sourceId: string },
): CruxDocument {
  if (document.source.format !== 'xlsx' && document.source.format !== 'xlsm') {
    throw new Error('normalizeXlsxDocument only accepts XLSX or XLSM schema-2 documents.')
  }
  const parts = document.blocks.flatMap(normalizeSheet)

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

function normalizeSheet(block: IngestedDocument['blocks'][number]): CruxIngestPart[] {
  if (block.kind !== 'sheet') {
    throw new Error(`normalizeXlsxDocument only accepts sheet blocks; received ${block.kind}.`)
  }
  const sheet = block
  return sheet.blocks.map((table) => tablePart(table, sheet))
}

function tablePart(table: TableBlock, sheet: SheetBlock): CruxIngestPart {
  const rows = table.rows.map((row) => row.map(cellValue))
  const spreadsheet = spreadsheetProvenance(sheet, table)
  return {
    id: table.id,
    kind: 'table',
    content: rows.map((row) => row.join(' | ')).join('\n'),
    columns: [...table.columns],
    rows,
    sheetName: spreadsheet.sheet,
    spreadsheet,
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
  const address = cellAddress(cell.coordinate)
  const mergeMaster = cell.mergeRange ? cell.mergeRange.split(':')[0] : undefined
  return {
    id: cell.id,
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
