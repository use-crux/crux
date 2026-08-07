import { describe, expect, it } from 'vitest'
import { chunker } from '../../src/indexing'
import type { CruxDocument, CruxIngestPageBlock } from '../../src/indexing'

describe('page block contract', () => {
  it('preserves provider-neutral page block IDs through coarse and merged provenance', async () => {
    const blocks = [
      {
        id: 'page:1/block:1',
        kind: 'text',
        role: 'heading',
        content: 'Overview',
        headingPath: ['Overview'],
        sourceRange: { start: 0, end: 8 },
      },
      {
        id: 'page:1/block:0',
        kind: 'table',
        content: 'Name | Score',
        columns: ['Name', 'Score'],
        rows: [['Ada', '10']],
        headingPath: ['Overview'],
        sourceRange: { start: 10, end: 22 },
      },
      {
        id: 'page:1/block:1',
        kind: 'text',
        role: 'paragraph',
        content: 'Summary',
      },
    ] as const satisfies readonly CruxIngestPageBlock[]
    const document: CruxDocument = {
      namespace: 'kb',
      sourceId: 'authored-page',
      content: 'Overview\n\nName | Score\n\nSummary',
      parts: [{
        id: 'page:1',
        kind: 'page',
        content: 'Overview\n\nName | Score\n\nSummary',
        pageNumber: 1,
        sourceLocation: { type: 'page', pageNumber: 1 },
        blocks,
      }],
    }

    const result = await chunker.parentChild({
      parentMaxChars: 100,
      childMaxChars: 100,
      childOverlapChars: 0,
    }).chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.chunks[0]?.provenance).toMatchObject({
      partIds: ['page:1'],
      blockIds: ['page:1/block:1', 'page:1/block:0'],
      pages: [1],
      sourceLocations: [{ type: 'page', pageNumber: 1 }],
    })
    expect(result.parents?.[0]?.provenance?.blockIds).toEqual([
      'page:1/block:1',
      'page:1/block:0',
    ])
  })

  it('keeps ordinary parts and blockless pages compatible without block provenance', async () => {
    const document: CruxDocument = {
      namespace: 'kb',
      sourceId: 'ordinary-parts',
      content: 'Introduction\n\nPage content',
      parts: [
        {
          id: 'intro',
          kind: 'text',
          content: 'Introduction',
        },
        {
          id: 'page:1',
          kind: 'page',
          content: 'Page content',
          pageNumber: 1,
          sourceLocation: { type: 'page', pageNumber: 1 },
        },
      ],
    }

    const result = await chunker.parentChild({
      parentMaxChars: 100,
      childMaxChars: 100,
      childOverlapChars: 0,
    }).chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    for (const chunk of result.chunks) {
      expect(chunk.provenance).not.toHaveProperty('blockIds')
    }
    for (const parent of result.parents ?? []) {
      expect(parent.provenance).not.toHaveProperty('blockIds')
    }
  })
})
