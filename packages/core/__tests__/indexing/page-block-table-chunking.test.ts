import { describe, expect, it } from 'vitest'
import { chunker } from '../../src/indexing'
import type { CruxDocument } from '../../src/indexing'

describe('structured page table chunking', () => {
  it('emits no chunks for a standalone empty table with its own heading path', async () => {
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'empty-table', content: '',
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content: '',
        blocks: [{
          id: 'empty', kind: 'table', content: '', headingPath: ['Empty'], columns: [], rows: [],
        }],
      }],
    }

    const result = await chunker.structured({ maxChars: 200, overlapChars: 0, tableRowsPerChunk: 2 })
      .chunkDocument(document, { chunking: { maxChars: 200, overlapChars: 0 } })

    expect(result.chunks).toEqual([])
  })

  it('uses each table declared heading path and only its represented heading ancestry', async () => {
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'table-heading-paths', content: 'tables',
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content: 'tables',
        blocks: [
          {
            id: 'standalone', kind: 'table', content: 'standalone', headingPath: ['Standalone'],
            columns: ['Value'], rows: [['first']],
          },
          { id: 'guide', kind: 'text', role: 'heading', content: '# Guide', headingPath: ['Guide'] },
          {
            id: 'old', kind: 'text', role: 'heading', content: '## Old', headingPath: ['Guide', 'Old'],
          },
          { id: 'before', kind: 'text', role: 'paragraph', content: 'Before', headingPath: ['Guide', 'Old'] },
          {
            id: 'sibling', kind: 'table', content: 'sibling', headingPath: ['Guide', 'New'],
            columns: ['Value'], rows: [['second']],
          },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 200, overlapChars: 0, tableRowsPerChunk: 2 })
      .chunkDocument(document, { chunking: { maxChars: 200, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      '# Standalone\n\n| Value |\n| --- |\n| first |',
      '# Guide',
      '# Guide\n## Old\n\nBefore',
      '# Guide\n## New\n\n| Value |\n| --- |\n| second |',
    ])
    expect(result.chunks.map((chunk) => chunk.provenance?.blockIds)).toEqual([
      ['standalone'],
      ['guide'],
      ['guide', 'old', 'before'],
      ['guide', 'sibling'],
    ])
    expect(result.chunks.filter((chunk) => chunk.provenance?.tables).every(
      (chunk) => chunk.provenance?.confidence === 'derived',
    )).toBe(true)
  })

  it('windows body rows beneath parser-provided columns with heading and page provenance', async () => {
    const content = '# Results\n\nBefore\n\n| Name | Score |\n| --- | --- |\n| Ada | 10 |\n| Grace | 11 |\n| Linus | 12 |\n\nAfter'
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'table-windows', content,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1,
        sourceLocation: { type: 'page', pageNumber: 1 }, content,
        blocks: [
          { id: 'heading', kind: 'text', role: 'heading', content: '# Results', headingPath: ['Results'] },
          { id: 'before', kind: 'text', role: 'paragraph', content: 'Before', headingPath: ['Results'] },
          {
            id: 'scores', kind: 'table', headingPath: ['Results'], sourceRange: { start: 19, end: 91 },
            content: '| Name | Score |\n| --- | --- |\n| Ada | 10 |\n| Grace | 11 |\n| Linus | 12 |',
            columns: ['Name', 'Score'], rows: [['Ada', '10'], ['Grace', '11'], ['Linus', '12']],
          },
          { id: 'after', kind: 'text', role: 'paragraph', content: 'After', headingPath: ['Results'] },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 100, overlapChars: 0, tableRowsPerChunk: 2 })
      .chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      '# Results\n\nBefore',
      '# Results\n\n| Name | Score |\n| --- | --- |\n| Ada | 10 |\n| Grace | 11 |',
      '# Results\n\n| Name | Score |\n| --- | --- |\n| Linus | 12 |',
      '# Results\n\nAfter',
    ])
    expect(result.chunks.slice(1, 3).map((chunk) => chunk.provenance)).toEqual([
      {
        partIds: ['page:1'], blockIds: ['heading', 'scores'], pages: [1], tables: ['scores'],
        sourceLocations: [{ type: 'page', pageNumber: 1 }], confidence: 'derived',
      },
      {
        partIds: ['page:1'], blockIds: ['heading', 'scores'], pages: [1], tables: ['scores'],
        sourceLocations: [{ type: 'page', pageNumber: 1 }], confidence: 'derived',
      },
    ])
  })

  it('renders headerless and header-only tables canonically without dropping ragged cells', async () => {
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'canonical-tables', content: '# Data\n\nsource',
      parts: [{
        id: 'page:2', kind: 'page', pageNumber: 2, content: '# Data\n\nsource',
        blocks: [
          { id: 'heading', kind: 'text', role: 'heading', content: '# Data', headingPath: ['Data'] },
          {
            id: 'ragged', kind: 'table', content: 'source', headingPath: ['Data'],
            columns: [],
            rows: [[' Key| ', 'Path\\\r\nLine'], ['Ada'], ['Grace', 'two', 'extra']],
          },
          {
            id: 'header-only', kind: 'table', content: 'source', headingPath: ['Data'],
            columns: ['Only'], rows: [],
          },
          {
            id: 'empty', kind: 'table', content: '', headingPath: ['Data'], columns: [], rows: [],
          },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 200, overlapChars: 0, tableRowsPerChunk: 2 })
      .chunkDocument(document, { chunking: { maxChars: 200, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      '# Data\n\n| Key\\| | Path\\\\<br>Line |\n| Ada |  |',
      '# Data\n\n| Grace | two | extra |',
      '# Data\n\n| Only |\n| --- |',
    ])
    expect(result.chunks.map((chunk) => chunk.provenance?.tables)).toEqual([
      ['ragged'], ['ragged'], ['header-only'],
    ])
  })

  it('shrinks multi-row windows to maxChars but keeps oversized rows and headers whole', async () => {
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'table-limits', content: 'tables',
      parts: [{
        id: 'page:3', kind: 'page', pageNumber: 3, content: 'tables',
        blocks: [
          { id: 'bounded', kind: 'table', content: 'bounded', columns: ['H'], rows: [['1'], ['2'], ['3']] },
          { id: 'wide-row', kind: 'table', content: 'wide row', columns: ['H'], rows: [['x'.repeat(30)]] },
          { id: 'wide-header', kind: 'table', content: 'wide header', columns: ['y'.repeat(30)], rows: [] },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 24, overlapChars: 0, tableRowsPerChunk: 3 })
      .chunkDocument(document, { chunking: { maxChars: 24, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      '| H |\n| --- |\n| 1 |',
      '| H |\n| --- |\n| 2 |',
      '| H |\n| --- |\n| 3 |',
      `| H |\n| --- |\n| ${'x'.repeat(30)} |`,
      `| ${'y'.repeat(30)} |\n| --- |`,
    ])
    expect(result.chunks.slice(0, 3).every((chunk) => chunk.content.length <= 24)).toBe(true)
    expect(result.chunks[3]?.content.length).toBeGreaterThan(24)
    expect(result.chunks[4]?.content.length).toBeGreaterThan(24)
  })

  it('treats the heading prefix as soft overhead when shrinking table windows', async () => {
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'prefixed-table-limits', content: 'tables',
      parts: [{
        id: 'page:4', kind: 'page', pageNumber: 4, content: 'tables',
        blocks: [
          { id: 'heading', kind: 'text', role: 'heading', content: '# Results', headingPath: ['Results'] },
          {
            id: 'bounded', kind: 'table', content: 'bounded', headingPath: ['Results'],
            columns: ['H'], rows: [['1'], ['2'], ['3']],
          },
          {
            id: 'wide-row', kind: 'table', content: 'wide row', headingPath: ['Results'],
            columns: ['H'], rows: [['x'.repeat(30)]],
          },
          {
            id: 'wide-header', kind: 'table', content: 'wide header', headingPath: ['Results'],
            columns: ['y'.repeat(30)], rows: [],
          },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 30, overlapChars: 0, tableRowsPerChunk: 3 })
      .chunkDocument(document, { chunking: { maxChars: 30, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      '# Results\n\n| H |\n| --- |\n| 1 |\n| 2 |',
      '# Results\n\n| H |\n| --- |\n| 3 |',
      `# Results\n\n| H |\n| --- |\n| ${'x'.repeat(30)} |`,
      `# Results\n\n| ${'y'.repeat(30)} |\n| --- |`,
    ])
    const prefix = '# Results\n\n'
    expect(result.chunks.slice(0, 2).every((chunk) => chunk.content.slice(prefix.length).length <= 30)).toBe(true)
    expect(result.chunks.slice(0, 2).every((chunk) => chunk.content.length <= prefix.length + 30)).toBe(true)
    expect(result.chunks[2]?.content.slice(prefix.length).length).toBeGreaterThan(30)
    expect(result.chunks[3]?.content.slice(prefix.length).length).toBeGreaterThan(30)
  })

  it('normalizes invalid table row window sizes without looping or dropping rows', async () => {
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'invalid-table-window', content: 'table',
      parts: [{
        id: 'page:5', kind: 'page', pageNumber: 5, content: 'table',
        blocks: [{
          id: 'rows', kind: 'table', content: 'table', columns: ['H'], rows: [['1'], ['2']],
        }],
      }],
    }

    for (const tableRowsPerChunk of [Number.NEGATIVE_INFINITY, -2, 0, 0.5, 1.9, Infinity, Number.NaN]) {
      const result = await chunker.structured({ maxChars: 100, overlapChars: 0, tableRowsPerChunk })
        .chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

      expect(result.chunks.map((chunk) => chunk.content)).toEqual([
        '| H |\n| --- |\n| 1 |',
        '| H |\n| --- |\n| 2 |',
      ])
    }
  })
})
