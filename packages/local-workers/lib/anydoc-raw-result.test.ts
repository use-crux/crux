import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { encodeAdmissionResult, preflightAndProjectRawDocument, preflightRawDocument, type RawAsset } from './anydoc-raw-result'

describe('bounded Anydoc raw result', () => {
  it('rejects a five MiB asset before base64 or payload serialization', () => {
    const asset = { id: 1, mediaType: 'image/png', originPart: 'word/media/a.png', data: { byteLength: 5 << 20 } as Buffer } as RawAsset
    const document = { blocks: [], notes: [], assets: [] }
    const base64 = vi.fn(() => { throw new Error('must not encode') })
    const stringify = vi.fn(() => { throw new Error('must not stringify') })
    const result = encodeAdmissionResult({ resultBytes: 8 << 20, sourceBytes: 1 }, { native: document, core: document }, 36, [asset], {}, { base64, stringify })
    expect(result).toEqual({ error: 'invalid-result' })
    expect(base64).not.toHaveBeenCalled()
    expect(stringify).not.toHaveBeenCalled()
  })

  it('walks a wide document with auxiliary memory bounded by depth', () => {
    const document = { blocks: [Array.from({ length: 1_000 }, () => null)], notes: [], assets: [] }
    const result = preflightRawDocument(document, { sourceBytes: 1, expandedBytes: 8 << 20, resultBytes: 8 << 20, assetCount: 128, assetBytes: 64 << 20 })
    expect(result).not.toHaveProperty('error')
    if ('maxTraversalFrames' in result) expect(result.maxTraversalFrames).toBeLessThanOrEqual(3)
  })

  it('rejects projection amplification under request limits before invoking the projector', () => {
    const project = vi.fn(() => ({ native: {}, core: {} }))
    const document = { blocks: [{ kind: 'paragraph', content: [{ kind: 'text', text: 'x'.repeat(1024) }] }], notes: [], assets: [] }
    const result = preflightAndProjectRawDocument(document, { sourceBytes: 1, expandedBytes: 2048, resultBytes: 2048, assetCount: 4, assetBytes: 1024 }, project)
    expect(result).toEqual({ error: 'expanded-too-large' })
    expect(project).not.toHaveBeenCalled()
  })
})
