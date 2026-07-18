import { observe } from '../../observability'
import { guardrailDefinitionRef } from '../../observability/definition-ref'
import type { MediaPartLocation, MediaPartSubject } from '../boundary'
import type { SafetyRunContext } from '../decision'
import { safeCaptureSummary } from '../errors'
import { GuardrailBlockedError } from '../guardrail/errors'
import { recordMediaGuardrailBlockedEdge, recordMediaGuardrailReport } from '../guardrail/observability'
import type { GuardrailAudit, GuardrailAuditEntry, GuardrailContext, MediaGuardrailRunResult } from '../guardrail/types'
import { validateMediaGuardrailRunResult } from '../guardrail/types'
import { mediaLocationAttributes } from '../media/location'
import type { GuardrailBinding } from '../registry'

interface GuardOutputMediaOptions {
  readonly bindings: readonly GuardrailBinding[]
  readonly subjects: readonly MediaPartSubject[]
  readonly minimumRetained: number
  readonly context: GuardrailContext
  readonly appendAudit: (audit: GuardrailAudit) => void
}

/** @internal Retained subjects and actions from one output-media pass. */
export interface MediaOutputResult {
  readonly subjects: readonly MediaPartSubject[]
  readonly actions: readonly string[]
  readonly ran: boolean
}

/** Guard canonical output media in stable subject and binding order. */
export async function guardOutputMedia(options: GuardOutputMediaOptions): Promise<MediaOutputResult> {
  if (options.bindings.length === 0 || options.subjects.length === 0) {
    return { subjects: options.subjects, actions: [], ran: false }
  }

  const actions: string[] = []
  const stripped = new Set<MediaPartSubject>()
  let ran = false

  for (const subject of options.subjects) {
    const location: MediaPartLocation = {
      origin: subject.origin,
      partType: subject.part.type,
    }

    for (const binding of options.bindings) {
      ran = true
      const start = performance.now()
      const span = observe.openSpan({
        name: binding.policy.id,
        primitive: 'guardrail.run',
        definitionRefs: [guardrailDefinitionRef(binding.policy.id)],
        attributes: {
          guardrailName: binding.policy.id,
          category: binding.policy.category,
          boundary: binding.boundary.id,
          mode: binding.mode,
          phase: 'output',
          promptId: options.context.promptId,
          model: options.context.model,
          ...mediaLocationAttributes(location),
        },
      })

      let result: MediaGuardrailRunResult
      try {
        const value: unknown = await span.withContext(() =>
          binding.policy.run(subject as never, mediaRunContext(binding, options.context) as never),
        )
        result = validateMediaGuardrailRunResult(value, {
          policyId: binding.policy.id,
          boundary: binding.boundary.id,
        })
      } catch (error) {
        span.error(error)
        throw error
      }

      const escalatedToBlock =
        result.action === 'strip' &&
        binding.mode === 'enforce' &&
        options.subjects.length - stripped.size <= options.minimumRetained
      const durationMs = performance.now() - start
      span.withContext(() => recordMediaGuardrailReport(binding, result, location, durationMs, escalatedToBlock))
      span.end({ attributes: { action: result.action, durationMs } })

      const entry = auditEntry(binding, result, location, durationMs, escalatedToBlock)
      actions.push(entry.action)
      options.appendAudit({
        applied: [entry],
        blocked: (result.action === 'block' && binding.mode === 'enforce') || escalatedToBlock,
      })

      if (result.action === 'block' && binding.mode === 'enforce') {
        span.withContext(() => recordMediaGuardrailBlockedEdge(binding, result.reason, location, false))
        throw blockedError(binding, result.reason, location, durationMs)
      }

      if (result.action === 'strip' && binding.mode === 'enforce') {
        if (escalatedToBlock) {
          span.withContext(() => recordMediaGuardrailBlockedEdge(binding, result.reason, location, true))
          throw blockedError(binding, result.reason, location, durationMs)
        }
        stripped.add(subject)
        break
      }
    }
  }

  return {
    subjects: options.subjects.filter((subject) => !stripped.has(subject)),
    actions,
    ran,
  }
}

function auditEntry(
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
    phase: 'output',
    action: result.action,
    ...(result.action === 'allow' ? {} : { reason: result.reason }),
    location,
    ...(escalatedToBlock ? { escalatedToBlock: true as const } : {}),
    durationMs,
  }
}

function blockedError(
  binding: GuardrailBinding,
  reason: string,
  location: MediaPartLocation,
  durationMs: number,
): GuardrailBlockedError {
  return new GuardrailBlockedError({
    guardrailId: binding.policy.id,
    phase: 'output',
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

function mediaRunContext(binding: GuardrailBinding, context: GuardrailContext): SafetyRunContext {
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
