import type { CruxGraphRecord } from './contract'
import type { CruxFeedbackDestination } from '../feedback/types'
import type { CruxEvidenceQueryDestination } from '../evidence/destination'
import {
  acceptedDeliveryReceipt,
  type CruxDeliveryAttemptContext,
  type CruxDeliveryReceipt,
} from './delivery/receipt'

export type {
  CruxDeliveryAttemptContext,
  CruxDeliveryDisposition,
  CruxDeliveryReceipt,
  CruxDeliverySourceHealth,
} from './delivery/receipt'
export { acceptedDeliveryReceipt } from './delivery/receipt'
export {
  createHttpObservabilityTransport,
  type HttpObservabilityTransportOptions,
} from './http-transport'

/** Receipt-aware boundary for canonical observability graph delivery. */
export interface CruxObservabilityTransport extends Partial<CruxFeedbackDestination> {
  /** Optional readable evidence capability owned by this canonical destination. */
  readonly evidence?: CruxEvidenceQueryDestination
  /**
   * Deliver records and account for every submitted index.
   *
   * Missing, duplicate, or ID-mismatched dispositions are retryable. A
   * transport must therefore never report success through HTTP status alone.
   */
  send(
    records: readonly CruxGraphRecord[],
    context?: CruxDeliveryAttemptContext,
  ): CruxDeliveryReceipt | Promise<CruxDeliveryReceipt>
  /** Maximum records passed to one `send()` call. @default 50 */
  maxRecordsPerRequest?: number
  /** Maximum exact UTF-8 request bytes passed to one `send()` call. @default 1048576 */
  maxRequestBytes?: number
  /** Drain transport-owned buffers after the delivery queue drains. */
  flush?(): Promise<void>
  /** Final transport drain and resource release. */
  shutdown?(): Promise<void>
}

export interface InMemoryObservabilityTransport extends CruxObservabilityTransport {
  readonly records: CruxGraphRecord[]
  clear(): void
}

/** Create a deterministic receipt-aware transport for local capture and tests. */
export function createInMemoryObservabilityTransport(): InMemoryObservabilityTransport {
  const records: CruxGraphRecord[] = []
  return {
    records,
    send(batch) {
      records.push(...batch)
      return acceptedDeliveryReceipt(batch)
    },
    clear() {
      records.length = 0
    },
  }
}
