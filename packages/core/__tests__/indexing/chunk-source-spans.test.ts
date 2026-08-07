import { describe, expect, it } from 'vitest'
import { chunker } from '../../src/indexing'
import type { CruxChunk, CruxDocument } from '../../src/indexing'

describe('chunk source spans', () => {
  it('preserves original whitespace in exact text chunk slices', async () => {
    const document: CruxDocument = {
      namespace: 'kb',
      sourceId: 'whitespace',
      content: '  Alpha one.\n\nBeta two.  ',
      parts: [
        { id: 'body', kind: 'text', content: '  Alpha one.\n\nBeta two.  ' },
      ],
    }

    const result = await chunker.structured({ maxChars: 14, overlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 14, overlapChars: 0 } })

    expect(result.chunks.map((chunk) => chunk.content)).toEqual([
      '  Alpha one.',
      'Beta two.  ',
    ])
    result.chunks.forEach((chunk) => expectExactSlice(document, chunk))
  })

  it('moves overlap starts backward in original text coordinates', async () => {
    const document: CruxDocument = {
      namespace: 'kb',
      sourceId: 'overlap',
      content: 'First sentence. Second sentence. Third sentence.',
      parts: [
        { id: 'body', kind: 'text', content: 'First sentence. Second sentence. Third sentence.' },
      ],
    }

    const result = await chunker.structured({ maxChars: 25, overlapChars: 7 })
      .chunkDocument(document, { chunking: { maxChars: 25, overlapChars: 7 } })

    expect(result.chunks.length).toBeGreaterThan(1)
    result.chunks.forEach((chunk) => expectExactSlice(document, chunk))
    const spans = result.chunks.map((chunk) => chunk.provenance?.sourceSpans?.[0])
    expect(spans[1]?.start).toBe((spans[0]?.end ?? 0) - 7)
  })

  it('omits exact character spans for ambiguous repeated part content', async () => {
    const document: CruxDocument = {
      namespace: 'kb',
      sourceId: 'ambiguous',
      content: 'Repeat\n\nRepeat',
      parts: [
        { id: 'first', kind: 'text', content: 'Repeat' },
        { id: 'second', kind: 'text', content: 'Repeat' },
      ],
    }

    const result = await chunker.structured({ maxChars: 20, overlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 20, overlapChars: 0 } })

    expect(result.chunks).toHaveLength(2)
    for (const chunk of result.chunks) {
      expect(chunk.provenance?.sourceSpans).toBeUndefined()
      expect(chunk.provenance?.confidence).toBe('derived')
    }
  })

  it('resolves repeated block text through exact page-relative ranges', async () => {
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'repeated-blocks', content: 'Repeat\n\nRepeat',
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content: 'Repeat\n\nRepeat',
        blocks: [
          { id: 'first', kind: 'text', role: 'paragraph', content: 'Repeat', sourceRange: { start: 0, end: 6 } },
          { id: 'second', kind: 'text', role: 'paragraph', content: 'Repeat', sourceRange: { start: 8, end: 14 } },
        ],
      }],
    }

    const result = await chunker.structured({ maxChars: 6, overlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 6, overlapChars: 0 } })

    expect(result.chunks).toHaveLength(2)
    result.chunks.forEach((chunk) => expectExactSlice(document, chunk))
    expect(result.chunks.map((chunk) => chunk.provenance?.blockIds)).toEqual([['first'], ['second']])
  })

  it('keeps proven oversized block slices exact but rejects repeated complete pages', async () => {
    const splitDocument: CruxDocument = {
      namespace: 'kb', sourceId: 'split-block', content: 'One sentence. Two sentence.',
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content: 'One sentence. Two sentence.',
        blocks: [{
          id: 'body', kind: 'text', role: 'paragraph', content: 'One sentence. Two sentence.',
          sourceRange: { start: 0, end: 27 },
        }],
      }],
    }
    const split = await chunker.structured({ maxChars: 14, overlapChars: 0 })
      .chunkDocument(splitDocument, { chunking: { maxChars: 14, overlapChars: 0 } })
    split.chunks.forEach((chunk) => expectExactSlice(splitDocument, chunk))

    const repeatedPages: CruxDocument = {
      namespace: 'kb', sourceId: 'repeated-pages', content: 'Same\n\nSame',
      parts: [1, 2].map((pageNumber) => ({
        id: `page:${pageNumber}`, kind: 'page' as const, pageNumber, content: 'Same',
        blocks: [{
          id: `page:${pageNumber}/block:0`, kind: 'text' as const, role: 'paragraph' as const,
          content: 'Same', sourceRange: { start: 0, end: 4 },
        }],
      })),
    }
    const repeated = await chunker.structured({ maxChars: 10, overlapChars: 0 })
      .chunkDocument(repeatedPages, { chunking: { maxChars: 10, overlapChars: 0 } })
    repeated.chunks.forEach((chunk) => {
      expect(chunk.provenance?.confidence).toBe('derived')
      expect(chunk.provenance?.sourceSpans).toBeUndefined()
    })
  })

  it('does not guess spans for packed blocks or invalid block ranges', async () => {
    const content = 'Alpha\n\nBeta'
    const document: CruxDocument = {
      namespace: 'kb', sourceId: 'derived-blocks', content,
      parts: [{
        id: 'page:1', kind: 'page', pageNumber: 1, content,
        blocks: [
          { id: 'alpha', kind: 'text', role: 'paragraph', content: 'Alpha', sourceRange: { start: 0, end: 5 } },
          { id: 'beta', kind: 'text', role: 'paragraph', content: 'Beta', sourceRange: { start: 0, end: 4 } },
        ],
      }],
    }

    const packed = await chunker.structured({ maxChars: 20, overlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 20, overlapChars: 0 } })
    expect(packed.chunks).toHaveLength(1)
    expect(packed.chunks[0]?.provenance).toMatchObject({
      blockIds: ['alpha', 'beta'], confidence: 'derived',
    })
    expect(packed.chunks[0]?.provenance?.sourceSpans).toBeUndefined()

    const separated = await chunker.structured({ maxChars: 5, overlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 5, overlapChars: 0 } })
    expect(separated.chunks[0]?.provenance?.confidence).toBe('exact')
    expect(separated.chunks[1]?.provenance?.confidence).toBe('derived')
    expect(separated.chunks[1]?.provenance?.sourceSpans).toBeUndefined()
  })

  it('does not claim exact character spans for rendered table windows', async () => {
    const document: CruxDocument = {
      namespace: 'kb',
      sourceId: 'table',
      content: 'Name,Score\nAda,10\nGrace,11',
      parts: [{
        id: 'scores',
        kind: 'table',
        content: 'Name,Score\nAda,10\nGrace,11',
        columns: ['Name', 'Score'],
        rows: [
          ['Name', 'Score'],
          ['Ada', '10'],
          ['Grace', '11'],
        ],
        pageNumber: 3,
      }],
    }

    const result = await chunker.structured({ tableRowsPerChunk: 1 })
      .chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.chunks).toHaveLength(2)
    for (const chunk of result.chunks) {
      expect(chunk.provenance).toMatchObject({
        partIds: ['scores'],
        pages: [3],
        tables: ['scores'],
        confidence: 'derived',
      })
      expect(chunk.provenance?.sourceSpans).toBeUndefined()
    }
  })

  it('keeps parent-child text child spans aligned to each child slice', async () => {
    const document: CruxDocument = {
      namespace: 'kb',
      sourceId: 'parent-child',
      content: 'First sentence. Second sentence. Third sentence.',
      parts: [
        { id: 'body', kind: 'text', content: 'First sentence. Second sentence. Third sentence.' },
      ],
    }

    const result = await chunker.parentChild({
      parentMaxChars: 100,
      childMaxChars: 25,
      childOverlapChars: 7,
    }).chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.parents).toHaveLength(1)
    expect(result.chunks.length).toBeGreaterThan(1)
    result.chunks.forEach((chunk) => expectExactSlice(document, chunk))
  })

  it('keeps semantic boundary content aligned to exact source spans', async () => {
    const document: CruxDocument = {
      namespace: 'kb',
      sourceId: 'semantic',
      content: '  Alpha source.  ',
    }

    const result = await chunker.semantic({
      strategy: 'custom',
      maxChars: 100,
      segment: () => [{ start: 0, end: document.content?.length ?? 0 }],
    }).chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.chunks).toHaveLength(1)
    expectExactSlice(document, result.chunks[0]!)
  })
})

function expectExactSlice(document: CruxDocument, chunk: CruxChunk): void {
  expect(chunk.provenance?.confidence).toBe('exact')
  expect(chunk.provenance?.sourceSpans).toHaveLength(1)
  const [span] = chunk.provenance?.sourceSpans ?? []
  expect(document.content?.slice(span?.start, span?.end)).toBe(chunk.content)
}
