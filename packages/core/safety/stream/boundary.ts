import { GuardrailBlockedError } from '../guardrail/errors'
import type { SafetyRunContext } from '../decision'
import type { Guardrail, GuardrailContext } from '../guardrail/types'
import { validateGuardrailRunResult } from '../guardrail/types'
import { streamGuardDecision } from './decision'

/** Return the first boundary declared by a guardrail. */
export function firstBoundary(guard: Guardrail): { readonly id: string; readonly path?: string } {
  return Array.isArray(guard.on) ? (guard.on[0] ?? { id: 'model.output.text' }) : guard.on
}

/** Return the first boundary id declared by a guardrail. */
export function firstBoundaryId(guard: Guardrail): string {
  return firstBoundary(guard).id
}

/**
 * Run an object-boundary guard against parsed final stream text.
 *
 * Stream chunks are text, so object guardrails are deferred until finish and
 * evaluated against the full parsed JSON object, or the configured path inside
 * that object.
 */
export async function runFinalBoundaryGuard(
  guard: Guardrail,
  text: string,
  context: GuardrailContext,
): Promise<void> {
  const boundary = firstBoundary(guard)
  const parsed = parseJsonObject(text)
  const subject = boundary.path ? valueAtPath(parsed, boundary.path) : parsed
  const runContext = finalBoundaryRunContext(guard, boundary, context)
  const result = validateGuardrailRunResult(await guard.run(subject as never, runContext as never), {
    streaming: true,
    last: true,
    policyId: guard.id,
    boundary: firstBoundaryId(guard),
  })

  if (result.action !== 'block' || guard.mode === 'report') return

  throw new GuardrailBlockedError({
    guardrailId: guard.id,
    phase: 'output',
    reason: result.reason,
    decisions: [streamGuardDecision(guard, result, text)],
  })
}

function finalBoundaryRunContext(
  guard: Guardrail,
  boundary: { readonly id: string; readonly path?: string },
  context: GuardrailContext,
): SafetyRunContext {
  return {
    policy: { id: guard.id, mode: guard.mode },
    boundary: { id: boundary.id as never, kind: boundary.id as never },
    prompt: { id: context.promptId },
    model: { id: context.model },
    trace: { id: context.traceId },
    attempt: { index: 0, kind: 'initial' },
    metadata: context.metadata,
    findings: { add() {} },
    ...(context.stream ? { stream: context.stream } : {}),
    ...(boundary.path ? { path: boundary.path } : {}),
  }
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null) return undefined
    return (current as Readonly<Record<string, unknown>>)[segment]
  }, value)
}
