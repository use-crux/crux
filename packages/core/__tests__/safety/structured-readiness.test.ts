/**
 * Incremental structured readiness scanner.
 *
 * For every representative value the canonical tree, ordered events, and errors
 * are identical for a single chunk, per-code-unit chunks, and every two-way
 * split. Valid trees match `JSON.parse`; scalars never emit before a delimiter;
 * invalid input yields stable typed failure codes; and unfinished syntax yields
 * no guessed completion.
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import { createStructuredReadinessScanner } from '../../src/safety/scanner/scanner'
import { StructuredScanError } from '../../src/safety/scanner/errors'
import type { ReadinessEvent } from '../../src/safety/scanner/events'
import type { StructuredScanLimits } from '../../src/safety/scanner/limits'
import {
  itemMatchesSelector,
  pathMatchesSelector,
  selectorSegments,
} from '../../src/safety/scanner/selector'

interface ScanResult {
  readonly value: unknown
  readonly events: readonly ReadinessEvent[]
}

function scan(chunks: readonly string[], limits?: StructuredScanLimits): ScanResult {
  const scanner = createStructuredReadinessScanner(limits)
  const events: ReadinessEvent[] = []
  for (const chunk of chunks) events.push(...scanner.write(chunk))
  const end = scanner.end()
  return { value: end.value, events: [...events, ...end.events] }
}

/** Whole, per-code-unit, and every two-way split of `source`. */
function partitions(source: string): readonly (readonly string[])[] {
  const result: string[][] = [[source], [...source]]
  for (let i = 1; i < source.length; i += 1) result.push([source.slice(0, i), source.slice(i)])
  return result
}

/** Assert every partition yields the identical tree + events, matching JSON.parse. */
function assertInvariant(source: string): ScanResult {
  const base = scan([source])
  expect(base.value).toEqual(JSON.parse(source))
  for (const chunks of partitions(source)) {
    const result = scan(chunks)
    expect(result.value).toEqual(base.value)
    expect(result.events).toEqual(base.events)
  }
  return base
}

/** The scan error code for `source`, or `undefined` if it scans cleanly. */
function errorCode(chunks: readonly string[], limits?: StructuredScanLimits): string | undefined {
  try {
    scan(chunks, limits)
    return undefined
  } catch (error) {
    return error instanceof StructuredScanError ? error.code : 'unexpected'
  }
}

describe('partition invariance vs JSON.parse', () => {
  const sources = [
    '"hello"',
    '-12.5e+3',
    'true',
    'false',
    'null',
    '{}',
    '[]',
    '{"a":1,"b":[2,3],"c":{"d":null}}',
    '[1,-2,3.5,"x",true,false,null]',
    '{"nested":{"deep":{"value":[{"k":"v"}]}}}',
    '  {  "spaced" :  [ 1 , 2 ]  }  ',
    '"esc: \\" \\\\ \\/ \\b \\f \\n \\r \\t"',
    '"unicode \\u00e9 \\uD83D\\uDE00 end"',
  ]

  for (const source of sources) {
    it(`is partition-invariant: ${source.trim().slice(0, 40)}`, () => {
      assertInvariant(source)
    })
  }
})

describe('event readiness semantics', () => {
  it('emits no scalar event before a delimiter; the root number completes at EOF', () => {
    const scanner = createStructuredReadinessScanner()
    expect(scanner.write('1')).toEqual([])
    expect(scanner.write('2')).toEqual([])
    expect(scanner.write('3')).toEqual([])
    const end = scanner.end()
    expect(end.value).toBe(123)
    expect(end.events).toEqual([{ seq: 0, path: [], value: 123 }])
  })

  it('emits values at their canonical paths in document order', () => {
    const { events } = scan(['{"a":1,"b":[true,null]}'])
    expect(events).toEqual([
      { seq: 0, path: ['a'], value: 1 },
      { seq: 1, path: ['b', 0], value: true },
      { seq: 2, path: ['b', 1], value: null },
      { seq: 3, path: ['b'], value: [true, null] },
      { seq: 4, path: [], value: { a: 1, b: [true, null] } },
    ])
  })

  it('emits multiple events within a single chunk', () => {
    const { events } = scan(['[1,2,', '3]'])
    expect(events.map((event) => event.path)).toEqual([[0], [1], [2], []])
  })

  it('true/false/null are partition-invariant when split at every character', () => {
    for (const source of ['{"v":true}', '{"v":false}', '{"v":null}']) {
      assertInvariant(source)
    }
  })

  it('Unicode escapes split after each hex digit reassemble identically', () => {
    assertInvariant('"\\u00e9"')
    assertInvariant('"\\uD83D\\uDE00"')
  })
})

