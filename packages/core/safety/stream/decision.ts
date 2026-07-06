import type { SafetyDecision } from '../decision'
import { safeCaptureSummary } from '../errors'
import type { ChunkGuardrailResult, Guardrail } from '../guardrail/types'

/** Build the safe, redacted decision summary stored on stream block errors. */
export function streamGuardDecision(
  guard: Guardrail,
  result: ChunkGuardrailResult,
  content: string,
): SafetyDecision {
  return {
    policyId: guard.id,
    kind: 'guardrail',
    boundary: 'model.output.text',
    stage: 'stream.segment',
    mode: guard.mode,
    action: chunkSafetyAction(result.action),
    ...(result.action === 'block' || result.action === 'warn' ? { reason: result.reason } : {}),
    durationMs: 0,
    captured: safeCaptureSummary(content),
  }
}

/** Map legacy stream actions onto the public safety-decision action vocabulary. */
export function chunkSafetyAction(action: ChunkGuardrailResult['action']): SafetyDecision['action'] {
  if (action === 'pass' || action === 'hold') return 'allow'
  if (action === 'redact' || action === 'transform') return 'rewrite'
  return action
}

/** Milliseconds since a stream stage first started holding buffered content. */
export function heldMs(stage: { readonly heldStartedAt: number | undefined }): number {
  return stage.heldStartedAt === undefined ? 0 : performance.now() - stage.heldStartedAt
}
