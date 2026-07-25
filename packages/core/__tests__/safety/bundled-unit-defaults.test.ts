/**
 * Bundled semantic unit defaults and precedence.
 *
 * Resolution order is explicit refinement > bundled strategy default > adaptive.
 * PII/secrets/injection default to a sentence unit; the classifier defaults to a
 * complete unit; a generic custom guardrail uses the adaptive default (complete on
 * generate, delta on stream). Any explicit refinement overrides the strategy.
 *
 * @module
 */

import { afterEach, describe, expect, it } from 'vitest'
import { boundary, createSafety, guardrail } from '../../src/safety'
import { resolveTextUnit } from '../../src/safety/stream/segment'
import { resetHooks } from '../../src/runtime/runtime'

afterEach(() => resetHooks())

describe('effective unit resolution (algorithm G)', () => {
  it('applies a bundled sentence default when the boundary is unrefined', () => {
    expect(resolveTextUnit(boundary.output.text(), 'sentence', 'stream')).toMatchObject({
      unit: 'sentence',
      source: 'strategy',
    })
  })

  it('applies a bundled complete default (classifier) when unrefined', () => {
    expect(resolveTextUnit(boundary.output.text(), 'complete', 'stream')).toMatchObject({
      unit: 'complete',
      source: 'strategy',
    })
  })

  it('lets an explicit refinement override the bundled default', () => {
    expect(resolveTextUnit(boundary.output.text().deltas(), 'sentence', 'stream')).toMatchObject({
      unit: 'delta',
      source: 'explicit',
    })
  })

  it('uses the adaptive default for a generic custom guardrail', () => {
    expect(resolveTextUnit(boundary.output.text(), undefined, 'stream')).toMatchObject({
      unit: 'delta',
      source: 'adaptive',
    })
    expect(resolveTextUnit(boundary.output.text(), undefined, 'generate')).toMatchObject({
      unit: 'complete',
      source: 'adaptive',
    })
  })
})

describe('bundled strategy carries its semantic default through to execution', () => {
  it('a PII guardrail evaluates whole sentences on a stream by default', async () => {
    const seen: string[] = []
    const pii = guardrail({
      id: 'pii-default',
      on: boundary.output.text(),
      // Wrap the bundled strategy so we can observe the subject it receives.
      run: Object.assign(
        async (subject: string) => {
          seen.push(subject)
          return { action: 'allow' as const }
        },
        { strategy: { kind: 'guardrail.pii', config: {}, defaultUnit: 'sentence' as const } },
      ),
    })
    const stream = createSafety({ promptId: 'p', model: 'm', call: { guardrails: [pii] } }).openStream()

    // Feed a split sentence across deltas: a sentence unit coalesces it before eval.
    await stream.feed('Email a')
    await stream.feed('da@x.io now. ')
    await stream.finish()

    // The guard saw one whole sentence, not per-delta fragments.
    expect(seen).toEqual(['Email ada@x.io now. '])
  })
})
