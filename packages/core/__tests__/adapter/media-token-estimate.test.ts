import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTokenizer } from '../../src/shared/tokenizer'
import { estimateMessageTokens, safeMediaDescriptor } from '../../src/adapter/native-chat/media-tokens'

afterEach(() => setTokenizer((text) => Math.ceil(text.length / 4)))

describe('private media token estimation', () => {
  it('uses one deterministic fallback per media part without reading bytes', () => {
    setTokenizer((text) => text.length)
    const descriptor = safeMediaDescriptor({
      kind: 'image',
      mediaType: 'image/png',
      size: 3,
      sourceCategory: 'bytes',
    })

    const estimate = estimateMessageTokens(
      [{ role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', source: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }] }],
      { provider: 'openai', model: 'gpt-4o' },
    )

    expect(estimate.mediaTokens).toBe(4096 + descriptor.length)
    expect(estimate.usedFallback).toBe(true)
  })

  it('passes only known scalar facts to a provider hook', () => {
    const estimateTokens = vi.fn(() => 123)
    const estimate = estimateMessageTokens(
      [{
        role: 'user',
        content: [{
          type: 'image',
          source: {
            type: 'data',
            data: new Uint8Array([1, 2, 3]),
            mediaType: 'image/png',
            width: 640,
            height: 480,
          },
        }],
      }],
      { provider: 'anthropic', model: 'claude-sonnet-4', estimateTokens },
    )

    expect(estimate.mediaTokens).toBe(123)
    expect(estimateTokens).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      media: {
        kind: 'image',
        mediaType: 'image/png',
        size: 3,
        width: 640,
        height: 480,
        sourceCategory: 'data',
      },
    })
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid hook output %s', (value) => {
    expect(() => estimateMessageTokens(
      [{ role: 'user', content: [{ type: 'image', source: new Uint8Array([1]) }] }],
      { provider: 'test', model: 'bad-model', estimateTokens: () => value },
    )).toThrow('media estimateTokens hook')
  })

  it('saturates aggregate estimates at Number.MAX_SAFE_INTEGER', () => {
    const estimate = estimateMessageTokens(
      [{ role: 'user', content: [
        { type: 'image', source: new Uint8Array([1]) },
        { type: 'image', source: new Uint8Array([2]) },
      ] }],
      { model: 'huge', estimateTokens: () => Number.MAX_SAFE_INTEGER },
    )

    expect(estimate.totalTokens).toBe(Number.MAX_SAFE_INTEGER)
  })
})
