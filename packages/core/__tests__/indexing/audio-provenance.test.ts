import { describe, expect, it } from 'vitest'
import { chunker } from '../../src/indexing'

describe('audio indexing provenance', () => {
  it('retains explicit seconds locations from transcript parts', async () => {
    const document = {
      namespace: 'kb', sourceId: 'audio:1', content: 'Hello',
      parts: [{
        id: 'audio:segment:1', kind: 'text' as const, content: 'Hello',
        sourceLocation: { type: 'time' as const, unit: 'seconds' as const, start: 0, end: 1.25 },
      }],
    }
    const result = await chunker.structured({ maxChars: 100 }).chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })
    expect(result.chunks[0]?.provenance?.sourceLocations).toEqual([
      { type: 'time', unit: 'seconds', start: 0, end: 1.25 },
    ])
  })
})
