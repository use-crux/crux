import { createHash } from 'node:crypto'
import { validateIngestedDocument } from '@use-crux/core/indexing'
import ExcelJS from 'exceljs'
import SSF from 'ssf'
import type { IngestDiagnostic, IngestedDocument, ParserIdentity, SourceCoordinate, TableBlock, TableCell, TextBlock } from '@use-crux/core/indexing'

const EXCELJS_PRODUCER: ParserIdentity = {
  kind: 'parser',
  name: 'exceljs',
  version: '4.4.0',
  adapterVersion: '2',
}
const EXCELJS_IDENTITY = `${EXCELJS_PRODUCER.kind}:${EXCELJS_PRODUCER.name}:${EXCELJS_PRODUCER.version}:${EXCELJS_PRODUCER.adapterVersion}`
const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLSM_MEDIA_TYPE = 'application/vnd.ms-excel.sheet.macroEnabled.12'
/** Bounds adapter-owned row/cell construction for one worksheet. */
const MAX_XLSX_WORKSHEET_CELLS = 1_000_000
/** Bounds merge-index construction after the worksheet cell budget has passed. */
const MAX_XLSX_MERGE_MEMBERSHIP_OPERATIONS = 1_000_000

/** Parse XLSX or XLSM through ExcelJS into exact schema-2 worksheet facts. */
export async function parseXlsxDocument(input: {
  readonly bytes: Uint8Array
  readonly mediaType?: string
  readonly format?: 'xlsx' | 'xlsm'
}): Promise<IngestedDocument> {
  const workbook = new ExcelJS.Workbook()
  const bytes = input.bytes.buffer.slice(input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength)
  await workbook.xlsx.load(bytes as Parameters<typeof workbook.xlsx.load>[0])

  const documentSha256 = sha256(input.bytes)
  const diagnostics: IngestDiagnostic[] = []
  const date1904 = workbook.properties.date1904 === true
  const blocks: IngestedDocument['blocks'][number][] = []

  workbook.worksheets.forEach((worksheet, index) => {
    const dimensions = worksheet.dimensions
    assertXlsxWorksheetCellBudget(dimensions, worksheet.name)
    const range = dimensions.shortRange
    const sheetCoordinate: SourceCoordinate = { kind: 'sheet-range', sheet: worksheet.name, range }
    const merges = buildXlsxMergeMembership(projectXlsxMergeRectangles(worksheet.model.merges)).cells
    const rows: TableBlock['rows'][number][] = []

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: TableCell[] = []
      for (let column = dimensions.left; column <= dimensions.right; column += 1) {
        const cell = row.getCell(column)
        const merge = merges.get(cell.address)
        const isMergeFollower = merge !== undefined && merge.master !== cell.address
        const coordinate: SourceCoordinate = { kind: 'sheet-range', sheet: worksheet.name, range: cell.address }
        const value = isMergeFollower ? '' : formatCell(cell, date1904, worksheet.name, diagnostics)
        const id = xlsxId(documentSha256, `sheet:${index + 1}:table:1:row:${row.number}:column:${column}`)
        cells.push({
          id,
          coordinate,
          producer: EXCELJS_PRODUCER,
          row: row.number,
          column,
          rowSpan: !isMergeFollower && merge ? merge.rowEnd - merge.rowStart + 1 : 1,
          columnSpan: !isMergeFollower && merge ? merge.columnEnd - merge.columnStart + 1 : 1,
          blocks: [cellText({ id: `${id}:text`, coordinate, text: value })],
          displayedValue: value,
          ...(!isMergeFollower && cell.formula ? { formula: cell.formula } : {}),
          ...(merge ? { mergeRange: merge.address } : {}),
        })
      }
      rows.push(cells)
    })

    if (rows.length === 0) {
      return
    }

    const tableId = xlsxId(documentSha256, `sheet:${index + 1}:table:1`)
    const table: TableBlock = {
      id: tableId,
      kind: 'table',
      coordinate: sheetCoordinate,
      headingPath: [],
      producer: EXCELJS_PRODUCER,
      columns: rows[0]?.map(cellValue) ?? [],
      headerRows: 1,
      rows,
    }
    blocks.push({
      id: xlsxId(documentSha256, `sheet:${index + 1}`),
      kind: 'sheet',
      coordinate: sheetCoordinate,
      headingPath: [],
      producer: EXCELJS_PRODUCER,
      sheet: worksheet.name,
      index,
      range,
      blocks: [table],
    })
  })

  const format = input.format ?? (input.mediaType === XLSM_MEDIA_TYPE ? 'xlsm' : 'xlsx')
  return validateIngestedDocument({
    schemaVersion: 2,
    source: {
      documentSha256,
      mediaType: input.mediaType ?? (format === 'xlsm' ? XLSM_MEDIA_TYPE : XLSX_MEDIA_TYPE),
      format,
    },
    producer: EXCELJS_PRODUCER,
    metadata: {},
    blocks,
    assets: [],
    diagnostics,
  })
}

