import type { SafetyDecision } from '../../safety/decision'
import type { TurnDecision, TurnDecisionPhase } from './report'
import type { TurnDecisionReasonCode } from './shared'
import type { TurnDecisionSubject, TurnDeepTabTarget, TurnEvidenceRef } from './targets'

/** Options for projecting one Safety decision into a turn report row. */
export interface SafetyDecisionProjectionOptions {
  /** Stable index within the source decision list; used in the generated id. */
  readonly index?: number
  /** Artifact that carried the original safety report, when available. */
  readonly artifactId?: string
  /** Span that emitted or owns the safety report, when available. */
  readonly spanId?: string
}

/**
 * Project a canonical runtime {@link SafetyDecision} into a
 * {@link TurnDecisionReport} decision row.
 *
 * The projection intentionally copies only safe read-model fields: policy id,
 * boundary, action, reason, finding counts, duration, capture size, and
 * evidence references. Raw content remains in Safety capture summaries and
 * never becomes turn-report text.
 */
export function safetyDecisionToTurnDecision(
  decision: SafetyDecision,
  options: SafetyDecisionProjectionOptions = {},
): TurnDecision {
  return {
    id: safetyDecisionRowId(decision, options.index ?? 0),
    phase: phaseForSafetyDecision(decision),
    kind: `safety.${decision.kind}`,
    subject: subjectForSafetyDecision(decision),
    outcome: decision.action,
    reason: {
      code: reasonCodeForSafetyDecision(decision),
      text: decision.reason ?? defaultReasonText(decision),
      source: 'artifact',
      evidenceLevel: 'declared',
    },
    tab: tabForSafetyDecision(decision),
    evidence: evidenceForSafetyDecision(decision, options),
    metrics: {
      durationMs: decision.durationMs,
      sizeBytes: decision.captured.sizeBytes,
    },
  }
}

/** Project a list of Safety decisions while preserving source order. */
export function safetyDecisionsToTurnDecisions(
  decisions: readonly SafetyDecision[],
  options: Omit<SafetyDecisionProjectionOptions, 'index'> = {},
): TurnDecision[] {
  return decisions.map((decision, index) => safetyDecisionToTurnDecision(decision, { ...options, index }))
}

function safetyDecisionRowId(decision: SafetyDecision, index: number): string {
  return `decision:safety:${index}:${decision.policyId}:${decision.boundary}`
}

function phaseForSafetyDecision(decision: SafetyDecision): TurnDecisionPhase {
  if (
    decision.boundary === 'tool.call' ||
    decision.boundary === 'tool.result' ||
    decision.boundary === 'approval.request'
  ) {
    return 'tool-use'
  }
  if (decision.boundary === 'retrieval.result' || decision.boundary === 'memory.write') {
    return 'data'
  }
  if (decision.boundary === 'validation.feedback') return 'recovery'
  return 'checks'
}

function subjectForSafetyDecision(decision: SafetyDecision): TurnDecisionSubject {
  return {
    kind: subjectKindForSafetyDecision(decision),
    id: decision.policyId,
    name: decision.policyId,
    label: `${decision.policyId} on ${decision.boundary}`,
  }
}

function subjectKindForSafetyDecision(decision: SafetyDecision): TurnDecisionSubject['kind'] {
  if (decision.kind === 'guardrail') return 'guardrail'
  if (decision.kind === 'constraint') return 'constraint'
  if (decision.boundary === 'memory.write') return 'memory'
  if (decision.boundary === 'retrieval.result') return 'retrieval'
  if (
    decision.boundary === 'tool.call' ||
    decision.boundary === 'tool.result' ||
    decision.boundary === 'approval.request'
  ) {
    return 'tool'
  }
  return 'security-check'
}

function reasonCodeForSafetyDecision(decision: SafetyDecision): TurnDecisionReasonCode {
  if (decision.kind === 'guardrail') return guardrailReasonCode(decision)
  if (decision.kind === 'constraint') return constraintReasonCode(decision)
  return toolPolicyReasonCode(decision)
}

function guardrailReasonCode(decision: SafetyDecision): TurnDecisionReasonCode {
  switch (decision.action) {
    case 'allow':
      return 'guardrail.passed'
    case 'warn':
      return 'guardrail.warned'
    case 'block':
    case 'drop':
      return 'guardrail.blocked'
    case 'rewrite':
      return 'guardrail.redacted'
    case 'strip':
      return 'guardrail.stripped'
    case 'retry':
      return 'constraint.retry_requested'
    case 'request_approval':
      return 'tool.eligible.request'
  }
}

function constraintReasonCode(decision: SafetyDecision): TurnDecisionReasonCode {
  switch (decision.action) {
    case 'allow':
      return 'constraint.passed'
    case 'retry':
      return 'constraint.retry_requested'
    case 'block':
    case 'drop':
      return 'constraint.failed'
    case 'warn':
    case 'rewrite':
    case 'request_approval':
    case 'strip':
      return `custom.safety.constraint.${decision.action}`
  }
}

function toolPolicyReasonCode(decision: SafetyDecision): TurnDecisionReasonCode {
  switch (decision.action) {
    case 'allow':
      return 'security.passed'
    case 'warn':
      return 'security.warned'
    case 'rewrite':
      return 'security.redacted'
    case 'block':
    case 'drop':
      return 'security.blocked'
    case 'request_approval':
      return 'tool.eligible.request'
    case 'retry':
      return `custom.safety.toolPolicy.retry`
    case 'strip':
      return `custom.safety.toolPolicy.strip`
  }
}

function defaultReasonText(decision: SafetyDecision): string {
  const findingSummary = decision.findings?.length ? ` with ${decision.findings.length} finding type(s)` : ''
  return `${decision.kind} '${decision.policyId}' returned ${decision.action} on ${decision.boundary}${findingSummary}.`
}

function tabForSafetyDecision(decision: SafetyDecision): TurnDeepTabTarget {
  if (decision.kind === 'guardrail') {
    return { tab: 'Guardrail', anchorId: decision.policyId }
  }
  if (decision.kind === 'constraint') {
    return { tab: 'Constraint', anchorId: decision.policyId }
  }
  if (decision.action === 'block' || decision.action === 'drop') {
    return { tab: 'Security', anchorId: decision.policyId }
  }
  return { tab: 'Output', anchorId: decision.policyId }
}

function evidenceForSafetyDecision(
  decision: SafetyDecision,
  options: SafetyDecisionProjectionOptions,
): TurnEvidenceRef[] {
  const evidence: TurnEvidenceRef[] = []
  if (options.artifactId) {
    evidence.push({
      kind: 'artifact',
      artifactId: options.artifactId,
      artifactKind: artifactKindForSafetyDecision(decision),
      ...(options.spanId ? { spanId: options.spanId } : {}),
      role: 'safety-decision',
    })
  }
  if (options.spanId) {
    evidence.push({
      kind: 'span',
      spanId: options.spanId,
      primitive: primitiveForSafetyDecision(decision),
      role: 'safety-decision',
    })
  }
  return evidence
}

function artifactKindForSafetyDecision(decision: SafetyDecision): string {
  if (decision.kind === 'guardrail') return 'guardrail.report'
  if (decision.kind === 'constraint') return 'constraint.report'
  return 'security.report'
}

function primitiveForSafetyDecision(decision: SafetyDecision): string {
  if (decision.kind === 'guardrail') return 'guardrail.run'
  if (decision.kind === 'constraint') return 'constraint.check'
  return decision.boundary === 'approval.request' ? 'tool.approval' : 'tool.call'
}
