import ExcelJS from 'exceljs'
import { expect, it } from 'vitest'
import { indexer, normalizeXlsxDocument } from '@use-crux/core'
import { embedding } from '@use-crux/core/embedding'
import { chunker, indexingPipeline } from '@use-crux/core/indexing'
import { retriever } from '@use-crux/core/retrieval'
import { inMemoryRecordStore, inMemorySearchStore } from '@use-crux/core/storage'
import {
  assertXlsxWorksheetCellBudget,
  buildXlsxMergeMembership,
  parseXlsxDocument,
  projectXlsxMergeRectangles,
  projectXlsxSchema2DisplayValue,
  resolveXlsxMerge,
} from '../src/xlsx'

it('preserves XLSM format while parsing workbook cells as inert data', async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Pricing')
  sheet.addRow(['Plan', 'Price'])
  sheet.addRow(['Pro', 20])

  const document = await parseXlsxDocument({
    bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
    format: 'xlsm',
  })

  expect(document.source).toMatchObject({
    format: 'xlsm',
    mediaType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  })
  expect(document.blocks[0]).toMatchObject({
    kind: 'sheet',
    sheet: 'Pricing',
    blocks: [
      {
        kind: 'table',
        rows: [
          [{ displayedValue: 'Plan' }, { displayedValue: 'Price' }],
          [{ displayedValue: 'Pro' }, { displayedValue: '20' }],
        ],
      },
    ],
  })
})

