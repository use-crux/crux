import type { CruxGraphRecord } from './contract'
import type { CruxObservabilityTransport } from './transport'

/**
 * Create a transport that fans each batch out to multiple transports.
 *
 * All legs are attempted. Synchronous throws and asynchronous rejections from
 * one leg are isolated so another leg, such as local devtools, can still
 * receive the batch. If every configured leg fails, the tee rejects with the
 * first failure so the delivery engine can retry the whole batch later.
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
  let warnedAboutPartialSendFailure = false
  let warnedAboutPartialFlushFailure = false
  let warnedAboutPartialShutdownFailure = false

  return {
    maxRecordsPerRequest: minMaxRecordsPerRequest(transports),
    async send(records) {
      if (transports.length === 0) return

      const results = await Promise.allSettled(transports.map((transport) => sendToTransport(transport, records)))
      if (hasFulfilledAndRejected(results)) {
        warnedAboutPartialSendFailure = warnOnceForPartialFailure(warnedAboutPartialSendFailure, firstRejection(results))
      }
      if (results.some((result) => result.status === 'fulfilled')) return

      const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      throw firstFailure?.reason instanceof Error
        ? firstFailure.reason
        : new Error(`Crux observability tee transport failed: ${String(firstFailure?.reason)}`)
    },
    async flush() {
      const results = await Promise.allSettled(transports.map((transport) => runTransportHook(transport, 'flush')))
      if (hasFulfilledAndRejected(results)) {
        warnedAboutPartialFlushFailure = warnOnceForPartialFailure(warnedAboutPartialFlushFailure, firstRejection(results))
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

function sendToTransport(
  transport: CruxObservabilityTransport,
  records: readonly CruxGraphRecord[],
): Promise<void> {
  try {
    return Promise.resolve(transport.send(records))
  } catch (error) {
    return Promise.reject(error)
  }
}

function runTransportHook(
  transport: CruxObservabilityTransport,
  hook: 'flush' | 'shutdown',
): Promise<void> {
  try {
    return Promise.resolve(transport[hook]?.())
  } catch (error) {
    return Promise.reject(error)
  }
}

function minMaxRecordsPerRequest(transports: readonly CruxObservabilityTransport[]): number | undefined {
  let min: number | undefined
  for (const transport of transports) {
    const configured = transport.maxRecordsPerRequest
    if (configured === undefined || !Number.isFinite(configured) || configured <= 0) continue
    min = min === undefined ? configured : Math.min(min, configured)
  }
  return min
}

function hasFulfilledAndRejected(results: readonly PromiseSettledResult<void>[]): boolean {
  return results.some((result) => result.status === 'fulfilled') && results.some((result) => result.status === 'rejected')
}

function firstRejection(results: readonly PromiseSettledResult<void>[]): unknown {
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
