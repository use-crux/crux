import { describe, expect, it } from 'vitest'

import { IngestedDocumentContractError, validateIngestedDocument } from '../../src/indexing'

const parser = {
  kind: 'parser',
  name: 'pdf-inspector',
  version: '1.2.3',
  adapterVersion: '2.0.0',
} as const

const documentSha256 = 'a'.repeat(64)

function document() {
  const page = { kind: 'page', page: 2 } as const
  const pageBlock = { kind: 'page-block', page: 2, block: 1, start: 0, end: 7 } as const
  const text = {
    id: 'text-1',
    kind: 'text',
    coordinate: pageBlock,
    headingPath: ['Overview'],
    producer: parser,
    role: 'paragraph',
    text: 'Read me',
    inlines: [
      { kind: 'text', text: 'Read ', coordinate: pageBlock, producer: parser },
      { kind: 'link', text: 'me', target: 'https://example.com', coordinate: pageBlock, producer: parser },
    ],
  } as const
  const list = {
    id: 'list-1',
    kind: 'list',
    coordinate: pageBlock,
    headingPath: [],
    producer: parser,
    ordered: true,
    items: [{ id: 'item-1', coordinate: pageBlock, producer: parser, blocks: [text] }],
  } as const
  const table = {
    id: 'table-1',
    kind: 'table',
    coordinate: { kind: 'logical-table', rowStart: 0, rowEnd: 1 },
    headingPath: [],
    producer: parser,
    columns: ['Name'],
    headerRows: 1,
    rows: [
      [
        {
          id: 'cell-a1',
          coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'A1' },
          producer: parser,
          row: 0,
          column: 0,
          rowSpan: 1,
          columnSpan: 1,
          blocks: [text],
          displayedValue: '10',
          formula: '=5+5',
          mergeRange: 'A1:A2',
        },
      ],
    ],
  } as const

  return {
    schemaVersion: 2,
    source: { documentSha256, mediaType: 'application/pdf', format: 'pdf' },
    producer: parser,
    metadata: { indexed: true, pages: 2 },
    blocks: [
      text,
      list,
      table,
      {
        id: 'page-2',
        kind: 'page',
        coordinate: page,
        headingPath: [],
        producer: parser,
        page: 2,
        blocks: [text, list, table],
      },
      {
        id: 'slide-1',
        kind: 'slide',
        coordinate: { kind: 'slide', slide: 1 },
        headingPath: [],
        producer: parser,
        slide: 1,
        blocks: [text, list, table],
        notes: [{ ...text, id: 'note-1', role: 'note' }],
      },
      {
        id: 'sheet-revenue',
        kind: 'sheet',
        coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'A1:A2' },
        headingPath: [],
        producer: parser,
        sheet: 'Revenue',
        range: 'A1:A2',
        blocks: [table],
      },
    ],
    assets: [
      {
        id: 'asset-1',
        mediaType: 'image/png',
        sha256: 'b'.repeat(64),
        byteLength: 5,
        coordinate: { kind: 'package-part', part: 'word/media/image1.png', anchor: 'rId1' },
        producer: parser,
      },
      {
        id: 'asset-2',
        mediaType: 'application/octet-stream',
        sha256: 'c'.repeat(64),
        byteLength: 2,
        coordinate: { kind: 'document', documentSha256 },
        producer: parser,
      },
    ],
    diagnostics: [
      {
        code: 'parser-downgrade',
        severity: 'warning',
        trigger: 'invalid-result',
        from: 'pdf-inspector',
        to: 'pdfjs-dist',
        producer: parser,
      },
      {
        code: 'partial-extraction',
        severity: 'warning',
        message: 'A page has no text.',
        coordinate: page,
        producer: parser,
      },
      { code: 'unsupported-feature', severity: 'warning', message: 'Annotations were skipped.', producer: parser },
    ],
  }
}

function expectContractError(run: () => unknown) {
  expect(run).toThrow(IngestedDocumentContractError)
}

describe('ingested document schema 2', () => {
  it('accepts every closed block, nested fact, coordinate, producer, and diagnostic variant', () => {
    const input = document()
    const validated = validateIngestedDocument(input)

    input.blocks[0].text = 'changed'

    expect(validated.schemaVersion).toBe(2)
    expect(validated.blocks.map((block) => block.kind)).toEqual(['text', 'list', 'table', 'page', 'slide', 'sheet'])
    expect(validated.blocks[3]?.coordinate).toEqual({ kind: 'page', page: 2 })
    expect(validated.blocks[4]?.producer).toEqual(parser)
    expect(Object.isFrozen(validated)).toBe(true)
    expect(Object.isFrozen(validated.blocks)).toBe(true)
  })

  it('accepts host-owned derived media descriptions only with an application-operation producer', () => {
    const input = document()
    input.blocks[0] = {
      ...input.blocks[0],
      coordinate: { kind: 'page', page: 2 },
      producer: {
        kind: 'application-operation',
        operation: 'media.describe',
        identity: 'vision-prod',
        version: '2026-08-08',
      },
    } as (typeof input.blocks)[number]

    expect(validateIngestedDocument(input).blocks[0]?.producer).toMatchObject({
      kind: 'application-operation',
      operation: 'media.describe',
    })
  })

  it('rejects incomplete, invented, and open shapes', () => {
    const badDocumentHash = document()
    badDocumentHash.source.documentSha256 = 'not-a-sha'
    expectContractError(() => validateIngestedDocument(badDocumentHash))

    const detachedDocumentCoordinate = document()
    detachedDocumentCoordinate.assets[1] = {
      ...detachedDocumentCoordinate.assets[1],
      coordinate: { kind: 'document', documentSha256: 'd'.repeat(64) },
    } as (typeof detachedDocumentCoordinate.assets)[number]
    expectContractError(() => validateIngestedDocument(detachedDocumentCoordinate))

    const inventedPageBlock = document()
    inventedPageBlock.blocks[0] = {
      ...inventedPageBlock.blocks[0],
      coordinate: { kind: 'page-block', page: 2, block: 0 },
    } as (typeof inventedPageBlock.blocks)[number]
    expectContractError(() => validateIngestedDocument(inventedPageBlock))

    const unknownCoordinate = document()
    unknownCoordinate.blocks[0] = {
      ...unknownCoordinate.blocks[0],
      coordinate: { kind: 'line', line: 1 },
    } as (typeof unknownCoordinate.blocks)[number]
    expectContractError(() => validateIngestedDocument(unknownCoordinate))

    const openCoordinate = document()
    openCoordinate.blocks[0] = {
      ...openCoordinate.blocks[0],
      coordinate: { kind: 'page', page: 2, extra: true },
    } as (typeof openCoordinate.blocks)[number]
    expectContractError(() => validateIngestedDocument(openCoordinate))

    const parserAttributedDescription = document()
    parserAttributedDescription.blocks[0] = {
      ...parserAttributedDescription.blocks[0],
      coordinate: { kind: 'page', page: 2 },
      provenance: 'derived',
    } as (typeof parserAttributedDescription.blocks)[number]
    expectContractError(() => validateIngestedDocument(parserAttributedDescription))

    const invalidDiagnostic = document()
    invalidDiagnostic.diagnostics[0] = {
      ...invalidDiagnostic.diagnostics[0],
      trigger: 'timeout',
    } as (typeof invalidDiagnostic.diagnostics)[number]
    expectContractError(() => validateIngestedDocument(invalidDiagnostic))
  })
})
