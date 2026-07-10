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
import { activeHostLifecycle } from './host-scope'
import {
  deliveryDiagnosticsSnapshot,
  initialDeliveryState,
  notifySupersededChange,
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
  const generation = state.generation
  const transport = state.transport
  let delivery!: Promise<void>
  const release = () => {
    // `epoch` (not Set membership) decides the bucket: it stays valid even
    // once this delivery's promise reference has been pruned from
    // `supersededDeliveries` to keep that set bounded, so the aggregate
    // counters are still decremented exactly once.
    if (state.epoch === epoch) {
      state.pendingDeliveries.delete(delivery)
      state.pendingRecordCount -= records.length
      state.pendingBytes -= bytes
      return
    }
    state.supersededDeliveries.delete(delivery)
    state.supersededRecordCount -= records.length
    state.supersededBytes -= bytes
    notifySupersededChange(state)
  }
  delivery = sendBatchInChunks(transport, records, {
    sourceHealth: sourceHealthSnapshot(state),
  })
    .then((result) => {
      // A full runtime reset happened after this delivery was dispatched.
      // The state object was reused (not replaced), so without this guard a
      // late settlement would still mutate the fresh runtime's counters.
      if (state.generation !== generation) return
      release()
      if (state.epoch !== epoch) {
        // The transport that produced this receipt has been replaced, but
        // what it actually decided is still truthful: accepted/rejected
        // records were genuinely delivered/refused by it. Only records it
        // left retryable are truly lost to reconfiguration, because they
        // will not be requeued against a transport they were never sent to.
        state.accepted += result.accepted.length
        state.permanentlyRejected += result.permanentlyRejected.length
        state.reconfiguredDropped += result.retryable.length
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
          (wait) => deferToHostLifecycle(state, wait),
        )
        return
      }
      state.retryAttempt = 0
      publishDeliveryDiagnostics(state)
      if (state.queue.length > 0) scheduleDispatch()
    })
    .catch((error: unknown) => {
      if (state.generation !== generation) return
      release()
      if (state.epoch !== epoch) {
        // This stale transport never produced a receipt for these records;
        // reconfiguration truthfully drops them since they will not be
        // requeued against a transport they were never sent to.
        state.reconfiguredDropped += records.length
        publishDeliveryDiagnostics(state)
        return
      }
      state.retried += records.length
      requeueFront(state, records)
      recordDeliveryError(state, 'transport_error', sanitizeTransportError(error), records)
      scheduleDeliveryRetry(
        state,
        state.options,
        () => dispatchQueuedRecords(state, scheduleDispatch),
        undefined,
        (wait) => deferToHostLifecycle(state, wait),
      )
      publishDeliveryDiagnostics(state)
    })
  state.pendingDeliveries.add(delivery)
  state.pendingRecordCount += records.length
  state.pendingBytes += bytes
  trimQueue(state)
  deferToHostLifecycle(state, delivery)
}

function deferToHostLifecycle(state: DeliveryState, delivery: Promise<void>): void {
  try {
    const hostLifecycle = activeHostLifecycle() ?? state.options.hostLifecycle
    hostLifecycle?.defer?.(delivery)
  } catch {
    // Host defer failures never affect delivery; the promise still settles on its own.
  }
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
  // In-flight deliveries from the superseded epoch are not dropped here and
  // are not silently forgotten either: they move to `supersededDeliveries`,
  // tracked apart from the new epoch's `pendingDeliveries` (so they never
  // block the new transport's own maxPendingDeliveries budget) but still
  // counted in `remainingRecords` and awaited by drain until each settles on
  // its own and truthfully accounts itself (see `dispatchQueuedRecords`).
  //
  // The retained promise references are bounded by `maxPendingDeliveries` -
  // the same cap that already bounds one epoch's own concurrent in-flight
  // sends - so repeated reconfigurations against hung transports cannot grow
  // this set without bound. Aggregate counters below stay exact regardless;
  // `release()` decrements them by comparing captured epoch, not Set
  // membership, so a pruned delivery is still accounted for truthfully once
  // it settles (see `dispatchQueuedRecords`).
  for (const delivery of state.pendingDeliveries) {
    if (state.supersededDeliveries.size < state.options.maxPendingDeliveries) {
      state.supersededDeliveries.add(delivery)
    }
  }
  state.supersededRecordCount += state.pendingRecordCount
  state.supersededBytes += state.pendingBytes
  state.pendingDeliveries.clear()
  state.pendingRecordCount = 0
  state.pendingBytes = 0
  state.epoch += 1
  clearDeliveryRetryTimer(state)
  clearDispatchTimer(state)
}

function resetState(state: DeliveryState): void {
  // A full runtime reset (unlike a transport reconfiguration) intentionally
  // tears everything down, including any still-unsettled superseded sends;
  // `fresh` below drops their tracking. Only the never-sent queue is counted
  // here, matching prior reset accounting. Bumping `generation` makes any
  // stale delivery that later settles a no-op against the fresh runtime
  // reused in this same `state` object (see `dispatchQueuedRecords`).
  const droppedOnReset = state.queue.length
  const nextGeneration = state.generation + 1
  advanceEpoch(state)
  const fresh = initialDeliveryState()
  Object.assign(state, fresh, {
    sourceId: state.sourceId,
    epoch: state.epoch,
    generation: nextGeneration,
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
