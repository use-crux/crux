/**
 * The resolved stream commit plan (RFC #173, Phase 15).
 *
 * The adapter keys its decision to route a stream through the shared attempt
 * coordinator on this plan instead of re-inspecting raw constraint config. An
 * enforce `assert` is the only Safety-owned commit gate today; a `suggest`
 * (report-only) constraint and guardrails never commit.
 *
 * @module
 */

import { afterEach, describe, expect, it } from 'vitest'
import { boundary, createSafety } from '../../src/safety'
import { guardrail } from '../../src/safety/guardrail'
import { constraint } from '../../src/safety/constraint'
import { safetySessionStreamCommitPlan } from '../../src/safety/session'
import { resetHooks } from '../../src/runtime/runtime'

afterEach(() => {
  resetHooks()
})

describe('stream commit plan', () => {
  it('reports an assert gate for an enforce assert constraint', () => {
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: {
        constraints: [
          constraint({
            id: 'nonempty',
            on: boundary.output.text(),
            run: (text: string) => (text.length > 0 ? { pass: true } : { pass: false, feedback: 'empty' }),
          }),
        ],
      },
    })
    expect(safetySessionStreamCommitPlan(safety).hasAssertGate).toBe(true)
  })

  it('reports no assert gate for a suggest (report-only) constraint', () => {
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: {
        constraints: [
          constraint({
            id: 'hint',
            severity: 'suggest',
            on: boundary.output.text(),
            run: (text: string) => (text.length > 0 ? { pass: true } : { pass: false, feedback: 'empty' }),
          }),
        ],
      },
    })
    expect(safetySessionStreamCommitPlan(safety).hasAssertGate).toBe(false)
  })

  it('reports no assert gate for guardrails-only or empty safety', () => {
    const guarded = createSafety({
      promptId: 'p',
      model: 'm',
      call: {
        guardrails: [
          guardrail({
            id: 'g',
            on: boundary.output.text(),
            run: () => ({ action: 'allow' as const }),
          }),
        ],
      },
    })
    expect(safetySessionStreamCommitPlan(guarded).hasAssertGate).toBe(false)
    expect(safetySessionStreamCommitPlan(createSafety({ promptId: 'p', model: 'm' })).hasAssertGate).toBe(false)
  })
})
