import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { adaptPdfParseResult, parsePdfDocument } from '../src/pdf'

const bytes = new TextEncoder().encode('schema-2 PDF fixture')
const sha256 = createHash('sha256').update(bytes).digest('hex')

it('adapts layout-aware PDF Markdown into page, narrative, and table facts', () => {
  const document = adaptPdfParseResult({
    bytes,
    parsed: {
      title: 'PDF title',
      parts: [{
        id: 'pdf:page:1',
        kind: 'page',
        pageNumber: 1,
        sourceLocation: { type: 'page', pageNumber: 1 },
        content: '# Overview\n\nOpening paragraph.\n\n| Name | Status |\n| --- | --- |\n| Crux | Ready |',
        blocks: [
          { id: 'pdf:page:1/block:0', kind: 'text', role: 'heading', content: '# Overview', headingPath: ['Overview'], sourceRange: { start: 0, end: 10 } },
          { id: 'pdf:page:1/block:1', kind: 'text', role: 'paragraph', content: 'Opening paragraph.', headingPath: ['Overview'], sourceRange: { start: 12, end: 30 } },
          { id: 'pdf:page:1/block:2', kind: 'table', content: '| Name | Status |\n| --- | --- |\n| Crux | Ready |', columns: ['Name', 'Status'], rows: [['Crux', 'Ready']], headingPath: ['Overview'] },
        ],
      }],
    },
  })

  expect(document.source).toEqual({ documentSha256: sha256, mediaType: 'application/pdf', format: 'pdf' })
  expect(document.metadata).toEqual({ title: 'PDF title' })
  expect(document.producer).toEqual({ kind: 'parser', name: 'pdf-inspector', version: '1.12.0', adapterVersion: '2' })
  expect(document.blocks).toMatchObject([
    {
      kind: 'page', page: 1, coordinate: { kind: 'page', page: 1 },
      blocks: [
        { kind: 'text', role: 'heading', text: '# Overview', level: 1, coordinate: { kind: 'page-block', page: 1, block: 1, start: 0, end: 10 } },
        { kind: 'text', role: 'paragraph', text: 'Opening paragraph.', coordinate: { kind: 'page-block', page: 1, block: 2, start: 12, end: 30 } },
        { kind: 'table', columns: ['Name', 'Status'], headerRows: 1, coordinate: { kind: 'page-block', page: 1, block: 3 } },
      ],
    },
  ])
  expect(document.blocks[0]?.id).toMatch(/^pdf:[0-9a-f]{64}:parser:pdf-inspector:1\.12\.0:2:page:1$/)
  const page = document.blocks[0]
  if (!page || page.kind !== 'page') throw new Error('Expected page')
  expect(page.blocks[2]?.id).toMatch(/^pdf:[0-9a-f]{64}:parser:pdf-inspector:1\.12\.0:2:page:1:block:3$/)
  expect(page.blocks[2]?.kind === 'table' && page.blocks[2].rows.map((row) => row.map((cell) => cell.displayedValue))).toEqual([
    ['Name', 'Status'],
    ['Crux', 'Ready'],
  ])
  expect(page.blocks[2]?.kind === 'table' && page.blocks[2].rows[0]?.[0]?.id).toMatch(
    /^pdf:[0-9a-f]{64}:parser:pdf-inspector:1\.12\.0:2:page:1:block:3:row:1:column:1$/,
  )
})

it('retains ordered PDF list item boundaries and nesting from emitted Markdown', () => {
  const content = '1. First\n   - Nested one\n   - Nested two\n2. Second'
  const document = adaptPdfParseResult({
    bytes,
    parsed: {
      parts: [{
        id: 'pdf:page:1', kind: 'page', pageNumber: 1,
        sourceLocation: { type: 'page', pageNumber: 1 }, content,
        blocks: [{ id: 'pdf:page:1/block:0', kind: 'text', role: 'list', content: 'First\nNested one\nNested two\nSecond' }],
      }],
    },
  })

  const page = document.blocks[0]
  if (!page || page.kind !== 'page') throw new Error('Expected page.')
  const list = page.blocks[0]
  if (!list || list.kind !== 'list') throw new Error('Expected list.')
  expect(list.ordered).toBe(true)
  expect(list.items.map((item) => item.blocks.map(listText))).toEqual([
    [['First'], [[['Nested one']], [['Nested two']]]],
    [['Second']],
  ])
})

