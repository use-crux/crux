/**
 * Canonical decisions and terminal errors for tool policies.
 *
 * @module
 */

import type { SafetyDecision, SafetyFinding } from '../decision'
import { safeCaptureSummary } from '../errors'
import { ToolPolicyBlockedError } from './errors'
import { recordToolPolicyDecision } from './observability'

interface ToolPolicyDecisionInput {
  readonly policyId: string
  readonly boundary: 'tool.call' | 'tool.result' | 'approval.request'
  readonly action: Extract<SafetyDecision['action'], 'allow' | 'block' | 'warn' | 'rewrite' | 'request_approval'>
  readonly mode?: SafetyDecision['mode']
  readonly severity?: SafetyDecision['severity']
  readonly subject: unknown
  readonly reason?: string
  readonly findings?: readonly SafetyFinding[]
}

/** Create a canonical tool-policy decision with a bounded capture summary. @internal */
export function createToolPolicyDecision(input: ToolPolicyDecisionInput): SafetyDecision {
  return {
    policyId: input.policyId,
    kind: 'toolPolicy',
    boundary: input.boundary,
    mode: input.mode ?? 'enforce',
    action: input.action,
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.findings && input.findings.length > 0 ? { findings: input.findings } : {}),
    durationMs: 0,
    captured: safeCaptureSummary(serializeToolPolicySubject(input.subject)),
  }
}

/** Record and construct the terminal error for a blocked tool-policy decision. @internal */
export function blockedToolPolicy(input: {
  readonly policyId: string
  readonly boundary: 'tool.call' | 'tool.result'
  readonly reason: string
  readonly subject: unknown
  readonly findings?: readonly SafetyFinding[]
}): ToolPolicyBlockedError {
  const decision = createToolPolicyDecision({
    ...input,
    action: 'block',
    severity: 'error',
  })
  recordToolPolicyDecision(decision)
  return new ToolPolicyBlockedError({
    policyId: input.policyId,
    reason: input.reason,
    decisions: [decision],
  })
}

function serializeToolPolicySubject(subject: unknown): string {
  if (typeof subject === 'string') return subject
  try {
    return JSON.stringify(subject) ?? String(subject)
  } catch {
    return String(subject)
  }
}
