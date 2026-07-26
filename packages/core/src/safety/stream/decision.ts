import type { SafetyDecision } from '../decision'
import { safeCaptureSummary } from '../errors'
import type { GuardrailRunResult } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'

/** Build the safe, redacted decision summary stored on stream block errors. */
export function streamGuardDecision(
  binding: GuardrailBinding,
  result: GuardrailRunResult<unknown>,
  content: string,
  findings?: SafetyDecision['findings'],
): SafetyDecision {
  const guard = binding.policy
  return {
    policyId: guard.id,
    kind: 'guardrail',
    boundary: binding.boundary.id,
    stage: 'stream.segment',
    mode: binding.mode,
    action: chunkSafetyAction(result.action),
    ...(result.action === 'block' || result.action === 'warn' ? { reason: result.reason } : {}),
    ...(findings ? { findings } : {}),
    ...(binding.tuned ? { tuned: binding.tuned } : {}),
    durationMs: 0,
    captured: safeCaptureSummary(content),
  }
}

/** Map stream guardrail actions onto the public safety-decision action vocabulary. */
export function chunkSafetyAction(action: GuardrailRunResult<unknown>['action']): SafetyDecision['action'] {
  if (action === 'allow' || action === 'hold') return 'allow'
  if (action === 'rewrite') return 'rewrite'
  return action
}

/** Milliseconds since a stream stage first started holding buffered content. */
export function heldMs(stage: { readonly heldStartedAt: number | undefined }): number {
  return stage.heldStartedAt === undefined ? 0 : performance.now() - stage.heldStartedAt
}