it('preserves exact XLSX provenance through normalization, structured indexing, storage, and retrieval', async () => {
  const workbook = new ExcelJS.Workbook()
  const revenue = workbook.addWorksheet('Revenue')
  revenue.getCell('B2').value = 'Plan'
  revenue.getCell('D2').value = 'Total'
  revenue.getCell('B4').value = 'Pro'
  revenue.getCell('D4').value = { formula: '10*2', result: 20 }
  revenue.mergeCells('B6:C6')
  revenue.getCell('B6').value = 'Annual plan'

  const ingested = await parseXlsxDocument({ bytes: new Uint8Array(await workbook.xlsx.writeBuffer()) })
  const document = normalizeXlsxDocument(ingested, { namespace: 'finance', sourceId: 'revenue.xlsx' })
  const records = inMemoryRecordStore()
  const search = inMemorySearchStore()
  const dense = embedding({
    kind: 'dense',
    name: 'xlsx-provenance',
    dimensions: 1,
    maxInputTokens: 100,
    batch: { maxSize: 10 },
    embed: async (inputs) => inputs.map(() => [1]),
  })
  const docs = indexer({
    id: 'finance',
    namespace: 'finance',
    records,
    search,
    dense,
    pipeline: indexingPipeline({ chunker: chunker.structured({ tableRowsPerChunk: 1 }) }),
  })

  const chunks = await docs.chunk([document])
  const formulaChunk = chunks.find((chunk) => chunk.content.includes('Pro') && chunk.content.includes('20'))
  const spreadsheet = formulaChunk?.provenance?.spreadsheets?.[0]
  expect(spreadsheet).toMatchObject({
    sheet: 'Revenue',
    index: 0,
    range: 'B2:D6',
    sheetBlockId: ingested.blocks[0]?.id,
    tableBlockId: ingested.blocks[0]?.kind === 'sheet' ? ingested.blocks[0].blocks[0]?.id : undefined,
  })
  expect(spreadsheet?.cells.map((cell) => cell.address)).toEqual(['B2', 'C2', 'D2', 'B4', 'C4', 'D4'])
  expect(spreadsheet?.cells.find((cell) => cell.address === 'D4')).toMatchObject({
    id: ingested.blocks[0]?.kind === 'sheet' ? ingested.blocks[0].blocks[0]?.rows[1]?.[2]?.id : undefined,
    address: 'D4',
    displayedValue: '20',
    formula: '10*2',
  })

  const mergeSpreadsheet = chunks.find((chunk) => chunk.content.includes('Annual plan'))?.provenance?.spreadsheets?.[0]
  const mergeEvidence = chunks.find((chunk) => chunk.content.includes('Annual plan'))?.evidence
  expect(mergeSpreadsheet).toMatchObject({
    sheet: 'Revenue',
    index: 0,
    range: 'B2:D6',
    sheetBlockId: ingested.blocks[0]?.id,
    tableBlockId: ingested.blocks[0]?.kind === 'sheet' ? ingested.blocks[0].blocks[0]?.id : undefined,
  })
  expect(mergeSpreadsheet?.cells.map((cell) => cell.address)).toEqual(['B6', 'C6', 'D6'])
  expect(mergeSpreadsheet?.cells).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: ingested.blocks[0]?.kind === 'sheet' ? ingested.blocks[0].blocks[0]?.rows[2]?.[0]?.id : undefined,
      address: 'B6', displayedValue: 'Annual plan', mergeMaster: 'B6', mergeRange: 'B6:C6',
    }),
    expect.objectContaining({
      id: ingested.blocks[0]?.kind === 'sheet' ? ingested.blocks[0].blocks[0]?.rows[2]?.[1]?.id : undefined,
      address: 'C6', displayedValue: '', mergeMaster: 'B6', mergeRange: 'B6:C6',
    }),
  ]))
  expect(mergeSpreadsheet?.cells.some((cell) => cell.address === 'B2')).toBe(false)
  expect(mergeEvidence?.blockIds).toEqual(expect.arrayContaining([
    ingested.blocks[0]?.kind === 'sheet' ? ingested.blocks[0].blocks[0]?.rows[0]?.[0]?.id : undefined,
    ingested.blocks[0]?.kind === 'sheet' ? ingested.blocks[0].blocks[0]?.rows[0]?.[2]?.id : undefined,
  ]))

  await docs.indexDocuments([document])
  const stored = await records.list('indexer:finance:namespace:finance:source:revenue.xlsx:')
  expect(stored.entries.some((entry) => entry.value.provenance === undefined)).toBe(false)
  expect(stored.entries.map((entry) => entry.value)).toEqual(expect.arrayContaining([
    expect.objectContaining({
      content: expect.stringContaining('Pro'),
      provenance: expect.objectContaining({
        spreadsheets: expect.arrayContaining([
          expect.objectContaining({
            sheet: 'Revenue',
            index: 0,
            range: 'B2:D6',
            sheetBlockId: ingested.blocks[0]?.id,
            cells: expect.arrayContaining([
              expect.objectContaining({
                id: ingested.blocks[0]?.kind === 'sheet' ? ingested.blocks[0].blocks[0]?.rows[1]?.[2]?.id : undefined,
                address: 'D4', displayedValue: '20', formula: '10*2',
              }),
            ]),
          }),
        ]),
      }),
    }),
  ]))

  const hits = await retriever({ id: 'finance', namespace: 'finance', records, search, dense }).retrieve('Pro')
  expect(hits[0]).toMatchObject({ source: { id: 'revenue.xlsx' } })
  const retrieved = hits.find((hit) => hit.kind !== 'finding' && hit.content.includes('Pro'))
  const retrievedSpreadsheet = retrieved?.kind === 'finding' ? undefined : retrieved?.structuredSource?.spreadsheets[0]
  expect(retrievedSpreadsheet).toMatchObject({ sheet: 'Revenue', index: 0, range: 'B2:D6', sheetBlockId: ingested.blocks[0]?.id })
  expect(retrievedSpreadsheet?.cells).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: ingested.blocks[0]?.kind === 'sheet' ? ingested.blocks[0].blocks[0]?.rows[1]?.[2]?.id : undefined,
      address: 'D4', displayedValue: '20', formula: '10*2',
    }),
  ]))

  const mergeHit = (await retriever({ id: 'finance', namespace: 'finance', records, search, dense }).retrieve('Annual'))
    .find((hit) => hit.kind !== 'finding' && hit.content.includes('Annual plan'))
  const retrievedMerge = mergeHit?.kind === 'finding' ? undefined : mergeHit?.structuredSource?.spreadsheets[0]
  expect(retrievedMerge?.cells).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: ingested.blocks[0]?.kind === 'sheet' ? ingested.blocks[0].blocks[0]?.rows[2]?.[0]?.id : undefined,
      address: 'B6', displayedValue: 'Annual plan', mergeMaster: 'B6', mergeRange: 'B6:C6',
    }),
    expect.objectContaining({
      id: ingested.blocks[0]?.kind === 'sheet' ? ingested.blocks[0].blocks[0]?.rows[2]?.[1]?.id : undefined,
      address: 'C6', displayedValue: '', mergeMaster: 'B6', mergeRange: 'B6:C6',
    }),
  ]))
})

it('normalizes only spreadsheet blocks and does not duplicate a one-row table header', async () => {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Summary').getCell('A1').value = 'Only value'
  const ingested = await parseXlsxDocument({ bytes: new Uint8Array(await workbook.xlsx.writeBuffer()) })
  const document = normalizeXlsxDocument(ingested, { namespace: 'finance', sourceId: 'summary.xlsx' })
  const result = await chunker.structured().chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

  expect(result.chunks).toHaveLength(1)
  expect(result.chunks[0]?.content.match(/Only value/g)).toHaveLength(1)
  expect(result.chunks[0]?.provenance?.spreadsheets?.[0]?.cells.map((cell) => cell.address)).toEqual(['A1'])
  expect(() => normalizeXlsxDocument({
    ...ingested,
    blocks: [{
      id: 'not-a-sheet',
      kind: 'text',
      coordinate: { kind: 'document', documentSha256: ingested.source.documentSha256 },
      headingPath: [],
      producer: ingested.producer,
      role: 'paragraph',
      text: 'unsupported',
      inlines: [],
    }],
  })).toThrow('normalizeXlsxDocument only accepts sheet blocks; received text.')
})

