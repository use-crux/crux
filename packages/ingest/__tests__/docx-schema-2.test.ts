import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow } from 'docx'
import { expect, it } from 'vitest'
import { adaptMammothDocxResult, parseDocxDocument } from '../src/docx'

it('maps Mammoth DOCX text and table facts into ordered schema-2 blocks', async () => {
  const bytes = await makeDocx()

  const document = await parseDocxDocument({ bytes })

  expect(document.source).toMatchObject({ mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', format: 'docx' })
  expect(document.source.documentSha256).toMatch(/^[0-9a-f]{64}$/)
  expect(document.producer).toEqual({
    kind: 'parser',
    name: 'mammoth',
    version: '1.12.0',
    adapterVersion: '2',
  })
  expect(document.blocks.map(docxFact)).toEqual([
    ['text', 'heading', ['Release Notes'], 'Release Notes', 1],
    ['text', 'paragraph', ['Release Notes'], 'Ship structured ingestion', undefined],
    ['table', ['Release Notes'], [], 0, [['Plan', 'Status'], ['Parser', 'Ready']]],
  ])
  expect(document.blocks.slice(0, 3).map((block) => block.id)).toEqual([
    expect.stringMatching(/^docx:[0-9a-f]{64}:parser:mammoth:1\.12\.0:2:block:1$/),
    expect.stringMatching(/^docx:[0-9a-f]{64}:parser:mammoth:1\.12\.0:2:block:2$/),
    expect.stringMatching(/^docx:[0-9a-f]{64}:parser:mammoth:1\.12\.0:2:block:3$/),
  ])
  expect(document.blocks[2]?.kind === 'table' && document.blocks[2].rows[1]?.[1]?.id).toMatch(
    /^docx:[0-9a-f]{64}:parser:mammoth:1\.12\.0:2:block:3:row:2:column:2$/,
  )
  expect(document.blocks.every((block) => block.coordinate.kind === 'document')).toBe(true)
})

it('keeps nested lists and table-cell text within their structural parent', () => {
  const document = adaptMammothDocxResult({
    bytes: new TextEncoder().encode('nested structure'),
    html: '<p>Before</p><ol><li>First<ul><li>Nested</li></ul></li><li>Second</li></ol><table><tr><td>Cell</td></tr></table><p>After</p>',
  })

  expect(document.blocks.map((block) => block.kind)).toEqual(['text', 'list', 'table', 'text'])
  const list = document.blocks[1]
  if (!list || list.kind !== 'list') {
    throw new Error('Expected a top-level list.')
  }
  expect(list.items.map((item) => item.blocks.map(listFact))).toEqual([
    [
      ['text', 'First'],
      ['list', false, [[['text', 'Nested']]]],
    ],
    [['text', 'Second']],
  ])
})

it('retains Mammoth table spans and only declares headers established by HTML', () => {
  const document = adaptMammothDocxResult({
    bytes: new TextEncoder().encode('merged table'),
    html: '<table><tr><td rowspan="2">A</td><td colspan="2">B</td></tr><tr><td>C</td><td>D</td></tr></table><table><tr><th>Name</th><th>Value</th></tr><tr><td>Crux</td><td>Ready</td></tr></table>',
  })
  const [headerless, headed] = document.blocks
  if (!headerless || headerless.kind !== 'table' || !headed || headed.kind !== 'table') {
    throw new Error('Expected two tables.')
  }

  expect({ columns: headerless.columns, headerRows: headerless.headerRows, rows: headerless.rows.map((row) => row.map(tableFact)) }).toEqual({
    columns: [],
    headerRows: 0,
    rows: [
      [[1, 1, 2, 1, 'A'], [1, 2, 1, 2, 'B']],
      [[2, 2, 1, 1, 'C'], [2, 3, 1, 1, 'D']],
    ],
  })
  expect({ columns: headed.columns, headerRows: headed.headerRows }).toEqual({
    columns: ['Name', 'Value'],
    headerRows: 1,
  })
})

it('preserves Mammoth warnings as truthful document-level partial-extraction diagnostics', () => {
  const document = adaptMammothDocxResult({
    bytes: new TextEncoder().encode('not a DOCX fixture'),
    html: '<p>Recovered text</p>',
    messages: [{ type: 'warning', message: 'Unrecognised paragraph style: Aside' }],
  })

  expect(document.diagnostics).toEqual([
    {
      code: 'partial-extraction',
      severity: 'warning',
      message: 'Unrecognised paragraph style: Aside',
      coordinate: { kind: 'document', documentSha256: document.source.documentSha256 },
      producer: document.producer,
    },
  ])
})

function docxFact(block: Awaited<ReturnType<typeof parseDocxDocument>>['blocks'][number]): unknown {
  if (block.kind === 'text') {
    return [block.kind, block.role, block.headingPath, block.text, block.level]
  }
  if (block.kind === 'table') {
    return [block.kind, block.headingPath, block.columns, block.headerRows, block.rows.map((row) => row.map(cellText))]
  }
  return block.kind
}

function cellText(cell: { readonly blocks: readonly { readonly kind: string; readonly text?: string }[] }): string | undefined {
  const block = cell.blocks[0]
  return block?.kind === 'text' ? block.text : undefined
}

function listFact(block: { readonly kind: string; readonly text?: string; readonly ordered?: boolean; readonly items?: readonly { readonly blocks: readonly unknown[] }[] }): unknown {
  if (block.kind === 'text') {
    return ['text', block.text]
  }
  if (block.kind === 'list') {
    return ['list', block.ordered, block.items?.map((item) => item.blocks.map((nested) => listFact(nested as Parameters<typeof listFact>[0])))]
  }
  return block.kind
}

function tableFact(cell: { readonly row: number; readonly column: number; readonly rowSpan: number; readonly columnSpan: number; readonly blocks: readonly { readonly kind: string; readonly text?: string }[] }): unknown {
  return [cell.row, cell.column, cell.rowSpan, cell.columnSpan, cellText(cell)]
}

async function makeDocx(): Promise<Buffer> {
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'Release Notes', heading: HeadingLevel.HEADING_1 }),
          new Paragraph('Ship structured ingestion'),
          new Table({
            rows: [
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Plan')] }), new TableCell({ children: [new Paragraph('Status')] })] }),
              new TableRow({ children: [new TableCell({ children: [new Paragraph('Parser')] }), new TableCell({ children: [new Paragraph('Ready')] })] }),
            ],
          }),
        ],
      },
    ],
  })
  return Buffer.from(await Packer.toBuffer(document))
}
