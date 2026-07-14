import type { CruxRunId, CruxSegmentId, CruxSpanId, CruxTraceId } from './contract'
import type { CruxCorrelators } from './correlators'
import { createCruxSpanId } from './ids'
import type { JsonObject } from '../storage'
import {
  CruxDeploymentIdentitySchema,
  type CruxDeploymentIdentity,
} from '../project-index'

const MAX_TRACE_STATE_LENGTH = 512
const MAX_BAGGAGE_LENGTH = 8_192
const MAX_BAGGAGE_MEMBERS = 64
const MAX_CORRELATOR_LENGTH = 200

/** Serializable correlation required to continue one logical run in a fresh segment. */
export interface CruxPropagationFields extends JsonObject {
  readonly runId: CruxRunId
  readonly previousSegmentId?: CruxSegmentId
  readonly parentSpanId?: CruxSpanId
  readonly sessionId?: string
  readonly userId?: string
  /** Validated deployment identity owned by Crux, never derived from baggage. */
  readonly deployment?: CruxDeploymentIdentity & JsonObject
}

export interface CruxPropagationCarrier extends JsonObject {
  readonly traceparent?: string
  readonly tracestate?: string
  readonly baggage?: string
  readonly crux: CruxPropagationFields
}

/** A minimal header-like boundary used by carrier injection and extraction. */
export interface CruxPropagationHeaderCarrier {
  get(name: string): string | null | undefined
  set(name: string, value: string): void
}

export interface CruxContinuationIdentity {
  readonly runId: CruxRunId
  readonly traceId: CruxTraceId
  readonly previousSegmentId?: CruxSegmentId
  readonly deployment?: CruxDeploymentIdentity
}

/**
 * Create a portable continuation carrier for an owned run segment.
 *
 * The returned data is safe to persist as JSON. It deliberately contains no
 * live SDK span or ambient-context object.
 */
export function createPropagationCarrier(identity: {
  readonly runId: CruxRunId
  readonly traceId: CruxTraceId
  readonly previousSegmentId?: CruxSegmentId
  readonly parentSpanId?: CruxSpanId
  readonly correlators?: CruxCorrelators
  readonly deployment?: CruxDeploymentIdentity
}): CruxPropagationCarrier {
  return sanitizePropagationCarrier({
    traceparent: `00-${identity.traceId}-${createCruxSpanId()}-01`,
    crux: {
      runId: identity.runId,
      ...(identity.previousSegmentId ? { previousSegmentId: identity.previousSegmentId } : {}),
      ...(identity.parentSpanId ? { parentSpanId: identity.parentSpanId } : {}),
      ...(boundedCorrelator(identity.correlators?.sessionId) ? { sessionId: identity.correlators?.sessionId } : {}),
      ...(boundedCorrelator(identity.correlators?.userId) ? { userId: identity.correlators?.userId } : {}),
      ...(identity.deployment ? { deployment: identity.deployment } : {}),
    },
  })
}

/**
 * Validate and normalize a continuation received from a persistence or host boundary.
 *
 * Carrier identity is correlation only: `sessionId` and `userId` never become
 * trusted application identity. Callers must provide trusted correlators
 * explicitly through their own context.
 */
