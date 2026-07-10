import type { CruxRunId, CruxSegmentId, CruxSpanId, CruxTraceId } from './contract'
import type { CruxCorrelators } from './correlators'
import { createCruxSpanId } from './ids'

/** Serializable correlation required to continue one logical run in a fresh segment. */
export interface CruxPropagationCarrier {
  traceparent?: string
  tracestate?: string
  baggage?: string
  crux: {
    runId: CruxRunId | string
    previousSegmentId?: CruxSegmentId | string
    parentSpanId?: CruxSpanId | string
    sessionId?: string
    userId?: string
  }
}

export interface CruxContinuationIdentity {
  runId: CruxRunId
  traceId: CruxTraceId
  previousSegmentId?: CruxSegmentId
  correlators?: CruxCorrelators
}

/** @internal Phase 4 adds boundary-specific trust and sanitization helpers. */
export function createPropagationCarrier(identity: CruxContinuationIdentity): CruxPropagationCarrier {
  return {
    traceparent: `00-${identity.traceId}-${createCruxSpanId()}-01`,
    crux: {
      runId: identity.runId,
      ...(identity.previousSegmentId ? { previousSegmentId: identity.previousSegmentId } : {}),
      ...(identity.correlators?.sessionId ? { sessionId: identity.correlators.sessionId } : {}),
      ...(identity.correlators?.userId ? { userId: identity.correlators.userId } : {}),
    },
  }
}

/** @internal Validate the identity needed by the lifecycle owner without trusting it for authorization. */
export function continuationIdentity(carrier: CruxPropagationCarrier): CruxContinuationIdentity {
  const traceId = traceIdFromTraceparent(carrier.traceparent)
  if (!carrier.crux || typeof carrier.crux.runId !== 'string' || carrier.crux.runId.length === 0) {
    throw new TypeError('Invalid Crux continuation: crux.runId is required')
  }
  const previousSegmentId = carrier.crux.previousSegmentId
  if (previousSegmentId !== undefined && (typeof previousSegmentId !== 'string' || previousSegmentId.length === 0)) {
    throw new TypeError('Invalid Crux continuation: previousSegmentId must be non-empty')
  }
  return {
    runId: carrier.crux.runId as CruxRunId,
    traceId,
    ...(previousSegmentId ? { previousSegmentId: previousSegmentId as CruxSegmentId } : {}),
    correlators: {
      ...(carrier.crux.sessionId ? { sessionId: carrier.crux.sessionId } : {}),
      ...(carrier.crux.userId ? { userId: carrier.crux.userId } : {}),
    },
  }
}

function traceIdFromTraceparent(traceparent: string | undefined): CruxTraceId {
  const match = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/u.exec(traceparent ?? '')
  if (!match || /^0+$/u.test(match[1] ?? '')) {
    throw new TypeError('Invalid Crux continuation: a valid traceparent is required')
  }
  return match[1] as CruxTraceId
}
