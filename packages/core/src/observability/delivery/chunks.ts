import type { CruxGraphRecord } from '../contract'
import { CruxObservabilityIngestError, type CruxObservabilityTransport } from '../transport'

const DEFAULT_MAX_RECORDS_PER_REQUEST = 50

export interface ChunkDeliveryResult {
  readonly ok: boolean
  readonly failedRecords: readonly CruxGraphRecord[]
  readonly error?: unknown
  readonly poisonDropped: number
}

/**
 * Send a delivery-engine batch through transport-sized chunks.
 *
 * Successful leading chunks are never included in `failedRecords`; callers can
 * requeue the returned suffix to preserve at-least-once delivery without
 * duplicating chunks already accepted by the transport.
 */
export async function sendBatchInChunks(
  transport: CruxObservabilityTransport,
  batch: readonly CruxGraphRecord[],
): Promise<ChunkDeliveryResult> {
  const chunkSize = transportMaxRecordsPerRequest(transport)
  let poisonDropped = 0

  for (let index = 0; index < batch.length; index += chunkSize) {
    const chunk = batch.slice(index, index + chunkSize)
    try {
      await Promise.resolve(transport.send(chunk))
    } catch (error) {
      if (error instanceof CruxObservabilityIngestError) {
        poisonDropped += error.failed
        continue
      }
      return {
        ok: false,
        failedRecords: batch.slice(index),
        error,
        poisonDropped,
      }
    }
  }

  return {
    ok: true,
    failedRecords: [],
    poisonDropped,
  }
}

function transportMaxRecordsPerRequest(transport: CruxObservabilityTransport): number {
  const configured = transport.maxRecordsPerRequest
  if (configured === undefined || !Number.isFinite(configured)) return DEFAULT_MAX_RECORDS_PER_REQUEST
  return Math.max(1, Math.trunc(configured))
}