export function sanitizePropagationCarrier(value: unknown): CruxPropagationCarrier {
  const carrier = objectValue(value, 'Invalid Crux continuation')
  const crux = objectValue(carrier.crux, 'Invalid Crux continuation: crux is required')
  const traceparent = requiredTraceparent(carrier.traceparent)
  const runId = requiredId(crux.runId, /^run_[0-9a-f]{24}$/u, 'crux.runId') as CruxRunId
  const previousSegmentId = optionalId(crux.previousSegmentId, /^seg_[0-9a-f]{24}$/u, 'previousSegmentId') as CruxSegmentId | undefined
  const parentSpanId = optionalId(crux.parentSpanId, /^[0-9a-f]{16}$/u, 'parentSpanId') as CruxSpanId | undefined
  const tracestate = optionalHeader(carrier.tracestate, 'tracestate', MAX_TRACE_STATE_LENGTH)
  const baggage = optionalBaggage(carrier.baggage)
  const sessionId = optionalCorrelator(crux.sessionId, 'sessionId')
  const userId = optionalCorrelator(crux.userId, 'userId')
  const deployment = optionalDeploymentIdentity(crux.deployment)

  return {
    traceparent,
    ...(tracestate ? { tracestate } : {}),
    ...(baggage ? { baggage } : {}),
    crux: {
      runId,
      ...(previousSegmentId ? { previousSegmentId } : {}),
      ...(parentSpanId ? { parentSpanId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(userId ? { userId } : {}),
      ...(deployment ? { deployment } : {}),
    },
  }
}

/** Inject a validated carrier into a header-like transport boundary. */
export function injectPropagationCarrier(
  carrier: CruxPropagationCarrier,
  target: CruxPropagationHeaderCarrier,
): void {
  const safe = sanitizePropagationCarrier(carrier)
  target.set('traceparent', safe.traceparent!)
  if (safe.tracestate) target.set('tracestate', safe.tracestate)
  if (safe.baggage) target.set('baggage', safe.baggage)
  target.set('crux', JSON.stringify(safe.crux))
}

/** Extract a validated carrier from a header-like transport boundary. */
export function extractPropagationCarrier(
  source: Pick<CruxPropagationHeaderCarrier, 'get'>,
): CruxPropagationCarrier | undefined {
  const cruxHeader = source.get('crux')
  if (!cruxHeader || cruxHeader.length > 1_024) return undefined
  try {
    return sanitizePropagationCarrier({
      traceparent: source.get('traceparent') ?? undefined,
      tracestate: source.get('tracestate') ?? undefined,
      baggage: source.get('baggage') ?? undefined,
      crux: JSON.parse(cruxHeader),
    })
  } catch {
    return undefined
  }
}

/** Return lifecycle identity without treating propagated correlators as trusted. */
export function continuationIdentity(carrier: CruxPropagationCarrier): CruxContinuationIdentity {
  const safe = sanitizePropagationCarrier(carrier)
  return {
    runId: safe.crux.runId,
    traceId: traceIdFromTraceparent(safe.traceparent!),
    ...(safe.crux.previousSegmentId ? { previousSegmentId: safe.crux.previousSegmentId } : {}),
    ...(safe.crux.deployment ? { deployment: safe.crux.deployment } : {}),
  }
}

function optionalDeploymentIdentity(
  value: unknown,
): (CruxDeploymentIdentity & JsonObject) | undefined {
  if (value === undefined) return undefined
  return Object.freeze({
    ...CruxDeploymentIdentitySchema.parse(value),
  }) as CruxDeploymentIdentity & JsonObject
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(message)
  return value as Record<string, unknown>
}

function requiredTraceparent(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Invalid Crux continuation: a valid traceparent is required')
  traceIdFromTraceparent(value)
  return value
}

function traceIdFromTraceparent(traceparent: string): CruxTraceId {
  const match = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u.exec(traceparent)
  if (!match || match[1] === 'ff' || /^0+$/u.test(match[2]) || /^0+$/u.test(match[3])) {
    throw new TypeError('Invalid Crux continuation: a valid traceparent is required')
  }
  return match[2] as CruxTraceId
}

function requiredId(value: unknown, pattern: RegExp, name: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`Invalid Crux continuation: ${name} is invalid`)
  return value
}

function optionalId(value: unknown, pattern: RegExp, name: string): string | undefined {
  if (value === undefined) return undefined
  return requiredId(value, pattern, name)
}

function optionalHeader(value: unknown, name: string, maximumLength: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`Invalid Crux continuation: ${name} is invalid`)
  }
  return value
}

function optionalBaggage(value: unknown): string | undefined {
  const baggage = optionalHeader(value, 'baggage', MAX_BAGGAGE_LENGTH)
  if (!baggage) return undefined
  if (baggage.split(',').length > MAX_BAGGAGE_MEMBERS) throw new TypeError('Invalid Crux continuation: baggage has too many members')
  return baggage
}

function optionalCorrelator(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !boundedCorrelator(value)) throw new TypeError(`Invalid Crux continuation: ${name} is invalid`)
  return value
}

function boundedCorrelator(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_CORRELATOR_LENGTH && !/[\u0000-\u001f\u007f]/u.test(value)
}
