import type { CruxGraphRecord, CruxObservabilityTransport } from '../../../observability'

export type ChaosTransportMode = 'hang' | 'sync-throw' | 'reject' | 'partial-chunk-fail' | 'slow' | 'flap' | 'http-400'

export interface ChaosTransportCall {
  readonly records: readonly CruxGraphRecord[]
}

export interface ChaosTransportController {
  readonly transport: CruxObservabilityTransport
  readonly calls: readonly ChaosTransportCall[]
  readonly batches: readonly (readonly CruxGraphRecord[])[]
  readonly sendCount: number
  setMode(mode: ChaosTransportMode): void
  resolveSlowDeliveries(): void
  reset(): void
}

interface HttpStatusError extends Error {
  readonly status: number
}

/**
 * Creates a deterministic observability transport for failure-mode tests.
 *
 * The helper records every attempted batch before applying the selected chaos
 * behavior, so tests can assert both what the delivery engine attempted and
 * whether later retries/flushes preserved the original records.
 */
export function chaosTransport(mode: ChaosTransportMode): ChaosTransportController {
  const calls: ChaosTransportCall[] = []
  const slowResolvers = new Set<() => void>()
  let currentMode = mode
  let failedFlap = false

  const transport: CruxObservabilityTransport = {
    send(records) {
      const batch = [...records]
      calls.push({ records: batch })

      switch (currentMode) {
        case 'hang':
          return new Promise(() => undefined)
        case 'sync-throw':
          throw new Error('chaos transport sync throw')
        case 'reject':
          return Promise.reject(new Error('chaos transport rejected'))
        case 'partial-chunk-fail':
          if (calls.length === 2) return Promise.reject(new Error('chaos transport chunk failed'))
          return undefined
        case 'slow':
          return new Promise<void>((resolve) => {
            slowResolvers.add(resolve)
          })
        case 'flap':
          if (!failedFlap) {
            failedFlap = true
            return Promise.reject(new Error('chaos transport flap failed'))
          }
          return undefined
        case 'http-400':
          return Promise.reject(httpStatusError(400, 'chaos transport HTTP 400'))
      }
    },
  }

  return {
    transport,
    get calls() {
      return calls
    },
    get batches() {
      return calls.map((call) => call.records)
    },
    get sendCount() {
      return calls.length
    },
    setMode(nextMode) {
      currentMode = nextMode
    },
    resolveSlowDeliveries() {
      for (const resolve of slowResolvers) {
        resolve()
      }
      slowResolvers.clear()
    },
    reset() {
      calls.length = 0
      slowResolvers.clear()
      failedFlap = false
    },
  }
}

function httpStatusError(status: number, message: string): HttpStatusError {
  const error = new Error(message) as HttpStatusError
  Object.defineProperty(error, 'status', {
    value: status,
    enumerable: true,
  })
  return error
}