it('chunks high-row XLSX tables with one owned row per window', async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Rows')
  sheet.getCell('A1').value = 'Value'
  for (let row = 2; row <= 1_001; row += 1) {
    sheet.getCell(`A${row}`).value = `row-${row}`
  }

  const ingested = await parseXlsxDocument({ bytes: new Uint8Array(await workbook.xlsx.writeBuffer()) })
  const result = await chunker.structured({ tableRowsPerChunk: 1 }).chunkDocument(
    normalizeXlsxDocument(ingested, { namespace: 'finance', sourceId: 'rows.xlsx' }),
    { chunking: { maxChars: 100, overlapChars: 0 } },
  )

  expect(result.chunks).toHaveLength(1_000)
  expect(result.chunks[499]?.provenance?.spreadsheets?.[0]?.cells.map((cell) => cell.address)).toEqual(['A501'])
  expect(result.chunks[999]?.provenance?.spreadsheets?.[0]?.cells.map((cell) => cell.address)).toEqual(['A1001'])
})

it('maps ExcelJS worksheet, sparse-cell, formula, and merge facts to schema 2', async () => {
  const workbook = new ExcelJS.Workbook()
  const revenue = workbook.addWorksheet('Revenue')
  revenue.getCell('B2').value = 'Plan'
  revenue.getCell('D2').value = 'Total'
  revenue.getCell('B4').value = 'Pro'
  revenue.getCell('D4').value = { formula: '10*2', result: 20 }
  revenue.mergeCells('B6:C6')
  revenue.getCell('B6').value = 'Annual plan'
  const forecast = workbook.addWorksheet('Forecast')
  forecast.getCell('A1').value = 'Q1'

  const document = await parseXlsxDocument({ bytes: new Uint8Array(await workbook.xlsx.writeBuffer()) })
  const sheets = document.blocks.filter((block) => block.kind === 'sheet')

  expect(document.source).toMatchObject({
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    format: 'xlsx',
  })
  expect(document.producer).toEqual({ kind: 'parser', name: 'exceljs', version: '4.4.0', adapterVersion: '2' })
  expect(sheets).toMatchObject([
    { sheet: 'Revenue', index: 0, range: 'B2:D6', coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'B2:D6' } },
    { sheet: 'Forecast', index: 1, range: 'A1' },
  ])
  const table = sheets[0]?.blocks[0]
  expect(table).toMatchObject({ coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'B2:D6' } })
  expect(table?.rows[0]).toMatchObject([
    { row: 2, column: 2, coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'B2' }, displayedValue: 'Plan' },
    { row: 2, column: 3, coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'C2' }, displayedValue: '' },
    { row: 2, column: 4, coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'D2' }, displayedValue: 'Total' },
  ])
  expect(table?.rows[1]?.[0]).toMatchObject({ row: 4, column: 2, displayedValue: 'Pro' })
  expect(table?.rows[1]?.[2]).toMatchObject({ row: 4, column: 4, displayedValue: '20', formula: '10*2' })
  expect(table?.rows[2]?.[0]).toMatchObject({ row: 6, column: 2, displayedValue: 'Annual plan', mergeRange: 'B6:C6', columnSpan: 2 })
  expect(table?.rows[2]?.[1]).toMatchObject({ row: 6, column: 3, displayedValue: '', mergeRange: 'B6:C6' })

  expect(sheets[0]?.id).toMatch(/^xlsx:[0-9a-f]{64}:parser:exceljs:4\.4\.0:2:sheet:1$/)
  expect(sheets[0]?.blocks[0]?.rows[1]?.[2]?.id).toMatch(/^xlsx:[0-9a-f]{64}:parser:exceljs:4\.4\.0:2:sheet:1:table:1:row:4:column:4$/)
})

it('uses the XLSM source format and media type without changing ExcelJS facts', async () => {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('Data').getCell('A1').value = 'Value'

  const document = await parseXlsxDocument({
    bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
    mediaType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  })

  expect(document.source).toMatchObject({
    mediaType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    format: 'xlsm',
  })
})

