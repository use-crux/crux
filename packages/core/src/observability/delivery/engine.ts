import type { CruxGraphRecord } from '../contract'
import type { CruxObservabilityTransport } from '../transport'
import { queuedRecordBytes } from './bytes'
import { sendBatchInChunks } from './chunks'
import { drainDeliveryState } from './drain'
import {
  normalizeDeliveryOptions,
  type NormalizedObservabilityDeliveryOptions,
  type ObservabilityDeliveryOptions,
  type ObservabilityFlushOptions,
  type ObservabilityFlushResult,
} from './options'
import { clearDeliveryRetryTimer, scheduleDeliveryRetry } from './retry'
import {
  deliveryDiagnosticsSnapshot,
  initialDeliveryState,
  publishDeliveryDiagnostics,
  recordDeliveryError,
  sanitizeTransportError,
  sourceHealthSnapshot,
  type DeliveryDiagnostic,
  type DeliveryEngineDiagnostics,
  type DeliveryState,
} from './state'

export type { DeliveryDiagnostic, DeliveryEngineDiagnostics } from './state'

export interface DeliveryEngine {
  currentTransport(): CruxObservabilityTransport | undefined
  setTransport(transport: CruxObservabilityTransport | undefined): void
  deliveryOptions(): NormalizedObservabilityDeliveryOptions
  configureDelivery(options: ObservabilityDeliveryOptions | undefined): void
  enqueue(record: CruxGraphRecord): void
  diagnostics(): DeliveryEngineDiagnostics
  errors(): readonly DeliveryDiagnostic[]
  reset(): void
  flush(options?: ObservabilityFlushOptions): Promise<ObservabilityFlushResult>
  shutdown(options?: ObservabilityFlushOptions): Promise<ObservabilityFlushResult>
}

/** Create an isolated, bounded, receipt-aware delivery engine. */
export function createDeliveryEngine(): DeliveryEngine {
  const state = initialDeliveryState()
  const scheduleDispatch = (): void => {
    if (state.dispatchTimer || state.retryTimer || state.queue.length === 0) return
    if (state.options.scheduledDelayMs === 0) {
      dispatchQueuedRecords(state, scheduleDispatch)
      return
    }
    state.dispatchTimer = setTimeout(() => {
      state.dispatchTimer = undefined
      dispatchQueuedRecords(state, scheduleDispatch)
    }, state.options.scheduledDelayMs)
    unrefTimer(state.dispatchTimer)
  }
  const dispatch = () => dispatchQueuedRecords(state, scheduleDispatch)

  return {
    currentTransport: () => state.transport,
    setTransport(transport) {
      advanceEpoch(state)
      state.transport = transport
      state.accepting = true
    },
    deliveryOptions: () => state.options,
    configureDelivery(options) {
      state.options = normalizeDeliveryOptions(options)
      trimQueue(state)
      publishDeliveryDiagnostics(state)
    },
    enqueue(record) {
      if (!state.transport || !state.accepting) return
      const item = { record, bytes: queuedRecordBytes(record) }
      state.queue.push(item)
      state.queuedBytes += item.bytes
      trimQueue(state)
      scheduleDispatch()
    },
    diagnostics: () => deliveryDiagnosticsSnapshot(state),
    errors: () => state.errors,
    reset: () => resetState(state),
    flush: (options = {}) => drainDeliveryState(state, dispatch, 'flush', options),
    async shutdown(options = {}) {
      state.accepting = false
      const result = await drainDeliveryState(state, dispatch, 'shutdown', options)
      if (result.status === 'drained') state.transport = undefined
      return result
    },
  }
}

