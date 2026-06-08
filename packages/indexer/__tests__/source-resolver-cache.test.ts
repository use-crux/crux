import { describe, expect, it } from 'vitest'
import { locationCacheKey, putLocationCache } from '../source-resolver/cache'
import type { ResolvedLocation } from '../source-resolver/types'

function resolved(file: string): ResolvedLocation {
  return { file, line: 1, column: 0, resolved: true }
}

describe('source resolver cache policy', () => {
  it('builds stable location cache keys', () => {
    expect(locationCacheKey('/bundle.js', 2, undefined)).toBe('/bundle.js:2:0')
    expect(locationCacheKey('/bundle.js', 2, 4)).toBe('/bundle.js:2:4')
  })

  it('returns a new cache with oldest-entry eviction', () => {
    const first = putLocationCache(new Map(), 'a.js:1:0', resolved('a.js'), 2)
    const second = putLocationCache(first, 'b.js:1:0', resolved('b.js'), 2)
    const third = putLocationCache(second, 'c.js:1:0', resolved('c.js'), 2)

    expect(first.has('a.js:1:0')).toBe(true)
    expect(third.has('a.js:1:0')).toBe(false)
    expect(third.has('b.js:1:0')).toBe(true)
    expect(third.has('c.js:1:0')).toBe(true)
  })
})