function cellText(input: { readonly id: string; readonly coordinate: SourceCoordinate; readonly text: string }): TextBlock {
  return {
    id: input.id,
    kind: 'text',
    coordinate: input.coordinate,
    headingPath: [],
    producer: EXCELJS_PRODUCER,
    role: 'paragraph',
    text: input.text,
    inlines: [],
  }
}

function cellValue(cell: TableCell): string {
  return cell.displayedValue ?? ''
}

function formatCell(cell: ExcelJS.Cell, date1904: boolean, sheet: string, diagnostics: IngestDiagnostic[]): string {
  const value = cell.formula ? cell.result : cell.value
  const fallback = projectXlsxSchema2DisplayValue(value, { sheet, address: cell.address, diagnostics })
  if (!cell.numFmt || (typeof value !== 'number' && !(value instanceof Date))) {
    return fallback
  }
  try {
    return SSF.format(cell.numFmt, value, { date1904 })
  } catch {
    diagnostics.push({
      code: 'partial-extraction',
      severity: 'warning',
      message: `Could not apply XLSX number format for cell ${cell.address}; emitted raw value.`,
      coordinate: { kind: 'sheet-range', sheet, range: cell.address },
      producer: EXCELJS_PRODUCER,
    })
    return fallback
  }
}

/** Project persisted ExcelJS values without allowing object stringification. */
export function projectXlsxSchema2DisplayValue(
  value: unknown,
  context: { readonly sheet: string; readonly address: string; readonly diagnostics: IngestDiagnostic[] },
): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>
  if ('richText' in record) {
    if (Array.isArray(record.richText) && record.richText.every(isRichTextRun)) {
      return record.richText.map((run) => run.text).join('')
    }
    return rejectStructuredValue(context)
  }
  if ('hyperlink' in record || 'text' in record) {
    if (typeof record.hyperlink === 'string' && typeof record.text === 'string') {
      return record.text
    }
    return rejectStructuredValue(context)
  }
  if ('error' in record) {
    if (typeof record.error === 'string') {
      return record.error
    }
    return rejectStructuredValue(context)
  }
  if (typeof record.formula === 'string' || typeof record.sharedFormula === 'string') {
    return 'result' in record ? projectXlsxSchema2DisplayValue(record.result, context) : ''
  }

  return rejectStructuredValue(context)
}

function rejectStructuredValue(context: { readonly sheet: string; readonly address: string; readonly diagnostics: IngestDiagnostic[] }): string {
  context.diagnostics.push({
    code: 'partial-extraction',
    severity: 'warning',
    message: `Could not project XLSX structured value for cell ${context.address}; emitted empty value.`,
    coordinate: { kind: 'sheet-range', sheet: context.sheet, range: context.address },
    producer: EXCELJS_PRODUCER,
  })
  return ''
}

function isRichTextRun(value: unknown): value is { readonly text: string } {
  return typeof value === 'object' && value !== null && typeof (value as { text?: unknown }).text === 'string'
}

interface XlsxMergeRectangle {
  readonly address: string
  readonly master: string
  readonly rowStart: number
  readonly rowEnd: number
  readonly columnStart: number
  readonly columnEnd: number
}

/**
 * Preserve merge topology as compact rectangles. Never expand a merge into one
 * entry per address: ranges come from untrusted workbook XML and can be huge.
 */