function dispatchQueuedRecords(state: DeliveryState, scheduleDispatch: () => void): void {
  clearDispatchTimer(state)
  if (!state.transport) return dropQueueForReconfiguration(state)
  if (state.queue.length === 0 || state.pendingDeliveries.size >= state.options.maxPendingDeliveries) {
    return
  }

  const items = state.queue.splice(0, Math.min(state.queue.length, state.options.maxBatchSize))
  const bytes = items.reduce((sum, item) => sum + item.bytes, 0)
  state.queuedBytes -= bytes
  const records = items.map((item) => item.record)
  const epoch = state.epoch
  const transport = state.transport
  let delivery!: Promise<void>
  const release = () => {
    if (!state.pendingDeliveries.delete(delivery)) return
    state.pendingRecordCount -= records.length
    state.pendingBytes -= bytes
  }
  delivery = sendBatchInChunks(transport, records, {
    sourceHealth: sourceHealthSnapshot(state),
  })
    .then((result) => {
      release()
      if (state.epoch !== epoch) {
        publishDeliveryDiagnostics(state)
        return
      }
      state.accepted += result.accepted.length
      state.permanentlyRejected += result.permanentlyRejected.length
      if (result.permanentlyRejected.length > 0) {
        recordDeliveryError(
          state,
          'permanent_rejection',
          'collector permanently rejected observability records',
          result.permanentlyRejected,
        )
      }
      if (result.retryable.length > 0) {
        state.retried += result.retryable.length
        requeueFront(state, result.retryable)
        clearDispatchTimer(state)
        recordDeliveryError(state, 'delivery_retry', 'observability records will be retried', result.retryable)
        scheduleDeliveryRetry(
          state,
          state.options,
          () => dispatchQueuedRecords(state, scheduleDispatch),
          result.retryAfterMs,
        )
        return
      }
      state.retryAttempt = 0
      publishDeliveryDiagnostics(state)
      if (state.queue.length > 0) scheduleDispatch()
    })
    .catch((error: unknown) => {
      release()
      if (state.epoch !== epoch) {
        publishDeliveryDiagnostics(state)
      } else {
        state.retried += records.length
        requeueFront(state, records)
        recordDeliveryError(state, 'transport_error', sanitizeTransportError(error), records)
        scheduleDeliveryRetry(state, state.options, () => dispatchQueuedRecords(state, scheduleDispatch))
      }
      publishDeliveryDiagnostics(state)
    })
  state.pendingDeliveries.add(delivery)
  state.pendingRecordCount += records.length
  state.pendingBytes += bytes
  trimQueue(state)
}

function requeueFront(state: DeliveryState, records: readonly CruxGraphRecord[]): void {
  const items = records.map((record) => ({
    record,
    bytes: queuedRecordBytes(record),
  }))
  state.queue.unshift(...items)
  state.queuedBytes += items.reduce((sum, item) => sum + item.bytes, 0)
  trimQueue(state)
}

function trimQueue(state: DeliveryState): void {
  let droppedAny = false
  while (
    state.pendingRecordCount + state.queue.length > state.options.maxQueuedRecords ||
    state.pendingBytes + state.queuedBytes > state.options.maxQueuedBytes
  ) {
    const dropped = state.queue.shift()
    if (!dropped) return
    state.queuedBytes -= dropped.bytes
    state.overflowDropped += 1
    state.overflowDroppedBytes += dropped.bytes
    droppedAny = true
  }
  if (droppedAny) publishDeliveryDiagnostics(state)
}

function advanceEpoch(state: DeliveryState): void {
  state.reconfiguredDropped += state.pendingRecordCount
  state.pendingDeliveries.clear()
  state.pendingRecordCount = 0
  state.pendingBytes = 0
  state.epoch += 1
  clearDeliveryRetryTimer(state)
  clearDispatchTimer(state)
}

function resetState(state: DeliveryState): void {
  const droppedOnReset = state.queue.length
  advanceEpoch(state)
  const fresh = initialDeliveryState()
  Object.assign(state, fresh, {
    sourceId: state.sourceId,
    epoch: state.epoch,
    reconfiguredDropped: droppedOnReset,
  })
}

function dropQueueForReconfiguration(state: DeliveryState): void {
  state.reconfiguredDropped += state.queue.length
  state.queue.length = 0
  state.queuedBytes = 0
  publishDeliveryDiagnostics(state)
}

function clearDispatchTimer(state: DeliveryState): void {
  if (!state.dispatchTimer) return
  clearTimeout(state.dispatchTimer)
  state.dispatchTimer = undefined
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeUnref = (timer as { unref?: unknown }).unref
  if (typeof maybeUnref === 'function') maybeUnref.call(timer)
}
