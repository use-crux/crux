/**
 * Release-gate precedence (RFC #173, algorithm H).
 *
 * Release is a conjunction of gates; the single user-visible `bufferedBy` is the
 * highest-precedence ACTIVE gate. Attempt-level gates (constraint, validation
 * retry, adapter) outrank the local per-occurrence gates (boundary, guardrail,
 * serialization), so a local guardrail hold never masks an attempt gate.
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import { highestGate } from '../../src/safety/stream/gates'

describe('release gate precedence', () => {
  it('an attempt gate outranks any local gate', () => {
    expect(highestGate(['guardrail', 'constraint'])).toBe('constraint')
    expect(highestGate(['constraint', 'boundary', 'guardrail'])).toBe('constraint')
    expect(highestGate(['serialization', 'constraint'])).toBe('constraint')
  })

  it('ranks attempt gates validation-retry and adapter above constraint', () => {
    expect(highestGate(['constraint', 'validation-retry'])).toBe('validation-retry')
    expect(highestGate(['adapter', 'validation-retry', 'constraint'])).toBe('adapter')
  })

  it('picks the highest local gate when only local gates are active', () => {
    expect(highestGate(['boundary', 'guardrail', 'serialization'])).toBe('serialization')
    expect(highestGate(['boundary', 'guardrail'])).toBe('guardrail')
    expect(highestGate(['boundary'])).toBe('boundary')
  })

  it('is undefined when nothing is holding', () => {
    expect(highestGate([])).toBeUndefined()
  })
})
