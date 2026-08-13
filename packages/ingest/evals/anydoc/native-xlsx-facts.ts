import { createHash } from 'node:crypto'
import type ExcelJS from 'exceljs'
import { fact, provenance, type NativeFact, type NativeProducer } from './native-fact-schema'

const PRODUCER: NativeProducer = { kind: 'parser', name: 'exceljs', version: '4.4.0', adapterVersion: '2' }

/** Extract eval evidence from the live ExcelJS Workbook, before Core adaptation. */
export function extractExcelNativeFacts(workbook: ExcelJS.Workbook, bytes: Uint8Array): readonly NativeFact[] {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const facts: NativeFact[] = []
  const text: string[] = []
  const sheets = workbook.worksheets.filter((sheet) => sheet.actualRowCount > 0)
  facts.push(fact('document', { kind: 'ordered-text', text: collectText(sheets) }))
  facts.push(fact('document', { kind: 'notes', text: [] }), fact('document', { kind: 'asset-count', count: 0 }))
  facts.push(fact('document', { kind: 'coordinate-kinds', kinds: sheets.length ? ['sheet-range'] : [] }))
  facts.push(fact('document', { kind: 'sheet-order', sheets: sheets.map((sheet) => sheet.name) }))
  facts.push(fact('document', { kind: 'no-parser-downgrade' }), provenance('document', { kind: 'document', documentSha256: hash }, PRODUCER))
  sheets.forEach((sheet, sheetIndex) => {
    const dimensions = sheet.dimensions
    const sheetPath = `blocks/${sheetIndex + 1}`
    const sheetCoordinate = { kind: 'sheet-range' as const, sheet: sheet.name, range: dimensions.shortRange }
    facts.push(fact(sheetPath, { kind: 'sheet-range', sheet: sheet.name, range: dimensions.shortRange }), provenance(sheetPath, sheetCoordinate, PRODUCER))
    let emittedRow = 0
    sheet.eachRow({ includeEmpty: false }, (row) => {
      emittedRow += 1
      for (let column = dimensions.left; column <= dimensions.right; column += 1) {
        const cell = row.getCell(column)
        const path = `${sheetPath}/blocks/1/rows/${emittedRow}/cells/${column - dimensions.left + 1}`
        const mergeRange = cell.isMerged ? mergedRange(sheet, cell.master.address) : undefined
        const displayedValue = cell.isMerged && cell.master.address !== cell.address ? '' : display(cell)
        facts.push(fact(path, { kind: 'cell', sheet: sheet.name, address: cell.address, displayedValue, ...(cell.formula ? { formula: cell.formula } : {}), ...(mergeRange ? { mergeRange } : {}) }))
        facts.push(provenance(path, { kind: 'sheet-range', sheet: sheet.name, range: cell.address }, PRODUCER))
        text.push(displayedValue)
      }
    })
  })
  return facts
}

function collectText(sheets: readonly ExcelJS.Worksheet[]): string[] {
  const values: string[] = []
  for (const sheet of sheets) sheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: true }, (cell) => {
    const value = cell.isMerged && cell.master.address !== cell.address ? '' : display(cell)
    if (value) values.push(value)
  }))
  return values
}

function display(cell: ExcelJS.Cell): string {
  if (cell.formula) return cell.result === undefined || cell.result === null ? '' : String(cell.result)
  return cell.text
}

function mergedRange(sheet: ExcelJS.Worksheet, master: string): string | undefined {
  const merges = sheet.model.merges
  return Array.isArray(merges) ? merges.find((range) => typeof range === 'string' && range.split(':')[0] === master) : undefined
}
