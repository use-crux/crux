import { describe, expect, it } from 'vitest'
import { deepTabToGenTab, resolveOpenTab } from './tabs'

describe('deepTabToGenTab', () => {
  it('maps report deep-tab labels to lowercase generation tab ids', () => {
    expect(deepTabToGenTab('Output')).toBe('output')
    expect(deepTabToGenTab('Context')).toBe('context')
    expect(deepTabToGenTab('Routing')).toBe('routing')
    expect(deepTabToGenTab('Guardrail')).toBe('guardrail')
    expect(deepTabToGenTab('Security')).toBe('security')
    expect(deepTabToGenTab('Constraint')).toBe('constraint')
    expect(deepTabToGenTab('Cache')).toBe('cache')
    expect(deepTabToGenTab('Compaction')).toBe('compaction')
  })

  it('lowercases unknown labels rather than dropping them', () => {
    expect(deepTabToGenTab('Memory')).toBe('memory')
  })
})

describe('resolveOpenTab', () => {
  const available = ['explain', 'output', 'context', 'routing', 'cache'] as const

  it('returns the mapped tab when it is available on this turn', () => {
    expect(resolveOpenTab('Routing', available)).toBe('routing')
    expect(resolveOpenTab('Context', available)).toBe('context')
  })

  it('returns null when the target deep tab is not folded onto this turn', () => {
    // Guardrail has no folded report here, so there is nowhere to jump.
    expect(resolveOpenTab('Guardrail', available)).toBeNull()
  })

  it('returns null when there is no target', () => {
    expect(resolveOpenTab(undefined, available)).toBeNull()
  })
})
