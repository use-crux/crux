import ExcelJS from 'exceljs'
import { expect, it } from 'vitest'
import { parseXlsxDocument } from '../src/xlsx'

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
