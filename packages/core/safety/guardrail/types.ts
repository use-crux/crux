import type { Message } from '../../generation/messages'
import type { BoundaryDef, BoundaryInput, SubjectOf } from '../boundary'
import type { SafetyFinding, SafetyRunContext } from '../decision'
import { SafetyResultError } from '../errors'
import type { GuardrailStreamOption } from '../stream/types'

export type GuardrailMode = 'enforce' | 'report'
export type GuardrailRewriteKind = 'redact' | 'mask' | 'hash' | 'normalize'

/** Result returned by guardrail policy callbacks. */
export type GuardrailRunResult<TValue = string> =
  | { readonly action: 'allow' }
  | { readonly action: 'block'; readonly reason: string }
  | { readonly action: 'warn'; readonly reason: string }
  | {
      readonly action: 'rewrite'
      readonly value: TValue
      readonly rewrite: { readonly kind: GuardrailRewriteKind }
      readonly findings?: readonly SafetyFinding[]
    }
  | { readonly action: 'hold' }

/** Callable guardrail body, optionally carrying first-party strategy metadata. */
export interface GuardrailRun<B extends BoundaryInput> {
  (subject: SubjectOf<B>, ctx: SafetyRunContext<B>):
    | GuardrailRunResult<SubjectOf<B>>
    | Promise<GuardrailRunResult<SubjectOf<B>>>
  readonly strategy?: {
    readonly kind: string
    readonly config: Readonly<Record<string, unknown>>
  }
}

/** Public guardrail authoring config. */
export interface GuardrailConfig<B extends BoundaryInput = BoundaryDef> {
  readonly id: string
  readonly on: B
  readonly category?: string
  readonly mode?: GuardrailMode
  readonly stream?: GuardrailStreamOption
  readonly run: GuardrailRun<B>
}

/** Frozen guardrail object. */
export interface Guardrail<B extends BoundaryInput = BoundaryDef> {
  readonly _tag: 'Guardrail'
  readonly id: string
  readonly on: B
  readonly category: string | undefined
  readonly mode: GuardrailMode
  readonly stream: GuardrailStreamOption | undefined
  readonly run: GuardrailConfig<B>['run']
  readonly strategy?: {
    readonly kind: string
    readonly config: Readonly<Record<string, unknown>>
  }
}

/** Internal call context used by the Safety session when running guardrails. */
export interface GuardrailContext {
  readonly mode?: GuardrailMode
  readonly promptId: string | undefined
  readonly model: string | undefined
  readonly messages: readonly Message[]
  readonly systemPrompt: string | undefined
  readonly traceId: string | undefined
  readonly metadata: Readonly<Record<string, unknown>>
  readonly stream?: {
    readonly segment: true
    readonly last: boolean
    readonly heldChars: number
    readonly heldMs: number
  }
}

export interface GuardrailAuditEntry {
  readonly guard: string
  readonly category?: string
  readonly phase: 'input' | 'output'
  readonly action: string
  readonly reason?: string
  readonly durationMs: number
}

export interface GuardrailAudit {
  readonly applied: readonly GuardrailAuditEntry[]
  readonly blocked: boolean
}

/** Validate a JS/unknown guardrail result and fail closed on malformed values. */
export function validateGuardrailRunResult(
  value: unknown,
  opts: {
    readonly streaming: boolean
    readonly last: boolean
    readonly policyId?: string
    readonly boundary?: string
  },
): GuardrailRunResult<unknown> {
  if (!isRecord(value) || typeof value.action !== 'string') {
    throw resultError(opts, 'result must be an object with an action string')
  }

  switch (value.action) {
    case 'allow':
      return { action: 'allow' }
    case 'block':
      if (typeof value.reason !== 'string' || value.reason.length === 0) {
        throw resultError(opts, 'block results require a reason')
      }
      return { action: 'block', reason: value.reason }
    case 'warn':
      if (typeof value.reason !== 'string' || value.reason.length === 0) {
        throw resultError(opts, 'warn results require a reason')
      }
      return { action: 'warn', reason: value.reason }
    case 'rewrite':
      if (!('value' in value)) throw resultError(opts, 'rewrite results require a value')
      if (!isRecord(value.rewrite) || !isRewriteKind(value.rewrite.kind)) {
        throw resultError(opts, 'rewrite results require a valid rewrite.kind')
      }
      return {
        action: 'rewrite',
        value: value.value,
        rewrite: { kind: value.rewrite.kind },
        ...(isSafetyFindings(value.findings) ? { findings: value.findings } : {}),
      }
    case 'hold':
      if (!opts.streaming || opts.last) {
        throw resultError(opts, 'hold is only valid for non-final stream segments')
      }
      return { action: 'hold' }
    default:
      throw resultError(opts, `unknown guardrail action "${value.action}"`)
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function isRewriteKind(value: unknown): value is GuardrailRewriteKind {
  return value === 'redact' || value === 'mask' || value === 'hash' || value === 'normalize'
}

function isSafetyFindings(value: unknown): value is readonly SafetyFinding[] {
  return (
    Array.isArray(value) &&
    value.every((finding) => isRecord(finding) && typeof finding.type === 'string')
  )
}

function resultError(
  opts: { readonly policyId?: string; readonly boundary?: string },
  problem: string,
): SafetyResultError {
  const policyId = opts.policyId ?? 'unknown'
  const boundary = opts.boundary ?? 'unknown'
  return new SafetyResultError({
    message: `Safety policy "${policyId}" returned an invalid result: ${problem}.`,
    policyId,
    boundary,
    problem,
  })
}
