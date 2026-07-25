/**
 * Occurrence-precise constraint settlement suppression (RFC #173, Phase 15, Fork 1b).
 *
 * "Settlement means this exact occurrence VALUE passed, not merely this constraint
 * ran." The terminal runner suppresses a re-check only when the same occurrence
 * still carries the same canonical subject; a changed subject, a new occurrence, or
 * an unclosed/failed settlement re-evaluates.
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest'
import { boundary } from '../../src/safety'
import { constraint } from '../../src/safety/constraint'
import { runConstraints } from '../../src/safety/constraint/runner'
import { subjectFingerprint } from '../../src/safety/constraint/fingerprint'
import type { ConstraintOccurrenceSettlement } from '../../src/safety/constraint/settlement'
import type { ConstraintContext, ConstraintOutput } from '../../src/safety/constraint/types'

const ctx: ConstraintContext = { promptId: 'p', model: 'm', traceId: undefined, attempt: 0, metadata: {} }
const noRegen = async (): Promise<ConstraintOutput> => {
  throw new Error('should not regenerate')
}

describe('constraint settlement suppression', () => {
  it('does not re-run an unchanged settled scalar-path occurrence', async () => {
    const run = vi.fn((title: string) => (title.length > 0 ? { pass: true } : { pass: false, feedback: 'empty' }))
    const c = constraint({ id: 'title', on: boundary.output.object<{ title: string }>().path('title'), run })
    const output: ConstraintOutput = { text: '{"title":"ok"}', parsed: { title: 'ok' } }
    const settled: ConstraintOccurrenceSettlement[] = [
      { constraint: 'title', occurrence: ['title'], subjectFingerprint: subjectFingerprint('ok'), pass: true, closed: true },
    ]
    const result = await runConstraints([c], output, ctx, noRegen, { settled })
    expect(run).not.toHaveBeenCalled()
    expect(result.audit.allPassed).toBe(true)
  })

  it('re-runs when the settled occurrence subject changed', async () => {
    const run = vi.fn((title: string) => (title.length > 2 ? { pass: true } : { pass: false, feedback: 'short' }))
    const c = constraint({ id: 'title', on: boundary.output.object<{ title: string }>().path('title'), run })
    // Settlement is for the value "ok"; the terminal subject is now "changed".
    const output: ConstraintOutput = { text: '{"title":"changed"}', parsed: { title: 'changed' } }
    const settled: ConstraintOccurrenceSettlement[] = [
      { constraint: 'title', occurrence: ['title'], subjectFingerprint: subjectFingerprint('ok'), pass: true, closed: true },
    ]
    await runConstraints([c], output, ctx, noRegen, { settled })
    expect(run).toHaveBeenCalledWith('changed', expect.anything())
  })

  it('tracks .items() occurrences individually — only the unsettled item re-runs', async () => {
    const run = vi.fn((item: string) => (item.length <= 4 ? { pass: true } : { pass: false, feedback: 'too long' }))
    const c = constraint({ id: 'items', on: boundary.output.object<{ items: string[] }>().path('items').items(), run })
    const output: ConstraintOutput = { text: '{"items":["ok","new"]}', parsed: { items: ['ok', 'new'] } }
    // Only item 0 ("ok") is settled; item 1 ("new") is fresh.
    const settled: ConstraintOccurrenceSettlement[] = [
      { constraint: 'items', occurrence: ['items', 0], subjectFingerprint: subjectFingerprint('ok'), pass: true, closed: true },
    ]
    await runConstraints([c], output, ctx, noRegen, { settled })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('new', expect.anything())
  })

  it('preserves settlement when an unrelated path changed but the subject is unchanged', async () => {
    const run = vi.fn(() => ({ pass: true as const }))
    const c = constraint({ id: 'title', on: boundary.output.object<{ title: string; other: number }>().path('title'), run })
    // `title` is unchanged ("ok"); only the unrelated `other` field differs.
    const output: ConstraintOutput = { text: '{"title":"ok","other":99}', parsed: { title: 'ok', other: 99 } }
    const settled: ConstraintOccurrenceSettlement[] = [
      { constraint: 'title', occurrence: ['title'], subjectFingerprint: subjectFingerprint('ok'), pass: true, closed: true },
    ]
    await runConstraints([c], output, ctx, noRegen, { settled })
    expect(run).not.toHaveBeenCalled()
  })

  it('ignores an unclosed or failed settlement (re-evaluates)', async () => {
    const run = vi.fn(() => ({ pass: true as const }))
    const c = constraint({ id: 'title', on: boundary.output.object<{ title: string }>().path('title'), run })
    const output: ConstraintOutput = { text: '{"title":"ok"}', parsed: { title: 'ok' } }
    const settled: ConstraintOccurrenceSettlement[] = [
      { constraint: 'title', occurrence: ['title'], subjectFingerprint: subjectFingerprint('ok'), pass: true, closed: false },
    ]
    await runConstraints([c], output, ctx, noRegen, { settled })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('runs normally with no settlement evidence', async () => {
    const run = vi.fn(() => ({ pass: true as const }))
    const c = constraint({ id: 'title', on: boundary.output.object<{ title: string }>().path('title'), run })
    const output: ConstraintOutput = { text: '{"title":"ok"}', parsed: { title: 'ok' } }
    await runConstraints([c], output, ctx, noRegen, {})
    expect(run).toHaveBeenCalledTimes(1)
  })
})

// A fingerprint collision silently SUPPRESSES a safety re-check, so the digest must
// discriminate the shapes a canonical `z.input` subject can actually take.
describe('subject fingerprint discrimination', () => {
  // Binding contract: object boundaries observe canonical JSON VALUES, not bytes.
  // Key order and -0/0 are not JSON-significant; array order is.
  it('ignores key order and -0/0, but not array order', () => {
    expect(subjectFingerprint({ a: 1, b: 2 })).toBe(subjectFingerprint({ b: 2, a: 1 }))
    expect(subjectFingerprint({ n: -0 })).toBe(subjectFingerprint({ n: 0 }))
    expect(subjectFingerprint([1, { x: 'y' }])).toBe(subjectFingerprint([1, { x: 'y' }]))
    expect(subjectFingerprint([1, 2])).not.toBe(subjectFingerprint([2, 1]))
  })

  it('separates values that JSON-stringify to confusable shapes', () => {
    const cases: unknown[] = [
      'ok',
      'ok ',
      'ko',
      1,
      '1',
      true,
      'true',
      null,
      'null',
      [],
      {},
      [1, 2],
      [2, 1],
      { a: 1 },
      { a: '1' },
      { a: 1, b: null },
      { a: 1 },
      [[1], [2]],
      [[2], [1]],
      { a: { b: 1 } },
      { 'a.b': 1 },
      { a: [1] },
      { a: 1, extra: [] },
    ]
    const seen = new Map<string, unknown>()
    for (const value of cases) {
      const print = subjectFingerprint(value)
      const prior = seen.get(print)
      // Equal values may repeat (`{ a: 1 }` appears twice); different ones must not collide.
      if (prior !== undefined) expect(JSON.stringify(prior)).toBe(JSON.stringify(value))
      seen.set(print, value)
    }
  })

  it('separates single-character edits in a long subject', () => {
    const base = 'x'.repeat(500)
    expect(subjectFingerprint(base)).not.toBe(subjectFingerprint(`${base.slice(0, 499)}y`))
    expect(subjectFingerprint(base)).not.toBe(subjectFingerprint(`y${base.slice(1)}`))
  })

  it('is a content-free SHA-256 digest', () => {
    // Security evidence: a collision suppresses a constraint re-check, so the digest is
    // cryptographic, and it must never carry the subject itself.
    const print = subjectFingerprint({ secret: 'super-secret-value' })
    expect(print).not.toContain('secret')
    expect(print).toMatch(/^[0-9a-f]{64}$/)
  })
})
