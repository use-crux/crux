import { expect, it } from 'vitest'
import { mergeProvenance } from '../../src/indexing/provenance'

it('merges many spreadsheet windows once while retaining deterministic cell ownership', () => {
  const provenance = mergeProvenance(Array.from({ length: 1_000 }, (_, index) => ({
    spreadsheets: [{
      sheetBlockId: 'sheet:rows',
      tableBlockId: 'table:rows',
      sheet: 'Rows',
      index: 0,
      range: 'A1:A1001',
      cells: [{
        id: `cell:${index + 2}`,
        address: `A${index + 2}`,
        row: index + 2,
        column: 1,
        displayedValue: `row-${index + 2}`,
      }],
    }],
  })))

  expect(provenance?.spreadsheets).toHaveLength(1)
  expect(provenance?.spreadsheets?.[0]?.cells).toHaveLength(1_000)
  expect(provenance?.spreadsheets?.[0]?.cells[0]?.id).toBe('cell:2')
  expect(provenance?.spreadsheets?.[0]?.cells[999]?.id).toBe('cell:1001')
})
