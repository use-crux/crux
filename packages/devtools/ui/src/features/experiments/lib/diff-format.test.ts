import { describe, expect, it } from 'vitest'
import { comparePickerOptions, driftLabel, formatSignedDelta } from './diff-format'

describe('formatSignedDelta', () => {
  it('prefixes a plus for gains and keeps the native minus for losses', () => {
    expect(formatSignedDelta(0.07)).toBe('+0.07')
    expect(formatSignedDelta(-0.07)).toBe('-0.07')
    expect(formatSignedDelta(0)).toBe('0.00')
  })
})

describe('driftLabel', () => {
  it('joins drifted identity components', () => {
    expect(driftLabel(['dataset', 'scorers'])).toBe('dataset, scorers')
    expect(driftLabel([])).toBe('')
  })
})

describe('comparePickerOptions', () => {
  it('excludes the current experiment and sorts newest first', () => {
    const opts = comparePickerOptions(
      [
        { experimentId: 'a', startedAt: '2026-06-10T00:00:00Z' },
        { experimentId: 'b', startedAt: '2026-06-12T00:00:00Z' },
        { experimentId: 'c', startedAt: '2026-06-11T00:00:00Z' },
      ],
      'a',
    )
    expect(opts.map((o) => o.experimentId)).toEqual(['b', 'c'])
  })
})
