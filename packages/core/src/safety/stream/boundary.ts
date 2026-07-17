import { GuardrailBlockedError } from '../guardrail/errors'
import type { SafetyRunContext } from '../decision'
import type { GuardrailContext } from '../guardrail/types'
import { validateGuardrailRunResult } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'
import { streamGuardDecision } from './decision'

/**
 * Run an object-boundary guard against parsed final stream text.
 *
 * Stream chunks are text, so object guardrails are deferred until finish and
 * evaluated against the full parsed JSON object, or the configured path inside
 * that object.
 */
export async function runFinalBoundaryGuard(
  binding: GuardrailBinding,
  text: string,
  context: GuardrailContext,
): Promise<void> {
  const guard = binding.policy
  const boundary = binding.boundary
  const parsed = parseJsonObject(text)
  const subject = boundary.path ? valueAtPath(parsed, boundary.path) : parsed
  const runContext = finalBoundaryRunContext(binding, context)
  const result = validateGuardrailRunResult(await guard.run(subject as never, runContext as never), {
    streaming: true,
    last: true,
    policyId: guard.id,
    boundary: boundary.id,
  })

  if (result.action !== 'block' || binding.mode === 'report') return

  throw new GuardrailBlockedError({
    guardrailId: guard.id,
    phase: 'output',
    reason: result.reason,
    decisions: [streamGuardDecision(binding, result, text)],
  })
}

function finalBoundaryRunContext(
  binding: GuardrailBinding,
  context: GuardrailContext,
): SafetyRunContext {
  const guard = binding.policy
  const boundary = binding.boundary
  return {
    policy: { id: guard.id, mode: binding.mode },
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
