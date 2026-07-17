import type { Message } from '../../generation/messages'
import type {
  BoundaryDef,
  BoundaryIdOf,
  BoundaryInput,
  MediaPartLocation,
  MediaPartSubject,
  SafetyTargetId,
  SubjectOf,
} from '../boundary'
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

/**
 * Result returned by a guardrail attached to `boundary.input.media()` whose
 * callback receives a {@link MediaPartSubject}.
 *
 * `strip` removes the current part only in enforce mode; report mode records
 * the decision without changing provider input. Warn, block, and strip
 * results require a reason.
 */
export type MediaGuardrailRunResult =
  | { readonly action: 'allow' }
  | { readonly action: 'warn'; readonly reason: string }
  | { readonly action: 'block'; readonly reason: string }
  | { readonly action: 'strip'; readonly reason: string }

type IsMediaBoundary<B extends BoundaryInput> = [BoundaryIdOf<B>] extends ['user.input.media'] ? true : false

type ContainsMediaBoundary<B extends BoundaryInput> = 'user.input.media' extends BoundaryIdOf<B> ? true : false

type IsMixedMediaBoundary<B extends BoundaryInput> = ContainsMediaBoundary<B> extends true
  ? Exclude<BoundaryIdOf<B>, 'user.input.media'> extends never
    ? false
    : true
  : false

type GuardrailBoundaryInput<B extends BoundaryInput> = IsMixedMediaBoundary<B> extends true
  ? B & { readonly 'A media guardrail can target only boundary.input.media()': never }
  : B

type GuardrailRunResultFor<B extends BoundaryInput> = IsMediaBoundary<B> extends true
  ? MediaGuardrailRunResult
  : GuardrailRunResult<SubjectOf<B>>

/** Callable guardrail body, optionally carrying first-party strategy metadata. */
export interface GuardrailRun<B extends BoundaryInput> {
  (subject: SubjectOf<B>, ctx: SafetyRunContext<B>):
    | GuardrailRunResultFor<B>
    | Promise<GuardrailRunResultFor<B>>
  readonly strategy?: {
    readonly kind: string
    readonly config: Readonly<Record<string, unknown>>
  }
}

/** Public guardrail authoring config. */
export interface GuardrailConfig<B extends BoundaryInput = BoundaryDef> {
  readonly id: string
  readonly on: GuardrailBoundaryInput<B>
  readonly category?: string
  readonly mode?: GuardrailMode
  readonly stream?: IsMediaBoundary<B> extends true ? never : GuardrailStreamOption
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
  /** Exact boundary evaluated for this entry. */
  readonly boundary: SafetyTargetId
  /** Effective enforcement posture after per-call tuning. */
  readonly mode: GuardrailMode
  readonly phase: 'input' | 'output'
  readonly action: string
  readonly reason?: string
  /** Safe original coordinates for media-boundary entries. */
  readonly location?: MediaPartLocation
  /** Present only when stripping the part immediately became a terminal block. */
  readonly escalatedToBlock?: true
  readonly durationMs: number
}

export interface GuardrailAudit {
  readonly applied: readonly GuardrailAuditEntry[]
  readonly blocked: boolean
}

/** Validate a JS/unknown media guardrail result and fail closed on malformed values. */
export function validateMediaGuardrailRunResult(
  value: unknown,
  opts: { readonly policyId?: string; readonly boundary?: string },
): MediaGuardrailRunResult {
  if (!isRecord(value) || typeof value.action !== 'string') {
    throw resultError(opts, 'media result must be an object with an action string')
  }

  switch (value.action) {
    case 'allow':
      return { action: 'allow' }
    case 'warn':
      if (typeof value.reason !== 'string' || value.reason.length === 0) {
        throw resultError(opts, 'media warn results require a reason')
      }
      return { action: 'warn', reason: value.reason }
    case 'block':
      if (typeof value.reason !== 'string' || value.reason.length === 0) {
        throw resultError(opts, 'media block results require a reason')
      }
      return { action: 'block', reason: value.reason }
    case 'strip':
      if (typeof value.reason !== 'string' || value.reason.length === 0) {
        throw resultError(opts, 'media strip results require a reason')
      }
      return { action: 'strip', reason: value.reason }
    default:
      throw resultError(opts, `unknown media guardrail action "${value.action}"`)
  }
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
