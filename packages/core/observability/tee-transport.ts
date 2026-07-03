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
  return {
    async send(records) {
      if (transports.length === 0) return

      const results = await Promise.allSettled(transports.map((transport) => sendToTransport(transport, records)))
      if (results.some((result) => result.status === 'fulfilled')) return

      const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      throw firstFailure?.reason instanceof Error
        ? firstFailure.reason
        : new Error(`Crux observability tee transport failed: ${String(firstFailure?.reason)}`)
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
