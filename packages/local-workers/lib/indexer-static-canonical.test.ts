import { describe, expect, it } from 'vitest'
import { canonicalStaticJson } from './indexer-static-canonical'

describe('canonicalStaticJson', () => {
  it('treats object key order as serialization noise', () => {
    const first = {
      definitions: [
        {
          id: 'prompt:summary',
          metadata: { schema: { type: 'object', properties: { topic: { type: 'string' } } }, exported: true },
        },
      ],
    }
    const second = {
      definitions: [
        {
          metadata: { exported: true, schema: { properties: { topic: { type: 'string' } }, type: 'object' } },
          id: 'prompt:summary',
        },
      ],
    }

    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second))
    expect(canonicalStaticJson(first)).toBe(canonicalStaticJson(second))
  })

  it('sorts unordered fact arrays by stable identity', () => {
    const first = { definitions: [{ id: 'a' }, { id: 'b' }] }
    const second = { definitions: [{ id: 'b' }, { id: 'a' }] }

    expect(canonicalStaticJson(first)).toBe(canonicalStaticJson(second))
  })

  it('keeps order inside dynamic metadata arrays', () => {
    const first = { definitions: [{ id: 'a', metadata: { tags: ['alpha', 'beta'] } }] }
    const second = { definitions: [{ id: 'a', metadata: { tags: ['beta', 'alpha'] } }] }

    expect(canonicalStaticJson(first)).not.toBe(canonicalStaticJson(second))
  })
})
