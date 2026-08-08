import { expect, it } from 'vitest'

import { indexedChunkToHit } from '../../src/indexed-knowledge/records'
import { chunkDocumentStructured } from '../../src/indexing/chunkers'
import { normalizeXlsxDocument } from '../../src/indexing/normalize-ingested-document'
import { createIndexedChunkRecord } from '../../src/indexed-knowledge/records'
import { validateIngestedDocument } from '../../src/indexing'

const sha = 'a'.repeat(64)
const parser = { kind: 'parser', name: 'exceljs', version: '4.4.0', adapterVersion: '2.0.0' } as const

it('derives truthful XLSX stored evidence through normalization, chunking, persistence, and retrieval', () => {
  const document = validateIngestedDocument({
    schemaVersion: 2,
    source: {
      documentSha256: sha,
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      format: 'xlsx',
    },
    producer: parser,
    metadata: {},
    blocks: [
      {
        id: 'sheet:Revenue',
        kind: 'sheet',
        coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'A1:B2' },
        headingPath: [],
        producer: parser,
        sheet: 'Revenue',
        index: 0,
        range: 'A1:B2',
        blocks: [
          {
            id: 'table:Revenue',
            kind: 'table',
            coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'A1:B2' },
            headingPath: [],
            producer: parser,
            columns: ['Name', 'Value'],
            headerRows: 1,
            rows: [
              [
                {
                  id: 'cell:A1',
                  coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'A1' },
                  producer: parser,
                  row: 0,
                  column: 0,
                  rowSpan: 1,
                  columnSpan: 1,
                  blocks: [],
                  displayedValue: 'Name',
                },
                {
                  id: 'cell:B1',
                  coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'B1' },
                  producer: parser,
                  row: 0,
                  column: 1,
                  rowSpan: 1,
                  columnSpan: 1,
                  blocks: [],
                  displayedValue: 'Value',
                },
              ],
              [
                {
                  id: 'cell:A2',
                  coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'A2' },
                  producer: parser,
                  row: 1,
                  column: 0,
                  rowSpan: 1,
                  columnSpan: 1,
                  blocks: [],
                  displayedValue: 'ARR',
                },
                {
                  id: 'cell:B2',
                  coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'B2' },
                  producer: parser,
                  row: 1,
                  column: 1,
                  rowSpan: 1,
                  columnSpan: 1,
                  blocks: [],
                  displayedValue: '10',
                  formula: '=5+5',
                },
              ],
            ],
          },
        ],
      },
    ],
    assets: [],
    diagnostics: [],
  })
  const normalized = normalizeXlsxDocument(document, { namespace: 'finance', sourceId: 'revenue.xlsx' })
  const [chunk] = chunkDocumentStructured(
    normalized,
    { chunking: { maxChars: 1_000, overlapChars: 0 } },
    { tableRowsPerChunk: 25 },
  ).chunks
  const record = createIndexedChunkRecord({ indexerId: 'docs', generationId: 'g1', chunk: chunk!, now: 1 })
  const hit = indexedChunkToHit({ value: record, score: 1 })

  expect(hit?.evidence).toMatchObject({
    documentSha256: sha,
    producer: parser,
    coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'A1:B2' },
    blockIds: ['sheet:Revenue', 'table:Revenue', 'cell:A1', 'cell:B1', 'cell:A2', 'cell:B2'],
    normalizedContent: 'Name | Value\nARR | 10',
    normalizationVersion: 'crux:ingested-document:2',
    chunkerVersion: 'structured:2',
  })
})