describe('stable typed failures', () => {
  it('rejects a duplicate key, including a differently-escaped equivalent key', () => {
    expect(errorCode(['{"a":1,"a":2}'])).toBe('duplicate-key')
    expect(errorCode(['{"a":1,"\\u0061":2}'])).toBe('duplicate-key')
  })

  it('rejects invalid delimiters and trailing content', () => {
    expect(errorCode(['[1 2]'])).toBe('invalid-json')
    expect(errorCode(['{"a":1,}'])).toBe('invalid-json') // trailing comma
    expect(errorCode(['[1,]'])).toBe('invalid-json')
    expect(errorCode(['{} {}'])).toBe('trailing-content')
    expect(errorCode(['truer'])).toBe('invalid-json')
    expect(errorCode(['01'])).toBe('invalid-json') // leading zero
  })

  it('rejects EOF with incomplete syntax and never guesses a completion', () => {
    expect(errorCode(['{"a":'])).toBe('incomplete')
    expect(errorCode(['[1,2'])).toBe('incomplete')
    expect(errorCode(['"unterminated'])).toBe('incomplete')
    expect(errorCode([''])).toBe('incomplete')
  })

  it('rejects excessive nesting depth', () => {
    const deep = '['.repeat(10) + ']'.repeat(10)
    expect(errorCode([deep], { maxDepth: 4 })).toBe('depth-limit')
    expect(errorCode([deep], { maxDepth: 16 })).toBeUndefined()
  })

  it('rejects output beyond the configured byte limit', () => {
    expect(errorCode(['[1,2,3,4,5]'], { maxBytes: 5 })).toBe('byte-limit')
    expect(errorCode(['[1,2,3,4,5]'], { maxBytes: 100 })).toBeUndefined()
  })

  it('re-throws the stored error on further writes after a failure', () => {
    const scanner = createStructuredReadinessScanner()
    expect(() => scanner.write('{} x')).toThrow(StructuredScanError)
    expect(() => scanner.write('more')).toThrow(StructuredScanError)
  })
})

describe('boundary selector matching', () => {
  it('matches a scalar/string/object path exactly', () => {
    const sel = selectorSegments('account.email')
    const { events } = scan(['{"account":{"email":"a@b.c","id":1}}'])
    const matched = events.filter((event) => pathMatchesSelector(event.path, sel))
    expect(matched).toHaveLength(1)
    expect(matched[0]?.value).toBe('a@b.c')
  })

  it('matches each array item of a selected array path', () => {
    const sel = selectorSegments('items')
    const { events } = scan(['{"items":[{"sku":"a"},{"sku":"b"}]}'])
    const items = events.filter((event) => itemMatchesSelector(event.path, sel))
    expect(items.map((event) => event.value)).toEqual([{ sku: 'a' }, { sku: 'b' }])
    // The whole-array close is the path itself, not an item.
    expect(events.filter((event) => pathMatchesSelector(event.path, sel))).toHaveLength(1)
  })
})

describe('open decoded-string seam', () => {
  it('exposes the safe decoded prefix of a growing string at its path', () => {
    const scanner = createStructuredReadinessScanner()
    scanner.write('{"summary":"Hel')
    expect(scanner.openString()).toEqual({ path: ['summary'], decoded: 'Hel' })
    scanner.write('lo. Wo')
    expect(scanner.openString()).toEqual({ path: ['summary'], decoded: 'Hello. Wo' })
    scanner.write('rld"}')
    // Closed — no open string remains.
    expect(scanner.openString()).toBeUndefined()
  })

  it('never exposes an unfinished escape or a lone high surrogate, across arbitrary splits', () => {
    // A quote escape and an astral emoji (surrogate pair) split at every code unit.
    const source = '{"s":"a\\"b\\uD83D\\uDE00c"}'
    const decodedFull = 'a"b\u{1F600}c'
    for (let cut = 1; cut < source.length; cut += 1) {
      const scanner = createStructuredReadinessScanner()
      scanner.write(source.slice(0, cut))
      const open = scanner.openString()
      if (open) {
        // The exposed prefix is always a valid prefix of the final decoded string
        // with no trailing lone high surrogate.
        expect(decodedFull.startsWith(open.decoded)).toBe(true)
        const last = open.decoded.charCodeAt(open.decoded.length - 1)
        expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
      }
      scanner.write(source.slice(cut))
      expect(scanner.openString()).toBeUndefined()
    }
  })

  it('returns undefined for an object key (keys are not gated)', () => {
    const scanner = createStructuredReadinessScanner()
    scanner.write('{"ke')
    expect(scanner.openString()).toBeUndefined()
  })
})
