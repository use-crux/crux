import type { CruxGraphRecord } from '../contract'
import type { CruxObservabilityTransport } from '../transport'
import {
  defaultDeliveryOptions,
  normalizeDeliveryOptions,
  type NormalizedObservabilityDeliveryOptions,
  type ObservabilityDeliveryOptions,
  type ObservabilityFlushOptions,
} from './options'
import { sendBatchInChunks } from './chunks'
import { runTransportHook, type TransportHook } from './hooks'
import { clearDeliveryRetryTimer, scheduleDeliveryRetry, type DeliveryRetryState } from './retry'
import { deliveryTimeoutSignal } from './timeout'

const DELIVERY_ERROR_RING_CAP = 100
const FLUSH_FAILURE_RETRY_DELAY_MS = 25

export interface DeliveryEngineDiagnostics {
  readonly pendingDeliveries: number
  readonly droppedRecords: number
  readonly deliveryErrors: readonly unknown[]
}

interface DeliveryState {
  transport: CruxObservabilityTransport | undefined
  options: NormalizedObservabilityDeliveryOptions
  readonly pendingDeliveries: Set<Promise<void>>
  pendingRecordCount: number
  readonly deliveryErrors: unknown[]
  readonly queuedRecords: CruxGraphRecord[]
  retryTimer: DeliveryRetryState['retryTimer']
  dispatchTimer: ReturnType<typeof setTimeout> | undefined
  retryAttempt: number
  droppedRecords: number
  deliveryFailureCount: number
  epoch: number
}

export interface DeliveryEngine {
  currentTransport(): CruxObservabilityTransport | undefined
  setTransport(transport: CruxObservabilityTransport | undefined): void
  deliveryOptions(): NormalizedObservabilityDeliveryOptions
  configureDelivery(options: ObservabilityDeliveryOptions | undefined): void
  enqueue(record: CruxGraphRecord): void
  diagnostics(): DeliveryEngineDiagnostics
  errors(): readonly unknown[]
  reset(): void
  flush(options?: ObservabilityFlushOptions): Promise<boolean>
  shutdown(options?: ObservabilityFlushOptions): Promise<boolean>
}

/**
 * Create an isolated observability delivery engine.
 *
 * The engine keeps asynchronous transport failures behind a closure boundary:
 * callers enqueue validated records, configure the active transport, and ask
 * for flush/shutdown. Queue trimming, synchronous transport throw containment,
 * and drop accounting are handled without exposing transport failures to code
 * that emitted the records.
 */
export function createDeliveryEngine(): DeliveryEngine {
  const state: DeliveryState = {
    transport: undefined,
    options: defaultDeliveryOptions(),
    pendingDeliveries: new Set<Promise<void>>(),
    pendingRecordCount: 0,
    deliveryErrors: [],
    queuedRecords: [],
    retryTimer: undefined,
    dispatchTimer: undefined,
    retryAttempt: 0,
    droppedRecords: 0,
    deliveryFailureCount: 0,
    epoch: 0,
  }

  const scheduleDispatch = (): void => {
    if (state.dispatchTimer) return
    if (state.options.scheduledDelayMs === 0) {
      dispatchQueuedRecords(state, scheduleDispatch)
      return
    }
    state.dispatchTimer = setTimeout(() => {
      state.dispatchTimer = undefined
      dispatchQueuedRecords(state, scheduleDispatch)
    }, state.options.scheduledDelayMs)
    state.dispatchTimer.unref?.()
  }

  return {
    currentTransport() {
      return state.transport
    },

    setTransport(transport) {
      advanceEpoch(state)
      state.transport = transport
    },

    deliveryOptions() {
      return state.options
    },

    configureDelivery(options) {
      state.options = normalizeDeliveryOptions(options)
      trimQueuedRecordsToBound(state)
    },

    enqueue(record) {
      if (!state.transport) return

      state.queuedRecords.push(record)
      trimQueuedRecordsToBound(state)
      scheduleDispatch()
    },

    diagnostics() {
      return {
        pendingDeliveries: state.pendingDeliveries.size,
        droppedRecords: state.droppedRecords,
        deliveryErrors: state.deliveryErrors,
      }
    },

    errors() {
      return state.deliveryErrors
    },

    reset() {
      resetDeliveryState(state)
    },

    async flush(options: ObservabilityFlushOptions = {}) {
      return await flushDeliveryState(state, scheduleDispatch, 'flush', options)
    },

    async shutdown(options: ObservabilityFlushOptions = {}) {
      const flushed = await flushDeliveryState(state, scheduleDispatch, 'shutdown', options)
      state.transport = undefined
      return flushed
    },
  }
}

