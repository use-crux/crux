import { embedding } from '@use-crux/core/embedding'
import { indexer, retriever } from '@use-crux/core'
import { inMemoryRecordStore, inMemorySearchStore } from '@use-crux/core/storage'
import { describe, expect, it, vi } from 'vitest'
import { fileSource } from '../src'

describe('multimodal ingest product journey', () => {
  it('derives, indexes, and retrieves timed video evidence without hydration', async () => {
    const video = {
      type: 'data' as const, data: new Uint8Array([1, 2, 3]), mediaType: 'video/mp4',
      ref: { uri: 'asset://demo-video' },
    }
    const transcribe = vi.fn(async () => ({
      text: 'Launch at noon.',
      segments: [{ text: 'Launch at noon.', startSecond: 3, endSecond: 5 }], words: [],
      warnings: [], execution: { kind: 'native' as const, calls: 1 }, raw: null,
    }))
    const [document] = await collect(fileSource(video, {
      namespace: 'kb', sourceId: 'demo-video', media: { transcribe },
      mediaProducers: {
        transcribe: { kind: 'application-operation', operation: 'media.transcribe', identity: 'journey:transcribe', version: '1' },
      },
    }).documents())
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const dense = embedding({ kind: 'dense', name: 'journey', dimensions: 2, maxInputTokens: 100,
      batch: { maxSize: 8 }, embed: async () => [[1, 0]] })
    await indexer({ id: 'journey', namespace: 'kb', records, search, dense }).indexDocuments([document])

    const hits = await retriever({ id: 'journey', namespace: 'kb', records, search, dense }).retrieve('launch')
    expect(hits[0]).toMatchObject({ content: 'Launch at noon.', source: {
      id: 'demo-video', assetRef: { uri: 'asset://demo-video' }, mediaType: 'video/mp4',
      location: { type: 'time', unit: 'seconds', start: 3, end: 5 },
    } })
    expect(transcribe).toHaveBeenCalledTimes(1)

    expect(transcribe).toHaveBeenCalledTimes(1)
  })
})

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of iterable) values.push(value)
  return values
}
