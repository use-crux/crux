import type { Guardrail, GuardrailAudit, GuardrailAuditEntry, GuardrailRunResult } from '../guardrail/types'

type AppendGuardrailAudit = (audit: GuardrailAudit) => void

/** Record output guardrails that intentionally opt out of stream-time checks. */
export function auditDisabledStreamGuards(
  guards: readonly Guardrail[],
  appendGuardrailAudit: AppendGuardrailAudit,
): void {
  for (const guard of guards) {
    const entry: GuardrailAuditEntry = {
      guard: guard.id,
      ...(guard.category !== undefined ? { category: guard.category } : {}),
      phase: 'output',
      action: 'allow',
      reason: 'stream: false',
      durationMs: 0,
    }
    appendGuardrailAudit({ applied: [entry], blocked: false })
  }
}

/** Record a stream segment action that changed, warned on, or blocked output. */
export function recordStreamChunkAction(
  appendGuardrailAudit: AppendGuardrailAudit,
  guard: Guardrail,
  result: GuardrailRunResult<unknown>,
  reason?: string,
  options?: { readonly blocked?: boolean },
): void {
  if (result.action === 'allow' || result.action === 'hold') return

  const entry: GuardrailAuditEntry = {
    guard: guard.id,
    ...(guard.category !== undefined ? { category: guard.category } : {}),
    phase: 'output',
    action: auditAction(result),
    ...(reason ? { reason } : {}),
    durationMs: 0,
  }
  appendGuardrailAudit({ applied: [entry], blocked: options?.blocked ?? result.action === 'block' })
}

function auditAction(result: GuardrailRunResult<unknown>): string {
  if (result.action === 'rewrite') return result.rewrite.kind === 'normalize' ? 'transform' : result.rewrite.kind
  return result.action
}
