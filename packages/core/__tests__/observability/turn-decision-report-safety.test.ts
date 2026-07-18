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

  it('projects media stripping as a distinct guardrail outcome', () => {
    const decision = safetyDecision({
      policyId: 'strip-image',
      kind: 'guardrail',
      boundary: 'user.input.media',
      action: 'strip',
      reason: 'Image removed.',
      location: {
        origin: { kind: 'message', messageIndex: 2, partIndex: 1 },
        partType: 'image',
      },
    })

    expect(safetyDecisionToTurnDecision(decision)).toMatchObject({
      phase: 'checks',
      kind: 'safety.guardrail',
      outcome: 'strip',
      location: {
        origin: { kind: 'message', messageIndex: 2, partIndex: 1 },
        partType: 'image',
      },
      reason: {
        code: 'guardrail.stripped',
        text: 'Image removed.',
      },
      tab: { tab: 'Guardrail', anchorId: 'strip-image' },
    })
  })

  it('preserves exact step media coordinates without copying capture previews', () => {
    const decision = safetyDecision({
      policyId: 'strip-step-image',
      kind: 'guardrail',
      boundary: 'model.output.media',
      action: 'strip',
      location: {
        origin: { kind: 'step', stepIndex: 3, partIndex: 2 },
        partType: 'image',
      },
    })

    const row = safetyDecisionToTurnDecision(decision)

    expect(row.location).toEqual(decision.location)
    expect(JSON.stringify(row)).not.toContain('safe preview')
  })

  it('does not mislabel impossible strip actions from other safety kinds', () => {
    const constraint = safetyDecision({
      policyId: 'constraint-strip-fixture',
      kind: 'constraint',
      boundary: 'model.output.both',
      action: 'strip',
    })
    const toolPolicy = safetyDecision({
      policyId: 'tool-strip-fixture',
      kind: 'toolPolicy',
      boundary: 'tool.call',
      action: 'strip',
    })

    expect(safetyDecisionToTurnDecision(constraint).reason.code).toBe('custom.safety.constraint.strip')
    expect(safetyDecisionToTurnDecision(toolPolicy).reason.code).toBe('custom.safety.toolPolicy.strip')
  })

  it('links tool-policy evidence to security reports and the owning boundary span', () => {
    const reported = safetyDecision({
      policyId: 'report-read',
      kind: 'toolPolicy',
      boundary: 'tool.call',
      action: 'warn',
      mode: 'report',
      severity: 'warn',
    })
    const approval = safetyDecision({
      policyId: 'approve-write',
      kind: 'toolPolicy',
      boundary: 'approval.request',
      action: 'request_approval',
    })

    expect(
      safetyDecisionToTurnDecision(reported, {
        artifactId: 'artifact_report',
        spanId: 'span_call',
      }),
    ).toMatchObject({
      reason: { code: 'security.warned' },
      evidence: [
        {
          kind: 'artifact',
          artifactKind: 'security.report',
          spanId: 'span_call',
        },
        { kind: 'span', primitive: 'tool.call', spanId: 'span_call' },
      ],
    })
    expect(
      safetyDecisionToTurnDecision(approval, {
        artifactId: 'artifact_approval',
        spanId: 'span_approval',
      }),
    ).toMatchObject({
      reason: { code: 'tool.eligible.request' },
      evidence: [
        { kind: 'artifact', artifactKind: 'security.report' },
        { kind: 'span', primitive: 'tool.approval' },
      ],
    })
  })
})

function safetyDecision(
  overrides: Partial<SafetyDecision> & Pick<SafetyDecision, 'policyId' | 'kind' | 'boundary' | 'action'>,
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
