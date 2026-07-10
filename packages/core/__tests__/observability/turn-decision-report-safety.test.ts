import { describe, expect, it } from 'vitest'
import type { SafetyDecision } from '../../src/safety'
import { safetyDecisionToTurnDecision } from '../../src/observability/turn-decision-report'

describe('Safety decisions in TurnDecisionReport', () => {
  it('projects guardrail decisions into canonical turn decision rows', () => {
    const decision = safetyDecision({
      policyId: 'pii-output',
      kind: 'guardrail',
      boundary: 'model.output.text',
      action: 'rewrite',
      reason: 'Email address redacted.',
      findings: [{ type: 'email', count: 1 }],
    })

    expect(
      safetyDecisionToTurnDecision(decision, {
        index: 2,
        artifactId: 'artifact_guardrail',
      }),
    ).toMatchObject({
      id: 'decision:safety:2:pii-output:model.output.text',
      phase: 'checks',
      kind: 'safety.guardrail',
      subject: {
        kind: 'guardrail',
        id: 'pii-output',
        name: 'pii-output',
        label: 'pii-output on model.output.text',
      },
      outcome: 'rewrite',
      reason: {
        code: 'guardrail.redacted',
        text: 'Email address redacted.',
        source: 'artifact',
        evidenceLevel: 'declared',
      },
      metrics: { durationMs: 7, sizeBytes: 42 },
      evidence: [
        {
          kind: 'artifact',
          artifactId: 'artifact_guardrail',
          artifactKind: 'guardrail.report',
          role: 'safety-decision',
        },
      ],
      tab: { tab: 'Guardrail', anchorId: 'pii-output' },
    })
  })

  it('projects blocking tool policies as safety warning decisions', () => {
    const decision = safetyDecision({
      policyId: 'approve-delete',
      kind: 'toolPolicy',
      boundary: 'tool.call',
      action: 'block',
      reason: 'Tool call blocked by policy.',
    })

    expect(safetyDecisionToTurnDecision(decision)).toMatchObject({
      phase: 'tool-use',
      kind: 'safety.toolPolicy',
      subject: {
        kind: 'tool',
        id: 'approve-delete',
      },
      outcome: 'block',
      reason: {
        code: 'security.blocked',
        text: 'Tool call blocked by policy.',
      },
      tab: { tab: 'Security', anchorId: 'approve-delete' },
    })
  })
})

function safetyDecision(
  overrides: Partial<SafetyDecision> &
    Pick<SafetyDecision, 'policyId' | 'kind' | 'boundary' | 'action'>,
): SafetyDecision {
  return {
    mode: 'enforce',
    durationMs: 7,
    captured: {
      level: 'safe',
      sizeBytes: 42,
      hash: 'fnv1a64:abc',
      preview: 'safe preview',
    },
    ...overrides,
  }
}
