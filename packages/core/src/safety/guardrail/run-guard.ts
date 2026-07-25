/**
 * Shared per-guard evaluation and observability (RFC #173).
 *
 * One helper owns running a single guardrail over a subject: it opens the guard
 * span, runs the policy within that span's context, validates the run result,
 * records the report edge (and the blocked edge on an enforced block), ends the
 * span, and returns the canonical audit entry. The terminal pipeline and the
 * structured occurrence engine both drive their guards through it so their spans,
 * reports, and audit entries are identical — callers keep only their own content
 * mutation, block-decision construction, and config callbacks.
 *
 * @module
 */

import { selectedPath } from '../boundary'
import type { BoundaryDef } from '../boundary'
import type { SafetyRunContext } from '../decision'
import { inputOriginAttributes } from '../input-origin-observability'
import type { GuardrailBinding } from '../registry'
import { observe } from '../../observability'
import { guardrailDefinitionRef } from '../../observability/definition-ref'
import { recordGuardrailBlockedEdge, recordGuardrailReport } from './observability'
import type { GuardrailAuditEntry, GuardrailContext, GuardrailRunResult } from './types'
import { validateGuardrailRunResult } from './types'

export interface RunGuardInput {
  readonly binding: GuardrailBinding
  /** The already-resolved subject for this guard (terminal content or occurrence value). */
  readonly subject: unknown
  readonly ctx: GuardrailContext
  readonly phase: 'input' | 'output'
  readonly streaming: boolean
  readonly last: boolean
}

export interface RunGuardOutcome {
  readonly result: GuardrailRunResult<unknown>
  readonly entry: GuardrailAuditEntry
  readonly durationMs: number
}

/**
 * Run one guard with full observability and return its validated result and
 * canonical audit entry. Rethrows a thrown policy after recording `span.error`.
 * The span, report edge, and (for an enforced block) blocked edge are recorded
 * here; the caller decides what to do with the result.
 */
export async function runGuardWithObservability(input: RunGuardInput): Promise<RunGuardOutcome> {
  const { binding, subject, ctx, phase, streaming, last } = input
  const guard = binding.policy
  const boundary = binding.boundary
  const start = performance.now()
  // `guardrail()` requires `id`, so this ref is always canonical.
  const span = observe.openSpan({
    name: guard.id,
    primitive: 'guardrail.run',
    definitionRefs: [guardrailDefinitionRef(guard.id)],
    attributes: {
      guardrailName: guard.id,
      category: guard.category,
      boundary: boundary.id,
      mode: binding.mode,
      phase,
      promptId: ctx.promptId,
      model: ctx.model,
      ...inputOriginAttributes(ctx.origin),
    },
  })

  let result: GuardrailRunResult<unknown>
  let durationMs = 0
  try {
    result = validateGuardrailRunResult(
      await span.withContext(async () => guard.run(subject as never, runContext(binding, ctx) as never)),
      { streaming, last, policyId: guard.id, boundary: boundary.id },
    )
    durationMs = performance.now() - start
    const report = result
    span.withContext(() => recordGuardrailReport(binding, auditAction(report), phase, durationMs, report, ctx.origin))
    if (report.action === 'block' && binding.mode !== 'report') {
      const { reason } = report
      span.withContext(() => recordGuardrailBlockedEdge(binding, reason, ctx.origin))
    }
    span.end({ attributes: { action: auditAction(result), durationMs } })
  } catch (error) {
    span.error(error)
    throw error
  }

  const entry: GuardrailAuditEntry = {
    guard: guard.id,
    ...(guard.category !== undefined ? { category: guard.category } : {}),
    boundary: boundary.id,
    ...(ctx.origin ? { origin: ctx.origin } : {}),
    mode: binding.mode,
    phase,
    action: auditAction(result),
    ...(result.action === 'block' || result.action === 'warn' ? { reason: result.reason } : {}),
    durationMs,
  }

  return { result, entry, durationMs }
}

/** The audit/observability action name for a run result (rewrite → its rewrite kind). */
export function auditAction(result: GuardrailRunResult<unknown>): string {
  if (result.action === 'rewrite') return result.rewrite.kind === 'normalize' ? 'transform' : result.rewrite.kind
  return result.action
}

/** Build the `SafetyRunContext` handed to a guard policy for one execution. */
export function runContext<B extends BoundaryDef>(
  binding: GuardrailBinding & { readonly boundary: B },
  ctx: GuardrailContext,
): SafetyRunContext<B> {
  const guard = binding.policy
  const boundary = binding.boundary
  return {
    policy: { id: guard.id, mode: binding.mode },
    boundary: { id: boundary.id as never, kind: boundary.id as never },
    prompt: { id: ctx.promptId },
    model: { id: ctx.model },
    trace: { id: ctx.traceId },
    attempt: { index: 0, kind: 'initial' },
    metadata: ctx.metadata,
    findings: { add() {} },
    ...(ctx.stream ? { stream: ctx.stream } : {}),
    ...(selectedPath(boundary) ? { path: selectedPath(boundary) } : {}),
    ...(ctx.origin ? { origin: ctx.origin } : {}),
  } as SafetyRunContext<B>
}
