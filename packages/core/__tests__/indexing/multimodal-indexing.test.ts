import { describe, expect, it, vi } from 'vitest'
import type { CruxDocument } from '../../src/indexing'
import { chunker, indexer, indexingPipeline } from '../../src/indexing'
import { inMemoryRecordStore } from '../../src/storage'

describe('multimodal indexing', () => {
  it('accepts media-only documents and emits one unsplit chunk per media part', async () => {
    const document = {
      namespace: 'products',
      sourceId: 'catalog-video',
      parts: [
        {
          id: 'segment:1',
          kind: 'media',
          asset: {
            type: 'data',
            data: new Uint8Array([1, 2, 3]),
            mediaType: 'video/mp4',
          },
          caption: 'A dog running through a field',
          sourceLocation: { type: 'time', unit: 'seconds', start: 12, end: 18 },
        },
      ],
    } satisfies CruxDocument
    const docs = indexer({
      id: 'products',
      namespace: 'products',
      records: inMemoryRecordStore(),
      pipeline: indexingPipeline({
        chunker: chunker.structured({ maxChars: 4, overlapChars: 1 }),
      }),
    })

    const chunks = await docs.chunk([document])

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      namespace: 'products',
      sourceId: 'catalog-video',
      ordinal: 0,
      content: 'A dog running through a field',
      source: {
        mediaType: 'video/mp4',
        location: { type: 'time', unit: 'seconds', start: 12, end: 18 },
      },
      provenance: {
        partIds: ['segment:1'],
        sourceLocations: [{ type: 'time', unit: 'seconds', start: 12, end: 18 }],
      },
      media: {
        modality: 'video',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(chunks[0].media?.asset).toMatchObject({
      type: 'data',
      mediaType: 'video/mp4',
      sha256: chunks[0].media?.sha256,
    })
  })

  it('expands the document asset shorthand while retaining authored text', async () => {
    const docs = indexer({
      id: 'products',
      namespace: 'products',
      records: inMemoryRecordStore(),
    })

    const chunks = await docs.chunk([
      {
        namespace: 'products',
        sourceId: 'rex',
        content: 'Rex is available for adoption.',
        asset: {
          type: 'data',
          data: new Uint8Array([4, 5, 6]),
          mediaType: 'image/png',
        },
      },
    ])

    expect(chunks).toHaveLength(2)
    expect(chunks.map((chunk) => chunk.content)).toEqual([
      'Rex is available for adoption.',
      '',
    ])
    expect(chunks[1].media?.modality).toBe('image')
  })

  it('rejects a document without content, parts, or an asset', async () => {
    const docs = indexer({
      id: 'products',
      namespace: 'products',
      records: inMemoryRecordStore(),
    })

    await expect(
      docs.chunk([{ namespace: 'products', sourceId: 'empty' }]),
    ).rejects.toThrow('must provide content, parts, or asset')
  })

  it.each([
    ['parent-child', chunker.parentChild({ parentMaxChars: 4, childMaxChars: 2, childOverlapChars: 0 })],
    ['semantic', chunker.semantic({
      strategy: 'custom',
      segment: vi.fn(() => {
        throw new Error('media-only documents must not invoke text segmentation')
      }),
    })],
  ])('keeps media unsplit under the %s chunker', async (_name, mediaChunker) => {
    const docs = indexer({
      id: 'media', namespace: 'kb', records: inMemoryRecordStore(),
      pipeline: indexingPipeline({ chunker: mediaChunker }),
    })

    const chunks = await docs.chunk([{
      namespace: 'kb', sourceId: 'photo',
      asset: { type: 'data', data: new Uint8Array([1, 2]), mediaType: 'image/png' },
    }])

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ content: '', media: { modality: 'image' } })
    expect(chunks[0].parent?.parentId).toBeUndefined()
  })
})
