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

  it('projects safe source facts and collapses adjacent ordered time ranges', async () => {
    const document = {
      namespace: 'kb', sourceId: 'audio:1', content: 'Hello world',
      source: {
        url: 'https://example.com/meeting.wav',
        assetRef: { uri: 'asset://meeting' },
        mediaType: 'audio/wav',
      },
      parts: [
        { id: 'a', kind: 'text' as const, content: 'Hello', sourceLocation: { type: 'time' as const, unit: 'seconds' as const, start: 0, end: 0.5 } },
        { id: 'b', kind: 'text' as const, content: 'world', sourceLocation: { type: 'time' as const, unit: 'seconds' as const, start: 0.5, end: 1 } },
      ],
    }

    const result = await chunker.parentChild({ parentMaxChars: 100, childMaxChars: 100, childOverlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })

    expect(result.chunks[0]?.source).toEqual({
      url: 'https://example.com/meeting.wav',
      assetRef: { uri: 'asset://meeting' },
      mediaType: 'audio/wav',
      location: { type: 'time', unit: 'seconds', start: 0, end: 1 },
    })
    expect(result.parents?.[0]?.source).toEqual(result.chunks[0]?.source)
  })

  it('omits mixed or ambiguous locations instead of guessing', async () => {
    const document = {
      namespace: 'kb', sourceId: 'mixed', content: 'Page audio',
      source: { url: 'https://example.com/mixed.txt' },
      parts: [
        { id: 'page', kind: 'page' as const, content: 'Page', pageNumber: 1, sourceLocation: { type: 'page' as const, pageNumber: 1 } },
        { id: 'audio', kind: 'text' as const, content: 'audio', sourceLocation: { type: 'time' as const, unit: 'seconds' as const, start: 0, end: 1 } },
      ],
    }
    const result = await chunker.parentChild({ parentMaxChars: 100, childMaxChars: 100, childOverlapChars: 0 })
      .chunkDocument(document, { chunking: { maxChars: 100, overlapChars: 0 } })
    expect(result.parents?.map((parent) => parent.content)).toEqual(['Page\n\naudio'])
    expect(result.parents?.[0]?.provenance?.sourceLocations).toEqual([
      { type: 'page', pageNumber: 1 },
      { type: 'time', unit: 'seconds', start: 0, end: 1 },
    ])
    expect(result.parents?.[0]?.source).toEqual({ url: 'https://example.com/mixed.txt' })
    expect(result.chunks[0]?.source?.location).toBeUndefined()
  })
})
