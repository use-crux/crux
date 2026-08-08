import { expect, it } from 'vitest'
import { parseCsvDocument } from '../src/csv'

type Assert<T extends true> = T
type ParseCsvDocumentInputHasNoText = Assert<'text' extends keyof Parameters<typeof parseCsvDocument>[0] ? false : true>

it('maps csv-parse facts into an exact schema-2 logical table', () => {
  const bytes = new TextEncoder().encode('Plan,Price,Notes\nPro,20,"best, value"\nFree,,')

  const document = parseCsvDocument({ bytes })
  const facts = csvFacts(document)
  const { cellCoordinates, ...snapshot } = facts

  expect(JSON.stringify(snapshot)).toMatchInlineSnapshot(
    `"{\"source\":{\"documentSha256\":\"788539879c0cc6dd3e551e7efe90d9149098072965ae4e4c695ced3287a1e459\",\"mediaType\":\"text/csv\",\"format\":\"csv\"},\"table\":{\"coordinate\":{\"kind\":\"logical-table\",\"rowStart\":1,\"rowEnd\":3},\"columns\":[\"Plan\",\"Price\",\"Notes\"],\"headerRows\":1,\"cells\":[[[1,1,\"Plan\"],[1,2,\"Price\"],[1,3,\"Notes\"]],[[2,1,\"Pro\"],[2,2,\"20\"],[2,3,\"best, value\"]],[[3,1,\"Free\"],[3,2,\"\"],[3,3,\"\"]]]}}"`,
  )

  expect(cellCoordinates).toEqual([
    Array.from({ length: 3 }, () => ({ kind: 'logical-table', rowStart: 1, rowEnd: 1 })),
    Array.from({ length: 3 }, () => ({ kind: 'logical-table', rowStart: 2, rowEnd: 2 })),
    Array.from({ length: 3 }, () => ({ kind: 'logical-table', rowStart: 3, rowEnd: 3 })),
  ])

  expect(document.producer).toEqual({
    kind: 'parser',
    name: 'csv-parse',
    version: '6.2.1',
    adapterVersion: '2',
  })
  expect(document.blocks[0]?.id).toBe(
    'csv:788539879c0cc6dd3e551e7efe90d9149098072965ae4e4c695ced3287a1e459:parser:csv-parse:6.2.1:2:table:1',
  )
  expect(document.blocks[0]?.kind === 'table' && document.blocks[0].rows[1]?.[2]?.id).toBe(
    'csv:788539879c0cc6dd3e551e7efe90d9149098072965ae4e4c695ced3287a1e459:parser:csv-parse:6.2.1:2:table:1:row:2:column:3',
  )
})

it('derives CSV facts from the hashed source bytes', () => {
  const bytes = new TextEncoder().encode('Plan,Price\nPro,20')

  expect(parseCsvDocument({ bytes }).blocks).toMatchObject([
    { kind: 'table', columns: ['Plan', 'Price'] },
  ])
})

function csvFacts(document: ReturnType<typeof parseCsvDocument>) {
  const table = document.blocks[0]
  if (!table || table.kind !== 'table') {
    throw new Error('Expected a CSV table.')
  }

  return {
    source: document.source,
    table: {
      coordinate: table.coordinate,
      columns: table.columns,
      headerRows: table.headerRows,
      cells: table.rows.map((row) =>
        row.map((cell) => [cell.row, cell.column, cell.blocks[0]?.kind === 'text' ? cell.blocks[0].text : undefined]),
      ),
    },
    cellCoordinates: table.rows.map((row) => row.map((cell) => cell.coordinate)),
  }
}