it('retains fallback and empty physical pages with only a page coordinate and typed downgrade', () => {
  const document = adaptPdfParseResult({
    bytes,
    parsed: {
      parts: [
        { id: 'pdf:page:1', kind: 'page', pageNumber: 1, sourceLocation: { type: 'page', pageNumber: 1 }, content: 'Fallback text' },
        { id: 'pdf:page:2', kind: 'page', pageNumber: 2, sourceLocation: { type: 'page', pageNumber: 2 }, content: '' },
      ],
      warnings: [{
        code: 'parser_warning',
        message: 'PDF source "fixture" used the pdfjs-dist fallback because layout-aware extraction was unavailable; document structure may be reduced.',
        metadata: { primaryParser: 'pdf-inspector', fallbackParser: 'pdfjs-dist', reason: 'invalid_result' },
      }, {
        code: 'partial_extraction',
        message: 'PDF source "fixture" page 2 was retained without content because no media.describe operation was available.',
        partId: 'pdf:page:2',
        metadata: { pageNumber: 2, sourceLocation: { type: 'page', pageNumber: 2 } },
      }],
    },
  })

  expect(document.producer).toMatchObject({ kind: 'parser', name: 'pdfjs-dist' })
  expect(document.blocks.map((block) => block.coordinate)).toEqual([{ kind: 'page', page: 1 }, { kind: 'page', page: 2 }])
  expect(document.diagnostics).toEqual([
    { code: 'parser-downgrade', severity: 'warning', trigger: 'invalid-result', from: 'pdf-inspector', to: 'pdfjs-dist', producer: document.producer },
    expect.objectContaining({ code: 'partial-extraction', coordinate: { kind: 'page', page: 2 }, producer: document.producer }),
  ])
})

it('attributes media descriptions to the supplied application operation producer', () => {
  const producer = { kind: 'application-operation' as const, operation: 'media.describe' as const, identity: 'vision:model-a', version: '2026-08-08' }
  const document = adaptPdfParseResult({
    bytes,
    mediaProducers: { describe: producer },
    parsed: {
      parts: [{ id: 'pdf:page:3:visual', kind: 'page', pageNumber: 3, sourceLocation: { type: 'page', pageNumber: 3 }, content: 'Diagram of the system.' }],
    },
  })

  expect(document.blocks[0]).toMatchObject({ producer, coordinate: { kind: 'page', page: 3 } })
  expect(document.blocks[0]?.id).toMatch(/^pdf:[0-9a-f]{64}:application-operation:media\.describe:vision:model-a:2026-08-08:page:3:derived$/)
})

it('rejects a transcription identity for PDF visual output', () => {
  const producer = { kind: 'application-operation' as const, operation: 'media.transcribe' as const, identity: 'audio:model-a', version: '2026-08-08' }
  expect(() => adaptPdfParseResult({
    bytes,
    mediaProducers: { describe: producer },
    parsed: {
      parts: [{ id: 'pdf:page:3:visual', kind: 'page', pageNumber: 3, sourceLocation: { type: 'page', pageNumber: 3 }, content: 'Diagram of the system.' }],
    },
  })).toThrow(/media\.describe/)
})

it('uses the installed inspector for real PDF page and layout facts', async () => {
  const document = await parsePdfDocument({
    bytes: await readFile(join(import.meta.dirname, 'fixtures', 'layout-aware-mixed.pdf')),
  })

  expect(document.producer).toMatchObject({ kind: 'parser', name: 'pdf-inspector' })
  expect(document.blocks).toHaveLength(8)
  expect(document.blocks.map((block) => block.coordinate)).toEqual(
    Array.from({ length: 8 }, (_, index) => ({ kind: 'page', page: index + 1 })),
  )
  const first = document.blocks[0]
  if (!first || first.kind !== 'page') throw new Error('Expected first page.')
  expect(first.blocks).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'text', role: 'heading' }),
    expect.objectContaining({ kind: 'table' }),
  ]))
})

function listText(block: { readonly kind: string; readonly text?: string; readonly ordered?: boolean; readonly items?: readonly { readonly blocks: readonly unknown[] }[] }): unknown {
  if (block.kind === 'text') return [block.text]
  if (block.kind === 'list') return block.items?.map((item) => item.blocks.map((nested) => listText(nested as Parameters<typeof listText>[0])))
  return block.kind
}
