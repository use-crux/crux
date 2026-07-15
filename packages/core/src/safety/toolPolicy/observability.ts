/**
 * Canonical observability for matched tool policies.
 *
 * Tool-policy artifacts contain safe decision metadata only. Content previews
 * and raw captures remain exclusively in the in-memory decision and never
 * cross the capture-exempt `security.report` boundary.
 *
 * @module
 */

import { observe } from '../../observability'
import type { SafetyDecision } from '../decision'

/** Record one tool-policy decision on the active tool lifecycle span. @internal */
export function recordToolPolicyDecision(decision: SafetyDecision): void {
  const activeSpanId = observe.captureContext()?.currentSpanId
  const { preview: _preview, raw: _raw, ...captured } = decision.captured
  const safeDecision = {
    policyId: decision.policyId,
    boundary: decision.boundary,
    mode: decision.mode,
    action: decision.action,
    ...(decision.severity ? { severity: decision.severity } : {}),
    ...(decision.reason ? { reason: decision.reason } : {}),
    ...(decision.findings ? { findings: decision.findings } : {}),
    durationMs: decision.durationMs,
    captured,
  }
  const artifactId = observe.artifact({
    kind: 'security.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: safeDecision,
    attributes: safeDecision,
  })

  if (activeSpanId && artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: activeSpanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: {
        policyId: decision.policyId,
        boundary: decision.boundary,
        action: decision.action,
      },
    })
  }
}
