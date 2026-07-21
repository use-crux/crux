import { describe, expect, it } from 'vitest'
import { normalizeRetrieveRequest } from '../../src/retrieval/request'
import type { RetrieveRequest } from '../../src/retrieval'

const image = {
  type: 'data' as const,
  data: new Uint8Array([1]),
  mediaType: 'image/png',
}

describe('retrieve request normalization', () => {
  it('normalizes strings as text queries and bare assets as media inputs', () => {
    expect(normalizeRetrieveRequest('dog', { limit: 3 })).toEqual({ query: 'dog', limit: 3 })
    expect(normalizeRetrieveRequest(image, { limit: 2 })).toEqual({ input: image, limit: 2 })
    expect(normalizeRetrieveRequest({ input: image, threshold: 0.4 })).toEqual({
      input: image,
      threshold: 0.4,
    })
  })

  it('rejects structured requests with both or neither query input', () => {
    const both = { query: 'dog', input: image } as unknown as RetrieveRequest
    const neither = { limit: 2 } as unknown as RetrieveRequest

    expect(() => normalizeRetrieveRequest(both)).toThrow('exactly one of query or input')
    expect(() => normalizeRetrieveRequest(neither)).toThrow('exactly one of query or input')
  })
})
