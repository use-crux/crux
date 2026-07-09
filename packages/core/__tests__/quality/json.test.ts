import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../quality/internal/json'

describe('quality canonicalJson', () => {
  it('serializes Date values with a stable explicit tag', () => {
    expect(canonicalJson({ at: new Date('2026-07-08T00:00:00.000Z') })).toBe('{"at":{"$t":"date","v":"2026-07-08T00:00:00.000Z"}}')
  })

  it('serializes Map and Set values with sorted tagged entries', () => {
    expect(
      canonicalJson({
        map: new Map<unknown, unknown>([
          ['b', 2],
          ['a', 1],
        ]),
        set: new Set(['z', 'a']),
      }),
    ).toBe('{"map":{"$t":"map","v":[["a",1],["b",2]]},"set":{"$t":"set","v":["a","z"]}}')
  })

  it('serializes BigInt values with a stable explicit tag', () => {
    expect(canonicalJson({ id: 42n })).toBe('{"id":{"$t":"bigint","v":"42"}}')
  })

  it('rejects function values loudly', () => {
    expect(() => canonicalJson({ fn: () => undefined })).toThrow(/functions/)
  })
})
