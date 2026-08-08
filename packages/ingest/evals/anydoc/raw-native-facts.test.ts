import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { adaptMammothDocxResult } from '../../src/docx'
import { parseCsvDocument } from '../../src/csv'
import { adaptPdfParseResult } from '../../src/pdf'
import { assertCoreProjectionFacts, assertParserNativeFacts, type ExpectedFactManifest } from './structural-assertions'
import { extractCsvNativeFacts } from './native-csv-facts'
import { extractExcelNativeFacts } from './native-xlsx-facts'
import { extractMammothNativeFacts } from './native-mammoth-facts'
import { extractPdfNativeFacts } from './native-pdf-facts'

const bytes = new TextEncoder().encode('raw fixture')

it('snapshots parser-specific facts from raw parser payloads', async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Pricing')
  sheet.addRow(['Plan', 'Price'])
  sheet.addRow(['Pro', 20])
  const anydoc = await import('./native-anydoc-facts.mjs')
  const rawAnydoc = JSON.parse(await readFile(new URL('./fixtures/anydoc-0.1.7-raw-document.json', import.meta.url), 'utf8'))

  expect({
    anydoc: anydoc.extractAnydocNativeFacts(rawAnydoc, bytes, { kind: 'parser', name: 'anydoc', version: '0.1.7', adapterVersion: '2-eval' }).filter(structural),
    mammoth: extractMammothNativeFacts('<h1>Release Notes</h1><table><tr><th>Plan</th></tr><tr><td>Pro</td></tr></table>', [], bytes).filter(structural),
    csv: extractCsvNativeFacts([['Plan', 'Price'], ['Pro', '20']], bytes).filter(structural),
    excel: extractExcelNativeFacts(workbook, bytes).filter(structural),
    pdf: extractPdfNativeFacts({ pages: [{ page: 0, markdown: '# Release Notes\n\nParser-owned body.', needsOcr: false }] }, bytes).filter(structural),
  }).toMatchSnapshot()
})

it('keeps raw native heading, table, cell, and page facts independent from Core loss', async () => {
  const mammothRaw = '<h1>Release Notes</h1>'
  const mammothCore = adaptMammothDocxResult({ bytes, html: mammothRaw })
  proveCoreLoss(
    extractMammothNativeFacts(mammothRaw, [], bytes),
    { fixtureId: 'heading', expectedOutcome: { kind: 'success' }, assertions: [{ id: 'heading', role: 'required', kind: 'heading', factPath: 'blocks/1', level: 1, text: 'Release Notes' }] },
    { ...mammothCore, blocks: [] },
  )

  const csvRaw = [['Plan'], ['Pro']]
  const csvCore = parseCsvDocument({ bytes: new TextEncoder().encode('Plan\nPro\n') })
  proveCoreLoss(
    extractCsvNativeFacts(csvRaw, new TextEncoder().encode('Plan\nPro\n')),
    { fixtureId: 'table', expectedOutcome: { kind: 'success' }, assertions: [{ id: 'table', role: 'required', kind: 'table', factPath: 'blocks/1', columns: ['Plan'], rows: csvRaw }] },
    { ...csvCore, blocks: [] },
  )

  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Pricing').addRow(['Plan'])
  const excelBytes = new Uint8Array(await workbook.xlsx.writeBuffer())
  const excelCore = (await import('../../src/xlsx')).parseXlsxDocument
  const projected = await excelCore({ bytes: excelBytes })
  proveCoreLoss(
    extractExcelNativeFacts(workbook, excelBytes),
    { fixtureId: 'cell', expectedOutcome: { kind: 'success' }, assertions: [{ id: 'cell', role: 'required', kind: 'cell', factPath: 'blocks/1/blocks/1/rows/1/cells/1', sheet: 'Pricing', address: 'A1', displayedValue: 'Plan' }] },
    { ...projected, blocks: [] },
  )

  const rawPdf = { pages: [{ page: 0, markdown: '# Release Notes', needsOcr: false }] }
  const pdfCore = adaptPdfParseResult({ bytes, parsed: { parts: [{ id: 'pdf:page:1', kind: 'page', pageNumber: 1, sourceLocation: { type: 'page', pageNumber: 1 }, content: '# Release Notes', blocks: [{ id: 'raw', kind: 'text', role: 'heading', content: '# Release Notes', sourceRange: { start: 0, end: 15 } }] }] } })
  proveCoreLoss(
    extractPdfNativeFacts(rawPdf, bytes),
    { fixtureId: 'page', expectedOutcome: { kind: 'success' }, assertions: [{ id: 'page', role: 'required', kind: 'page-block', factPath: 'blocks/1/blocks/1', page: 1, block: 1, text: '# Release Notes' }] },
    { ...pdfCore, blocks: [] },
  )
})

function structural(value: { readonly kind: string }): boolean { return !['provenance', 'ordered-text', 'notes', 'asset-count', 'coordinate-kinds', 'no-parser-downgrade', 'sheet-order', 'page-order', 'page-content-hash'].includes(value.kind) }

function proveCoreLoss(facts: readonly any[], expected: ExpectedFactManifest, core: Parameters<typeof assertCoreProjectionFacts>[1]): void {
  expect(assertParserNativeFacts(expected, { outcome: { kind: 'success' }, facts })).toMatchObject({ passed: true, admitted: true })
  expect(assertCoreProjectionFacts(expected, core)).toMatchObject({ passed: false, admitted: false })
}
