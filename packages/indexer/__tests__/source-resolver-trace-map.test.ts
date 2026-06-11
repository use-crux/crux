import { describe, expect, it } from 'vitest'
import { parseTraceMap, resolveOriginalPosition } from '../source-resolver/trace-map'

describe('source resolver trace map lookup', () => {
  it('resolves generated positions to original source positions', () => {
    const traceMap = parseTraceMap(
      JSON.stringify({
        version: 3,
        file: 'bundle.js',
        sources: ['../src/original.ts'],
        sourcesContent: ['export const value = true\n'],
        names: [],
        mappings: 'AAAA',
      }),
    )

    expect(traceMap).not.toBeNull()
    expect(resolveOriginalPosition(traceMap!, 1, 0)).toEqual({
      kind: 'resolved',
      file: '../src/original.ts',
      line: 1,
      column: 0,
      name: undefined,
    })
  })

  it('returns null for invalid source maps', () => {
    expect(parseTraceMap('{')).toBeNull()
  })

  it('returns a typed miss when a mapping has no original source', () => {
    const traceMap = parseTraceMap(
      JSON.stringify({ version: 3, file: 'bundle.js', sources: [], names: [], mappings: '' }),
    )

    expect(traceMap).not.toBeNull()
    expect(resolveOriginalPosition(traceMap!, 1, 0)).toEqual({
      kind: 'unresolved',
      reason: 'original-source-missing',
    })
  })
})
