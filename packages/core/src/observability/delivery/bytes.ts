import {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  type CruxGraphRecord,
} from '../contract'
import type { CruxDeliveryAttemptContext } from './receipt'

const encoder = new TextEncoder()
const QUEUE_ENVELOPE_OVERHEAD_PER_RECORD = 512

/** Exact UTF-8 byte length of a string in edge and Node runtimes. */
export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength
}

/** Serialize the exact current-version HTTP request envelope. */
export function serializeDeliveryEnvelope(
  records: readonly CruxGraphRecord[],
  context?: CruxDeliveryAttemptContext,
): string {
  return JSON.stringify({
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    records,
    ...(context ? { sourceHealth: context.sourceHealth } : {}),
  })
}

/** Exact UTF-8 bytes used by the current-version HTTP request envelope. */
export function deliveryEnvelopeBytes(
  records: readonly CruxGraphRecord[],
  context?: CruxDeliveryAttemptContext,
): number {
  return utf8ByteLength(serializeDeliveryEnvelope(records, context))
}

/** Safe queue accounting bound for one already-sanitized graph record. */
export function queuedRecordBytes(record: CruxGraphRecord): number {
  return utf8ByteLength(JSON.stringify(record)) + QUEUE_ENVELOPE_OVERHEAD_PER_RECORD
}
