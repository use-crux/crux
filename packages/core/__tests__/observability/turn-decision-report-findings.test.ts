import { describe, expect, it } from 'vitest'
import { safetyDecisionToTurnDecision } from '../../src/observability/turn-decision-report'
import type { SafetyDecision } from '../../src/safety'

describe('Safety finding turn-decision privacy', () => {
  it('projects only a bounded finding count, not classifier evidence', () => {
    const decision: SafetyDecision = {
      policyId: 'media-classifier',
      kind: 'guardrail',
      boundary: 'model.input.media',
      mode: 'enforce',
      action: 'block',
      findings: [{
        type: 'media_classifier_match',
        category: 'private-category',
        score: 0.913579,
        threshold: 0.812468,
      }],
      durationMs: 1,
      captured: {
        level: 'off',
        sizeBytes: 0,
        hash: 'fnv1a64:0',
      },
    }

    const row = safetyDecisionToTurnDecision(decision)

    expect(row.reason.text).toContain('with 1 finding type(s)')
    expect(JSON.stringify(row)).not.toContain('private-category')
    expect(JSON.stringify(row)).not.toContain('0.913579')
    expect(JSON.stringify(row)).not.toContain('0.812468')
  })
})
