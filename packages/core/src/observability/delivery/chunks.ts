import type { CruxGraphRecord } from '../contract'
import type { CruxObservabilityTransport } from '../transport'
import { deliveryEnvelopeBytes } from './bytes'
import { partitionDeliveryReceipt, type CruxDeliveryAttemptContext } from './receipt'

const DEFAULT_MAX_RECORDS_PER_REQUEST = 50
const DEFAULT_MAX_REQUEST_BYTES = 1024 * 1024

export interface ChunkDeliveryResult {
  readonly accepted: readonly CruxGraphRecord[]
  readonly permanentlyRejected: readonly CruxGraphRecord[]
  readonly retryable: readonly CruxGraphRecord[]
  readonly retryAfterMs: number
  readonly error?: unknown
}

/** Partition every record in an engine batch through receipt-aware requests. */
export async function sendBatchInChunks(
  transport: CruxObservabilityTransport,
  batch: readonly CruxGraphRecord[],
  context: CruxDeliveryAttemptContext,
): Promise<ChunkDeliveryResult> {
  const requests = chunkRequests(transport, batch, context)
  const accepted: CruxGraphRecord[] = []
  const permanentlyRejected: CruxGraphRecord[] = [...requests.oversized]
  const retryableSet = new Set<CruxGraphRecord>()
  let retryAfterMs = 0

  for (let requestIndex = 0; requestIndex < requests.chunks.length; requestIndex += 1) {
    const chunk = requests.chunks[requestIndex]!
    try {
      const receipt = await transport.send(chunk, context)
      const partition = partitionDeliveryReceipt(chunk, receipt)
      accepted.push(...partition.accepted)
      permanentlyRejected.push(...partition.permanentlyRejected)
      for (const record of [...partition.retryable, ...partition.unaccounted]) retryableSet.add(record)
      retryAfterMs = Math.max(retryAfterMs, receipt.retryAfterMs ?? 0)
    } catch (error) {
      for (const record of chunk) retryableSet.add(record)
      for (const later of requests.chunks.slice(requestIndex + 1)) {
        for (const record of later) retryableSet.add(record)
      }
      return {
        accepted,
        permanentlyRejected,
        retryable: batch.filter((record) => retryableSet.has(record)),
        retryAfterMs: retryAfterFromError(error),
        error,
      }
    }
  }

  return {
    accepted,
    permanentlyRejected,
    retryable: batch.filter((record) => retryableSet.has(record)),
    retryAfterMs,
  }
}

function chunkRequests(
  transport: CruxObservabilityTransport,
  batch: readonly CruxGraphRecord[],
  context: CruxDeliveryAttemptContext,
): { chunks: CruxGraphRecord[][]; oversized: CruxGraphRecord[] } {
  const maxRecords = normalizedLimit(transport.maxRecordsPerRequest, DEFAULT_MAX_RECORDS_PER_REQUEST)
  const maxBytes = normalizedLimit(transport.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES)
  const chunks: CruxGraphRecord[][] = []
  const oversized: CruxGraphRecord[] = []
  let current: CruxGraphRecord[] = []

  for (const record of batch) {
    if (deliveryEnvelopeBytes([record], context) > maxBytes) {
      if (current.length > 0) chunks.push(current)
      current = []
      oversized.push(record)
      continue
    }
    const candidate = [...current, record]
    if (current.length > 0 && (candidate.length > maxRecords || deliveryEnvelopeBytes(candidate, context) > maxBytes)) {
      chunks.push(current)
      current = [record]
    } else {
      current = candidate
    }
  }
  if (current.length > 0) chunks.push(current)
  return { chunks, oversized }
}

function normalizedLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value!)) : fallback
}

function retryAfterFromError(error: unknown): number {
  if (!error || typeof error !== 'object') return 0
  const retryAfterMs = (error as { retryAfterMs?: unknown }).retryAfterMs
  return typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0
}
