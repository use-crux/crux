import type { CruxGraphRecord } from './contract'
import {
  acceptedDeliveryReceipt,
  type CruxDeliveryAttemptContext,
  type CruxDeliveryDisposition,
  type CruxDeliveryReceipt,
  type CruxObservabilityTransport,
} from './transport'
import { partitionDeliveryReceipt } from './delivery/receipt'
import type { CruxFeedbackDestination } from '../feedback/types'

/**
 * Create a transport that fans each batch out to multiple transports.
 *
 * All legs are attempted. Synchronous throws and asynchronous rejections from
 * one leg are isolated so another leg, such as local devtools, can still
 * receive the batch. A record is accepted when at least one leg accepts it;
 * when no leg accepts it, the combined receipt remains retryable unless every
 * leg permanently rejected that index.
 *
 * @param transports - Transport legs to receive each batch, in call order.
 * @returns A composable transport suitable for `setObservabilityTransport()` or `configureObservability()`.
 *
 * @example
 * ```ts
 * const capture = createInMemoryObservabilityTransport()
 * const auditSink = createHttpObservabilityTransport({ serverUrl: 'http://localhost:4400' })
 * const restore = setObservabilityTransport(teeObservabilityTransport(capture, auditSink))
 *
 * restore()
 * ```
 */
export function teeObservabilityTransport(
  ...transports: readonly CruxObservabilityTransport[]
): CruxObservabilityTransport {
  const feedbackDestinations = transports.filter(isFeedbackDestination)
  if (feedbackDestinations.length > 1) {
    throw new TypeError(
      'teeObservabilityTransport() accepts at most one durable feedback destination; keep capture-only legs without submitFeedback().',
    )
  }
  const feedbackDestination = feedbackDestinations[0]
  let warnedAboutPartialSendFailure = false
  let warnedAboutPartialFlushFailure = false
  let warnedAboutPartialShutdownFailure = false

  return {
    maxRecordsPerRequest: minTransportLimit(transports, 'maxRecordsPerRequest'),
    maxRequestBytes: minTransportLimit(transports, 'maxRequestBytes'),
    ...(feedbackDestination !== undefined
      ? {
          submitFeedback: (submission) =>
            feedbackDestination.submitFeedback(submission),
        }
      : {}),
    async send(records, context) {
      if (transports.length === 0) return acceptedDeliveryReceipt(records)

      const results = await Promise.allSettled(
        transports.map((transport) => sendToTransport(transport, records, context)),
      )
      if (hasFulfilledAndRejected(results)) {
        warnedAboutPartialSendFailure = warnOnceForPartialFailure(
          warnedAboutPartialSendFailure,
          firstRejection(results),
        )
      }
      return combineReceipts(records, results)
    },
    async flush() {
      const results = await Promise.allSettled(transports.map((transport) => runTransportHook(transport, 'flush')))
      if (hasFulfilledAndRejected(results)) {
        warnedAboutPartialFlushFailure = warnOnceForPartialFailure(
          warnedAboutPartialFlushFailure,
          firstRejection(results),
        )
      }
      throwIfEveryLegFailed(results, 'flush')
    },
    async shutdown() {
      const results = await Promise.allSettled(transports.map((transport) => runTransportHook(transport, 'shutdown')))
      if (hasFulfilledAndRejected(results)) {
        warnedAboutPartialShutdownFailure = warnOnceForPartialFailure(
          warnedAboutPartialShutdownFailure,
          firstRejection(results),
        )
      }
      throwIfEveryLegFailed(results, 'shutdown')
    },
  }
}

function isFeedbackDestination(
  transport: CruxObservabilityTransport,
): transport is CruxObservabilityTransport & CruxFeedbackDestination {
  return typeof transport.submitFeedback === 'function'
}

function sendToTransport(
  transport: CruxObservabilityTransport,
  records: readonly CruxGraphRecord[],
  context: CruxDeliveryAttemptContext | undefined,
): Promise<CruxDeliveryReceipt> {
  try {
    return Promise.resolve(transport.send(records, context))
  } catch (error) {
    return Promise.reject(error)
  }
}

function combineReceipts(
  records: readonly CruxGraphRecord[],
  results: readonly PromiseSettledResult<CruxDeliveryReceipt>[],
): CruxDeliveryReceipt {
  const partitions = results.map((result) =>
    result.status === 'fulfilled'
      ? partitionDeliveryReceipt(records, result.value)
      : {
          accepted: [],
          permanentlyRejected: [],
          retryable: records,
          unaccounted: [],
        },
  )
  const dispositions: CruxDeliveryDisposition[] = records.map((record, index) => {
    const acceptedByAnyLeg = partitions.some((partition) => partition.accepted.includes(record))
    const permanentlyRejected = results.every(
      (result, resultIndex) =>
        result.status === 'fulfilled' && partitions[resultIndex]!.permanentlyRejected.includes(record),
    )
    if (acceptedByAnyLeg) {
      return {
        index,
        recordId: record.recordId,
        outcome: 'accepted',
        code: 'accepted',
        retryable: false,
      }
    }
    return {
      index,
      recordId: record.recordId,
      outcome: 'rejected',
      code: permanentlyRejected ? 'tee_permanent_rejection' : 'tee_retry',
      retryable: !permanentlyRejected,
    }
  })
  const retryAfterMs = Math.max(
    0,
    ...results.map((result) => (result.status === 'fulfilled' ? (result.value.retryAfterMs ?? 0) : 0)),
  )
  return { dispositions, ...(retryAfterMs > 0 ? { retryAfterMs } : {}) }
}

function runTransportHook(transport: CruxObservabilityTransport, hook: 'flush' | 'shutdown'): Promise<void> {
  try {
    return Promise.resolve(transport[hook]?.())
  } catch (error) {
    return Promise.reject(error)
  }
}

function minTransportLimit(
  transports: readonly CruxObservabilityTransport[],
  key: 'maxRecordsPerRequest' | 'maxRequestBytes',
): number | undefined {
  let min: number | undefined
  for (const transport of transports) {
    const configured = transport[key]
    if (configured === undefined || !Number.isFinite(configured) || configured <= 0) continue
    min = min === undefined ? configured : Math.min(min, configured)
  }
  return min
}

function hasFulfilledAndRejected<T>(results: readonly PromiseSettledResult<T>[]): boolean {
  return (
    results.some((result) => result.status === 'fulfilled') && results.some((result) => result.status === 'rejected')
  )
}

function firstRejection<T>(results: readonly PromiseSettledResult<T>[]): unknown {
  return results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason
}

function warnOnceForPartialFailure(alreadyWarned: boolean, error: unknown): boolean {
  if (alreadyWarned) return true
  console.warn('[crux] observability tee transport leg failed; continuing with successful leg(s).', error)
  return true
}

function throwIfEveryLegFailed(results: readonly PromiseSettledResult<void>[], hook: 'flush' | 'shutdown'): void {
  if (results.length === 0) return
  if (results.some((result) => result.status === 'fulfilled')) return
  const failure = firstRejection(results)
  throw failure instanceof Error
    ? failure
    : new Error(`Crux observability tee transport ${hook} failed: ${String(failure)}`)
}
