/**
 * Tests for `adapter/policy/safety` — shared constraint/guardrail merge
 * policy used by both `adapter()` and `executorAdapter()`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { updateRuntime, resetRuntime } from '../../../runtime'
import {
  mergeConstraints,
  mergeGuardrails,
  formatConstraintFeedback,
  emitGuardrailHooks,
} from '../../../adapter/policy/safety'
import type { Constraint } from '../../../safety/constraint/types'
import type { Guardrail, GuardrailAudit } from '../../../safety/guardrail/types'

afterEach(() => {
  resetRuntime()
})

function constraint(name: string, marker: string): Constraint {
  return { name, description: marker, check: () => ({ pass: true }) } as unknown as Constraint
}

function guardrail(name: string, marker: string): Guardrail {
  return { name, phase: 'input', description: marker, run: (content: string) => ({ action: 'pass', content }) } as unknown as Guardrail
}

describe('mergeConstraints', () => {
  it('dedupes by name with per-call > per-prompt > global precedence', () => {
    const merged = mergeConstraints(
      [constraint('tone', 'call')],
      [constraint('tone', 'prompt'), constraint('length', 'prompt')],
      [constraint('tone', 'global'), constraint('safety', 'global')],
    )

    expect(merged.map((c) => c.name).sort()).toEqual(['length', 'safety', 'tone'])
    expect(merged.find((c) => c.name === 'tone')?.description).toBe('call')
  })

  it('handles all scopes being undefined', () => {
    expect(mergeConstraints(undefined, undefined, undefined)).toEqual([])
  })
})

describe('mergeGuardrails', () => {
  it('dedupes by name with per-call winning', () => {
    const merged = mergeGuardrails([guardrail('pii', 'call')], undefined, [guardrail('pii', 'global')])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.description).toBe('call')
  })
})

describe('formatConstraintFeedback', () => {
  it('frames the combined feedback as a corrective instruction', () => {
    const message = formatConstraintFeedback('- tone: too formal')
    expect(message).toContain('did not satisfy')
    expect(message).toContain('- tone: too formal')
  })
})

describe('emitGuardrailHooks', () => {
  it('fires onGuardrailRun once per applied audit entry', () => {
    const onGuardrailRun = vi.fn()
    updateRuntime({ instrumentationHooks: { onGuardrailRun } })

    const audit: GuardrailAudit = {
      applied: [
        { guard: 'pii', phase: 'input', action: 'redact', durationMs: 3 },
        { guard: 'topic', phase: 'output', action: 'pass', durationMs: 1 },
      ],
      blocked: false,
    }
    emitGuardrailHooks(audit, 'trace-1')

    expect(onGuardrailRun).toHaveBeenCalledTimes(2)
    expect(onGuardrailRun).toHaveBeenCalledWith(
      expect.objectContaining({ guardrailId: 'pii', phase: 'input', action: 'redact', traceId: 'trace-1' }),
    )
  })
})