it('preserves ExcelJS displayed values independently from formula expressions', async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Values')
  sheet.getCell('A1').value = { richText: [{ text: 'Plan' }, { text: ' name' }] }
  sheet.getCell('B1').value = { text: 'Crux docs', hyperlink: 'https://cruxjs.dev/docs' }
  sheet.getCell('C1').value = { error: '#DIV/0!' }
  sheet.getCell('A2').value = 0.2
  sheet.getCell('A2').numFmt = '0%'
  sheet.getCell('B2').value = { formula: '1-1', result: 0 }
  sheet.getCell('C2').value = { formula: '1=2', result: false }

  const document = await parseXlsxDocument({ bytes: new Uint8Array(await workbook.xlsx.writeBuffer()) })
  const sheetBlock = document.blocks[0]
  if (!sheetBlock || sheetBlock.kind !== 'sheet') {
    throw new Error('Expected a sheet block.')
  }

  expect(sheetBlock.blocks[0]?.columns).toEqual(['Plan name', 'Crux docs', '#DIV/0!'])
  expect(sheetBlock.blocks[0]?.rows[1]).toMatchObject([
    { displayedValue: '20%' },
    { displayedValue: '0', formula: '1-1' },
    { displayedValue: 'false', formula: '1=2' },
  ])
  expect(document.diagnostics).toEqual([])
})

it('preserves shared-formula translation, vertical merge topology, and saved currency/date displays', async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Details')
  sheet.getCell('A1').value = 'Amount'
  sheet.getCell('B1').value = 'Due'
  sheet.getCell('C1').value = 'Shared'
  sheet.getCell('A2').value = 1234.5
  sheet.getCell('A2').numFmt = '$#,##0.00'
  sheet.getCell('B2').value = new Date(Date.UTC(2024, 0, 2))
  sheet.getCell('B2').numFmt = 'yyyy-mm-dd'
  sheet.getCell('C2').value = 1
  sheet.getCell('C3').value = 2
  sheet.fillFormula('D2:D3', 'C2+1', [2, 3])
  sheet.mergeCells('E2:E4')
  sheet.getCell('E2').value = 'Annual'

  const document = await parseXlsxDocument({ bytes: new Uint8Array(await workbook.xlsx.writeBuffer()) })
  const sheetBlock = document.blocks[0]
  if (!sheetBlock || sheetBlock.kind !== 'sheet') {
    throw new Error('Expected a sheet block.')
  }
  const rows = sheetBlock.blocks[0]!.rows

  expect(rows[1]).toMatchObject([
    { displayedValue: '$1,234.50' },
    { displayedValue: '2024-01-02' },
    { displayedValue: '1' },
    { displayedValue: '2', formula: 'C2+1' },
    { displayedValue: 'Annual', mergeRange: 'E2:E4', rowSpan: 3 },
  ])
  expect(rows[2]?.[3]).toMatchObject({ displayedValue: '3', formula: 'C3+1' })
  expect(rows[2]?.[4]).toMatchObject({ displayedValue: '', mergeRange: 'E2:E4', rowSpan: 1 })
  expect(rows[3]?.[4]).toMatchObject({ displayedValue: '', mergeRange: 'E2:E4', rowSpan: 1 })
})

it('warns with an exact cell coordinate for malformed structured ExcelJS values', () => {
  const diagnostics: Parameters<typeof projectXlsxSchema2DisplayValue>[1]['diagnostics'] = []

  expect(projectXlsxSchema2DisplayValue({ richText: [{ text: 42 }] }, {
    sheet: 'Values',
    address: 'A1',
    diagnostics,
  })).toBe('')
  expect(diagnostics).toEqual([
    {
      code: 'partial-extraction',
      severity: 'warning',
      message: 'Could not project XLSX structured value for cell A1; emitted empty value.',
      coordinate: { kind: 'sheet-range', sheet: 'Values', range: 'A1' },
      producer: { kind: 'parser', name: 'exceljs', version: '4.4.0', adapterVersion: '2' },
    },
  ])
})

it('keeps huge merge rectangles compact and rejects huge worksheet iteration before allocation', () => {
  const merges = projectXlsxMergeRectangles(['A1:XFD1048576'])

  expect(merges).toHaveLength(1)
  expect(resolveXlsxMerge(merges, 1_048_576, 16_384)).toMatchObject({
    address: 'A1:XFD1048576',
    master: 'A1',
  })
  expect(() => buildXlsxMergeMembership(merges)).toThrow('XLSX merge membership exceeds the 1000000-operation ingest budget.')
  expect(() => assertXlsxWorksheetCellBudget({ top: 1, bottom: 1_048_576, left: 1, right: 16_384 }, 'Hostile')).toThrow(
    'XLSX worksheet Hostile exceeds the 1000000-cell ingest budget.',
  )
})

it('indexes merge-heavy worksheets with bounded construction work and constant-time membership', () => {
  const merges = projectXlsxMergeRectangles(
    Array.from({ length: 500 }, (_, index) => `A${index * 2 + 1}:B${index * 2 + 1}`),
  )
  const membership = buildXlsxMergeMembership(merges)

  expect(membership.operations).toBe(1_000)
  expect(membership.cells.size).toBe(1_000)
  expect(membership.cells.get('B999')).toMatchObject({ address: 'A999:B999', master: 'A999' })
})