export function projectXlsxMergeRectangles(ranges: unknown): readonly XlsxMergeRectangle[] {
  if (!Array.isArray(ranges)) {
    return []
  }
  const merges: XlsxMergeRectangle[] = []
  for (const range of ranges) {
    const parsed = parseRange(range)
    if (!parsed) {
      continue
    }
    merges.push({ ...parsed, master: address(parsed.rowStart, parsed.columnStart) })
  }
  return merges
}

/** Resolve one emitted cell against compact merge rectangles. */
export function resolveXlsxMerge(
  merges: readonly XlsxMergeRectangle[],
  row: number,
  column: number,
): XlsxMergeRectangle | undefined {
  return merges.find((merge) =>
    row >= merge.rowStart && row <= merge.rowEnd && column >= merge.columnStart && column <= merge.columnEnd,
  )
}

/**
 * Materialize compact merges only after the worksheet-size guard has passed.
 * The explicit operation cap also rejects overlapping merge rectangles that
 * would otherwise multiply index work while retaining only a small final map.
 */
export function buildXlsxMergeMembership(
  merges: readonly XlsxMergeRectangle[],
): { readonly cells: ReadonlyMap<string, XlsxMergeRectangle>; readonly operations: number } {
  let operations = 0
  const cells = new Map<string, XlsxMergeRectangle>()
  for (const merge of merges) {
    const area = (merge.rowEnd - merge.rowStart + 1) * (merge.columnEnd - merge.columnStart + 1)
    if (!Number.isSafeInteger(area) || area < 0 || operations + area > MAX_XLSX_MERGE_MEMBERSHIP_OPERATIONS) {
      throw new Error(`XLSX merge membership exceeds the ${MAX_XLSX_MERGE_MEMBERSHIP_OPERATIONS}-operation ingest budget.`)
    }
    operations += area
    for (let row = merge.rowStart; row <= merge.rowEnd; row += 1) {
      for (let column = merge.columnStart; column <= merge.columnEnd; column += 1) {
        cells.set(address(row, column), merge)
      }
    }
  }
  return { cells, operations }
}

/** Fail before adapter iteration could construct an attacker-sized cell grid. */
export function assertXlsxWorksheetCellBudget(
  dimensions: { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number },
  sheet: string,
): void {
  const rows = dimensions.bottom - dimensions.top + 1
  const columns = dimensions.right - dimensions.left + 1
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) || rows < 0 || columns < 0 || rows * columns > MAX_XLSX_WORKSHEET_CELLS) {
    throw new Error(`XLSX worksheet ${sheet} exceeds the ${MAX_XLSX_WORKSHEET_CELLS}-cell ingest budget.`)
  }
}

function parseRange(value: unknown): { readonly address: string; readonly rowStart: number; readonly rowEnd: number; readonly columnStart: number; readonly columnEnd: number } | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const [start, end = start] = value.split(':')
  const startCell = parseAddress(start)
  const endCell = parseAddress(end)
  if (!startCell || !endCell) {
    return undefined
  }
  return {
    address: value,
    rowStart: Math.min(startCell.row, endCell.row),
    rowEnd: Math.max(startCell.row, endCell.row),
    columnStart: Math.min(startCell.column, endCell.column),
    columnEnd: Math.max(startCell.column, endCell.column),
  }
}

function parseAddress(value: string | undefined): { readonly row: number; readonly column: number } | undefined {
  const match = /^([A-Z]+)(\d+)$/i.exec(value ?? '')
  if (!match) {
    return undefined
  }
  let column = 0
  for (const letter of match[1]!.toUpperCase()) {
    column = column * 26 + letter.charCodeAt(0) - 64
  }
  return { row: Number(match[2]), column }
}

function address(row: number, column: number): string {
  let remaining = column
  let letters = ''
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26
    letters = String.fromCharCode(65 + modulo) + letters
    remaining = Math.floor((remaining - modulo) / 26)
  }
  return `${letters}${row}`
}

function xlsxId(documentSha256: string, structuralPath: string): string {
  return `xlsx:${documentSha256}:${EXCELJS_IDENTITY}:${structuralPath}`
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