function dispatchQueuedRecords(state: DeliveryState, scheduleDispatch: () => void): void {
  clearScheduledDispatch(state)
  const transport = state.transport
  if (!transport) {
    dropQueuedRecords(state)
    return
  }
  if (state.queuedRecords.length === 0) return
  if (state.pendingDeliveries.size >= state.options.maxPendingDeliveries) return

  const batch = state.queuedRecords.splice(0, Math.min(state.queuedRecords.length, state.options.maxBatchSize))
  const capturedEpoch = state.epoch

  let failed = false
  let delivery!: Promise<void>
  delivery = sendBatchInChunks(transport, batch)
    .then((result) => {
      if (result.poisonDropped > 0) state.droppedRecords += result.poisonDropped
      if (result.ok) return
      failed = true
      recordDeliveryError(state, result.error)
      handleDeliveryFailure(state, result.failedRecords, capturedEpoch, scheduleDispatch)
    })
    .finally(() => {
      if (state.pendingDeliveries.delete(delivery)) {
        state.pendingRecordCount -= batch.length
      }
      if (!failed) {
        state.retryAttempt = 0
        if (state.queuedRecords.length > 0) scheduleDispatch()
      }
    })

  state.pendingDeliveries.add(delivery)
  state.pendingRecordCount += batch.length
  trimQueuedRecordsToBound(state)
}

function handleDeliveryFailure(
  state: DeliveryState,
  batch: readonly CruxGraphRecord[],
  capturedEpoch: number,
  scheduleDispatch: () => void,
): void {
  if (batch.length === 0) return
  if (state.epoch !== capturedEpoch) {
    state.droppedRecords += batch.length
    return
  }
  requeueFront(state, batch)
  scheduleDeliveryRetry(state, state.options, () => dispatchQueuedRecords(state, scheduleDispatch))
}

function requeueFront(state: DeliveryState, records: readonly CruxGraphRecord[]): void {
  state.queuedRecords.unshift(...records)
  trimQueuedRecordsToBound(state)
}

function trimQueuedRecordsToBound(state: DeliveryState): void {
  while (state.pendingRecordCount + state.queuedRecords.length > state.options.maxQueuedRecords) {
    if (state.queuedRecords.shift() === undefined) return
    state.droppedRecords += 1
  }
}

function dropQueuedRecords(state: DeliveryState): void {
  state.droppedRecords += state.queuedRecords.length
  state.queuedRecords.length = 0
}

function recordDeliveryError(state: DeliveryState, error: unknown): void {
  state.deliveryFailureCount += 1
  state.deliveryErrors.push(error)
  if (state.deliveryErrors.length > DELIVERY_ERROR_RING_CAP) {
    state.deliveryErrors.splice(0, state.deliveryErrors.length - DELIVERY_ERROR_RING_CAP)
  }
}

function resetDeliveryState(state: DeliveryState): void {
  const droppedOnReset = state.queuedRecords.length
  advanceEpoch(state)
  clearScheduledDispatch(state)
  state.queuedRecords.length = 0
  state.pendingDeliveries.clear()
  state.pendingRecordCount = 0
  state.deliveryErrors.length = 0
  state.droppedRecords = droppedOnReset
  state.deliveryFailureCount = 0
  state.retryAttempt = 0
  state.transport = undefined
  state.options = defaultDeliveryOptions()
}

function advanceEpoch(state: DeliveryState): void {
  state.epoch += 1
  clearDeliveryRetryTimer(state)
  clearScheduledDispatch(state)
}

function clearScheduledDispatch(state: DeliveryState): void {
  if (!state.dispatchTimer) return
  clearTimeout(state.dispatchTimer)
  state.dispatchTimer = undefined
}

async function flushDeliveryState(
  state: DeliveryState,
  scheduleDispatch: () => void,
  hook: TransportHook,
  options: ObservabilityFlushOptions,
): Promise<boolean> {
  const deadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs
  let failuresThisFlush = 0

  while (state.queuedRecords.length > 0 || state.dispatchTimer || state.pendingDeliveries.size > 0) {
    const failuresBefore = state.deliveryFailureCount
    if (state.queuedRecords.length > 0 || state.dispatchTimer) {
      dispatchQueuedRecords(state, scheduleDispatch)
    }

    const pending = Promise.all([...state.pendingDeliveries]).then(() => true)
    const remaining = deadline === undefined ? undefined : Math.max(0, deadline - Date.now())
    let completed: boolean
    if (remaining === undefined) {
      completed = await pending
    } else {
      const timeout = deliveryTimeoutSignal(remaining)
      try {
        completed = await Promise.race([pending, timeout.promise])
      } finally {
        timeout.cancel()
      }
    }
    if (!completed) return false

    if (state.deliveryFailureCount > failuresBefore && state.queuedRecords.length > 0) {
      failuresThisFlush += state.deliveryFailureCount - failuresBefore
      if (deadline === undefined && failuresThisFlush > 3) return false
      const remainingAfterFailure = deadline === undefined ? undefined : deadline - Date.now()
      if (remainingAfterFailure !== undefined && remainingAfterFailure <= 0) return false
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(FLUSH_FAILURE_RETRY_DELAY_MS, remainingAfterFailure ?? FLUSH_FAILURE_RETRY_DELAY_MS),
        ),
      )
    }
  }
  const hookError = await runTransportHook(state.transport, hook)
  if (hookError === undefined) return true
  recordDeliveryError(state, hookError)
  return false
}
