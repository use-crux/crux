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
