import { observe } from '../../observability'
import type { SafetyRunContext } from '../decision'
import { safeCaptureSummary } from '../errors'
import { GuardrailBlockedError } from '../guardrail/errors'
import { recordMediaGuardrailBlockedEdge, recordMediaGuardrailReport } from '../guardrail/observability'
import type { GuardrailAudit, GuardrailAuditEntry, GuardrailContext, MediaGuardrailRunResult } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'
import type { MediaPartLocation } from './types'

/** @internal One completed media-policy evaluation awaiting final group state. */
export interface MediaEvaluation {
  readonly groupId: string
  readonly binding: GuardrailBinding
  readonly result: MediaGuardrailRunResult
  readonly location: MediaPartLocation
  readonly durationMs: number
  readonly span: ReturnType<typeof observe.openSpan>
  escalatedToBlock: boolean
}

/** Finalize ordered media observations and audit after group validation. */
export function finalizeMediaEvaluations(
  options: Readonly<{
    phase: 'input' | 'output'
    appendAudit: (audit: GuardrailAudit) => void
  }>,
  evaluations: readonly MediaEvaluation[],
  terminal?: MediaEvaluation,
): void {
  for (const evaluation of evaluations) {
    const { binding, result, location, durationMs, escalatedToBlock, span } = evaluation
    span.withContext(() => {
      recordMediaGuardrailReport(binding, result, location, durationMs, escalatedToBlock)
      if (evaluation === terminal && result.action !== 'allow') {
        recordMediaGuardrailBlockedEdge(binding, result.reason, location, escalatedToBlock)
      }
    })
    span.end({ attributes: { action: result.action, durationMs } })
    options.appendAudit({
      applied: [auditEntry(options.phase, binding, result, location, durationMs, escalatedToBlock)],
      blocked: (result.action === 'block' && binding.mode === 'enforce') || escalatedToBlock,
    })
  }
}

/** Build the canonical terminal error for a media block or escalation. */
export function mediaBlockedError(
  phase: 'input' | 'output',
  binding: GuardrailBinding,
  reason: string,
  location: MediaPartLocation,
  durationMs: number,
): GuardrailBlockedError {
  return new GuardrailBlockedError({
    guardrailId: binding.policy.id,
    phase,
    reason,
    decisions: [
      {
        policyId: binding.policy.id,
        kind: 'guardrail',
        boundary: binding.boundary.id,
        mode: binding.mode,
        action: 'block',
        reason,
        location,
        ...(binding.tuned ? { tuned: binding.tuned } : {}),
        durationMs,
        captured: safeCaptureSummary(''),
      },
    ],
  })
}

/** Project the private session context into one public media callback context. */
export function mediaRunContext(binding: GuardrailBinding, context: GuardrailContext): SafetyRunContext {
  return {
    policy: { id: binding.policy.id, mode: binding.mode },
    boundary: { id: binding.boundary.id, kind: binding.boundary.id },
    prompt: { id: context.promptId },
    model: { id: context.model },
    trace: { id: context.traceId },
    attempt: { index: 0, kind: 'initial' },
    metadata: context.metadata,
    findings: { add() {} },
  }
}

function auditEntry(
  phase: 'input' | 'output',
  binding: GuardrailBinding,
  result: MediaGuardrailRunResult,
  location: MediaPartLocation,
  durationMs: number,
  escalatedToBlock: boolean,
): GuardrailAuditEntry {
  return {
    guard: binding.policy.id,
    ...(binding.policy.category !== undefined ? { category: binding.policy.category } : {}),
    boundary: binding.boundary.id,
    mode: binding.mode,
    phase,
    action: result.action,
    ...(result.action === 'allow' ? {} : { reason: result.reason }),
    location,
    ...(escalatedToBlock ? { escalatedToBlock: true as const } : {}),
    durationMs,
  }
}
