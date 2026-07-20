import { describe, expect, it } from 'vitest'
import type OpenAI from 'openai'
import { embedding } from '../src/embedding'

const client = {} as OpenAI

function fingerprint(options: {
  model: string
  dimensions?: number
  version?: string
  batch?: { maxSize?: number; concurrency?: number }
}): string | undefined {
  return embedding(client, {
    name: 'same-name',
    model: options.model,
    dimensions: options.dimensions,
    version: options.version,
    batch: options.batch,
  }).fingerprint
}

describe('OpenAI embedding identity', () => {
  it('merges request semantics with user version and excludes batch policy', () => {
    const base = fingerprint({ model: 'model-a', dimensions: 1536 })

    expect(fingerprint({ model: 'model-b', dimensions: 1536 })).not.toBe(base)
    expect(fingerprint({ model: 'model-a', dimensions: 1536, version: 'revision-2' })).not.toBe(base)
    expect(fingerprint({ model: 'model-b', dimensions: 1536, version: 'pinned' })).not.toBe(
      fingerprint({ model: 'model-a', dimensions: 1536, version: 'pinned' }),
    )
    expect(fingerprint({ model: 'text-embedding-3-small' })).toBe(
      fingerprint({ model: 'text-embedding-3-small', dimensions: 1536 }),
    )
    expect(fingerprint({ model: 'model-a', dimensions: 3072 })).not.toBe(base)
    expect(
      fingerprint({ model: 'model-a', dimensions: 1536, batch: { maxSize: 2, concurrency: 2 } }),
    ).toBe(base)
  })
})
