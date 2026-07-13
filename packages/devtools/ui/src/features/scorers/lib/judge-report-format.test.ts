import { describe, expect, it } from 'vitest'
import { confusionGrid, formatKappa, formatRate } from '@/shared/quality/judge-report-format'

describe('confusionGrid', () => {
  it('lays out TP, FP, FN, TN in reading order with agreement flags', () => {
    const grid = confusionGrid({ tp: 30, fp: 3, fn: 4, tn: 5 })
    expect(grid.map((c) => c.key)).toEqual(['tp', 'fp', 'fn', 'tn'])
    expect(grid.map((c) => c.count)).toEqual([30, 3, 4, 5])
    expect(grid.map((c) => c.agree)).toEqual([true, false, false, true])
  })
})

describe('formatRate', () => {
  it('renders a whole percentage', () => {
    expect(formatRate(0.833)).toBe('83%')
    expect(formatRate(1)).toBe('100%')
  })
  it('renders an em dash for an undefined rate', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatRate(undefined)).toBe('—')
  })
})

describe('formatKappa', () => {
  it('renders two decimals or an em dash', () => {
    expect(formatKappa(0.61)).toBe('0.61')
    expect(formatKappa(null)).toBe('—')
  })
})
