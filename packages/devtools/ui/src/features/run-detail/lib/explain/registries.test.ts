import { describe, expect, it } from 'vitest'
import {
  cacheMeta,
  coverageMeta,
  evidenceIsDegraded,
  evidenceRank,
  freshnessIsNotable,
  freshnessMeta,
  sourceStatusMeta,
} from './registries'

describe('freshnessMeta', () => {
  it('makes stale-used the one loud, saturated freshness state', () => {
    const m = freshnessMeta('stale-used')
    expect(m.tone).toBe('warn')
    expect(m.solid).toBe(true)
  })

  it('reads fresh as a calm ok state', () => {
    expect(freshnessMeta('fresh').tone).toBe('ok')
  })

  it('hides not-applicable rather than tinting it', () => {
    expect(freshnessMeta('not-applicable').hidden).toBe(true)
  })

  it('falls back to unknown for unrecognised states', () => {
    expect(freshnessMeta('bogus').label).toBe(freshnessMeta('unknown').label)
  })
})

describe('cacheMeta — calm and separate from freshness', () => {
  it('reads a hit in the crux accent (good news, not severity)', () => {
    expect(cacheMeta('hit').tone).toBe('crux')
    expect(cacheMeta('hit').solid).toBe(true)
  })

  it('reads a miss as muted', () => {
    expect(cacheMeta('miss').tone).toBe('muted')
    expect(cacheMeta('miss').solid).toBe(false)
  })
})

describe('coverageMeta — a nudge, never severity', () => {
  it('covered reads ok and solid', () => {
    expect(coverageMeta('covered').tone).toBe('ok')
    expect(coverageMeta('covered').solid).toBe(true)
  })

  it('not-covered reads as a hollow warn nudge', () => {
    expect(coverageMeta('none').tone).toBe('warn')
    expect(coverageMeta('none').solid).toBe(false)
  })
})

describe('evidence ladder', () => {
  it('ranks declared strongest and missing weakest', () => {
    expect(evidenceRank('declared')).toBeGreaterThan(evidenceRank('observed'))
    expect(evidenceRank('observed')).toBeGreaterThan(evidenceRank('inferred'))
    expect(evidenceRank('inferred')).toBeGreaterThan(evidenceRank('missing'))
  })

  it('treats inferred and missing as degraded (shown by exception)', () => {
    expect(evidenceIsDegraded('inferred')).toBe(true)
    expect(evidenceIsDegraded('missing')).toBe(true)
    expect(evidenceIsDegraded('declared')).toBe(false)
    expect(evidenceIsDegraded('observed')).toBe(false)
  })
})

describe('sourceStatusMeta', () => {
  it('tints used ok and dropped danger', () => {
    expect(sourceStatusMeta('used').tone).toBe('ok')
    expect(sourceStatusMeta('dropped').tone).toBe('danger')
  })
})

describe('freshnessIsNotable — decorate the exception', () => {
  it('is true only for risk/unknown states a debugger should see', () => {
    expect(freshnessIsNotable('stale-used')).toBe(true)
    expect(freshnessIsNotable('stale-rejected')).toBe(true)
    expect(freshnessIsNotable('unknown')).toBe(true)
    expect(freshnessIsNotable('fresh')).toBe(false)
    expect(freshnessIsNotable('not-applicable')).toBe(false)
  })
})
