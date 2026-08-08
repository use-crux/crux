import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { encodeRawResult, preflightRawDocument, type RawAsset } from './anydoc-raw-result'

describe('bounded Anydoc raw result', () => {
  it('rejects a five MiB asset before base64 or payload serialization', () => {
    const asset = { id: 1, mediaType: 'image/png', originPart: 'word/media/a.png', data: { byteLength: 5 << 20 } as Buffer } as RawAsset
    const document = { blocks: [], notes: [], assets: [] }
    const base64 = vi.fn(() => { throw new Error('must not encode') })
    const stringify = vi.fn(() => { throw new Error('must not stringify') })
    const result = encodeRawResult({ resultBytes: 8 << 20, sourceBytes: 1 }, document, 36, [asset], {}, { base64, stringify })
    expect(result).toEqual({ error: 'invalid-result' })
    expect(base64).not.toHaveBeenCalled()
    expect(stringify).not.toHaveBeenCalled()
  })

  it('walks a wide document with auxiliary memory bounded by depth', () => {
    const document = { blocks: [Array.from({ length: 50_000 }, () => null)], notes: [], assets: [] }
    const result = preflightRawDocument(document, { expandedBytes: 8 << 20, resultBytes: 8 << 20, assetCount: 128, assetBytes: 64 << 20 })
    expect(result).not.toHaveProperty('error')
    if ('maxTraversalFrames' in result) expect(result.maxTraversalFrames).toBeLessThanOrEqual(3)
  })
})
