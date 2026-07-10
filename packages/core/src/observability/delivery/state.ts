import type { CruxGraphRecord, CruxRecordId } from '../contract'
import { createCruxSegmentId } from '../ids'
import type { CruxObservabilityTransport } from '../transport'
import { defaultDeliveryOptions, type NormalizedObservabilityDeliveryOptions } from './options'
import type { DeliveryRetryState } from './retry'
import type { CruxDeliverySourceHealth } from './receipt'

const DELIVERY_ERROR_RING_CAP = 100

export interface DeliveryDiagnostic {
  readonly code: string
  readonly message?: string
  readonly recordIds?: readonly CruxRecordId[]
}

export interface DeliveryEngineDiagnostics extends CruxDeliverySourceHealth {
  readonly pendingDeliveries: number
  readonly queuedRecords: number
  readonly queuedBytes: number
  readonly droppedRecords: number
  readonly deliveryErrorCount: number
  readonly deliveryErrors: readonly DeliveryDiagnostic[]
  readonly acceptedRecords: number
  readonly retriedRecords: number
  readonly permanentlyRejectedRecords: number
  readonly overflowDroppedRecords: number
  readonly overflowDroppedBytes: number
  readonly deadlineDroppedRecords: number
  readonly reconfiguredDroppedRecords: number
}

export interface QueuedRecord {
  readonly record: CruxGraphRecord
  readonly bytes: number
}

export interface DeliveryState extends DeliveryRetryState {
  transport: CruxObservabilityTransport | undefined
  options: NormalizedObservabilityDeliveryOptions
  readonly sourceId: string
  readonly pendingDeliveries: Set<Promise<void>>
  pendingRecordCount: number
  pendingBytes: number
  readonly queue: QueuedRecord[]
  queuedBytes: number
  dispatchTimer: ReturnType<typeof setTimeout> | undefined
  readonly errors: DeliveryDiagnostic[]
  lastError: DeliveryDiagnostic | undefined
  deliveryErrorCount: number
  accepted: number
  retried: number
  permanentlyRejected: number
  overflowDropped: number
  overflowDroppedBytes: number
  deadlineDropped: number
  reconfiguredDropped: number
  epoch: number
  accepting: boolean
}

export function initialDeliveryState(): DeliveryState {
  return {
    transport: undefined,
    options: defaultDeliveryOptions(),
    sourceId: `source_${createCruxSegmentId().slice(4)}`,
    pendingDeliveries: new Set(),
    pendingRecordCount: 0,
    pendingBytes: 0,
    queue: [],
    queuedBytes: 0,
    retryTimer: undefined,
    dispatchTimer: undefined,
    retryAttempt: 0,
    errors: [],
    lastError: undefined,
    deliveryErrorCount: 0,
    accepted: 0,
    retried: 0,
    permanentlyRejected: 0,
    overflowDropped: 0,
    overflowDroppedBytes: 0,
    deadlineDropped: 0,
    reconfiguredDropped: 0,
    epoch: 0,
    accepting: true,
  }
}

export function recordDeliveryError(
  state: DeliveryState,
  code: string,
  message?: string,
  records: readonly CruxGraphRecord[] = [],
): void {
  const diagnostic: DeliveryDiagnostic = {
    code,
    ...(message ? { message } : {}),
    ...(records.length > 0 ? { recordIds: records.slice(0, 16).map((record) => record.recordId) } : {}),
  }
  state.lastError = diagnostic
  state.deliveryErrorCount += 1
  state.errors.push(diagnostic)
  if (state.errors.length > DELIVERY_ERROR_RING_CAP) {
    state.errors.splice(0, state.errors.length - DELIVERY_ERROR_RING_CAP)
  }
  publishDeliveryDiagnostics(state)
}

export function deliveryDiagnosticsSnapshot(state: DeliveryState): DeliveryEngineDiagnostics {
  return {
    ...sourceHealthSnapshot(state),
    pendingDeliveries: state.pendingDeliveries.size,
    queuedRecords: state.queue.length,
    queuedBytes: state.queuedBytes + state.pendingBytes,
    droppedRecords:
      state.permanentlyRejected + state.overflowDropped + state.deadlineDropped + state.reconfiguredDropped,
    deliveryErrorCount: state.deliveryErrorCount,
    deliveryErrors: [...state.errors],
    acceptedRecords: state.accepted,
    retriedRecords: state.retried,
    permanentlyRejectedRecords: state.permanentlyRejected,
    overflowDroppedRecords: state.overflowDropped,
    overflowDroppedBytes: state.overflowDroppedBytes,
    deadlineDroppedRecords: state.deadlineDropped,
    reconfiguredDroppedRecords: state.reconfiguredDropped,
  }
}

export function sourceHealthSnapshot(state: DeliveryState): CruxDeliverySourceHealth {
  return {
    sourceId: state.sourceId,
    accepted: state.accepted,
    retried: state.retried,
    permanentlyRejected: state.permanentlyRejected,
    overflowDropped: state.overflowDropped,
    deadlineDropped: state.deadlineDropped,
    ...(state.lastError
      ? {
          lastError: {
            code: state.lastError.code,
            ...(state.lastError.message ? { message: state.lastError.message } : {}),
          },
        }
      : {}),
  }
}

export function publishDeliveryDiagnostics(state: DeliveryState): void {
  try {
    state.options.onDiagnostics?.(sourceHealthSnapshot(state))
  } catch {
    // Diagnostics are deliberately non-recursive and never affect delivery.
  }
}

export function remainingRecords(state: DeliveryState): number {
  return state.queue.length + state.pendingRecordCount
}

export function sanitizeTransportError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'observability transport failed'
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? `observability transport failed (${status})` : 'observability transport failed'
}
