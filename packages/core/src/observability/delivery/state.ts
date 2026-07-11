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
  /**
   * Records still in flight to a transport superseded by reconfiguration.
   *
   * Their outcome is not yet known, so they are truthfully still
   * "remaining" - not guessed as dropped and not silently forgotten - until
   * the stale send settles. This aggregate count is exact even once the
   * number of reconfigurations exceeds `reconfiguredTrackedDeliveries`.
   */
  readonly reconfiguredRemainingRecords: number
  /** Serialized bytes backing {@link reconfiguredRemainingRecords}. */
  readonly reconfiguredRemainingBytes: number
  /**
   * Superseded delivery promises still retained for `flush`/`shutdown` to
   * await directly, bounded by `maxPendingDeliveries` regardless of how many
   * reconfigurations occurred. Once this cap is reached, additional
   * superseded deliveries are still counted truthfully in
   * {@link reconfiguredRemainingRecords} - only the promise reference itself
   * is pruned to keep memory bounded.
   */
  readonly reconfiguredTrackedDeliveries: number
}

export interface QueuedRecord {
  readonly record: CruxGraphRecord
  readonly bytes: number
}

export interface DeliveryState extends DeliveryRetryState {
  transport: CruxObservabilityTransport | undefined
  options: NormalizedObservabilityDeliveryOptions
  /**
   * Lazily minted by {@link ensureSourceId} on first actual use, never at
   * state construction. Generating it eagerly would call into random-ID
   * generation from module scope for any consumer whose delivery engine is a
   * module-level singleton (as `observe.ts`'s is), and Workers/workerd
   * disallows random generation and other I/O outside a request handler.
   */
  sourceId: string | undefined
  readonly pendingDeliveries: Set<Promise<void>>
  pendingRecordCount: number
  pendingBytes: number
  /**
   * In-flight deliveries from an epoch reconfiguration replaced.
   *
   * Tracked separately from `pendingDeliveries` so a newly configured
   * transport's own `maxPendingDeliveries` budget is never blocked by a
   * stale transport that has not settled yet, while a drain still truthfully
   * waits on / reports them instead of pretending they never existed.
   *
   * Bounded to `options.maxPendingDeliveries` promise references (see
   * `advanceEpoch`); `supersededRecordCount`/`supersededBytes` remain exact
   * aggregate counters regardless of how many references were pruned to
   * keep this set bounded across repeated reconfigurations.
   */
  readonly supersededDeliveries: Set<Promise<void>>
  supersededRecordCount: number
  supersededBytes: number
  /**
   * Resolves the next time a superseded delivery settles, whether or not its
   * own promise reference was retained in `supersededDeliveries`.
   *
   * Lets a drain wait on a single bounded signal instead of busy-polling
   * `Promise.all([])` (which resolves instantly) when every outstanding
   * superseded delivery has been pruned from the tracked set.
   */
  supersededChangeWait: Promise<void> | undefined
  supersededChangeResolve: (() => void) | undefined
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
  /**
   * Bumped by a full runtime reset. Delivery callbacks capture the
   * generation active at dispatch time and become no-ops (including
   * `release()`/accounting) once it no longer matches, so a stale send that
   * settles after reset can never mutate the fresh runtime it was reset to.
   */
  generation: number
  accepting: boolean
}

export function initialDeliveryState(): DeliveryState {
  return {
    transport: undefined,
    options: defaultDeliveryOptions(),
    sourceId: undefined,
    pendingDeliveries: new Set(),
    pendingRecordCount: 0,
    pendingBytes: 0,
    supersededDeliveries: new Set(),
    supersededRecordCount: 0,
    supersededBytes: 0,
    supersededChangeWait: undefined,
    supersededChangeResolve: undefined,
    queue: [],
    queuedBytes: 0,
    retryTimer: undefined,
    dispatchTimer: undefined,
    retryAttempt: 0,
    retryWaitResolve: undefined,
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
    generation: 0,
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
    reconfiguredRemainingRecords: state.supersededRecordCount,
    reconfiguredRemainingBytes: state.supersededBytes,
    reconfiguredTrackedDeliveries: state.supersededDeliveries.size,
  }
}

/**
 * Resolve (and clear) the pending superseded-change signal, if any.
 *
 * Called whenever a superseded delivery settles, whether or not its promise
 * reference was retained in `supersededDeliveries` - a pruned delivery still
 * needs to wake up a drain that is waiting on this signal instead of a
 * direct promise reference.
 */
export function notifySupersededChange(state: DeliveryState): void {
  state.supersededChangeResolve?.()
  state.supersededChangeWait = undefined
  state.supersededChangeResolve = undefined
}

/** Lazily create (and return) the shared "a superseded delivery settled" signal. */
export function supersededChangeSignal(state: DeliveryState): Promise<void> {
  if (!state.supersededChangeWait) {
    state.supersededChangeWait = new Promise<void>((resolve) => {
      state.supersededChangeResolve = resolve
    })
  }
  return state.supersededChangeWait
}

/** Lazily mint (and cache) this engine instance's source id on first actual use. */
export function ensureSourceId(state: DeliveryState): string {
  if (!state.sourceId) state.sourceId = `source_${createCruxSegmentId().slice(4)}`
  return state.sourceId
}

export function sourceHealthSnapshot(state: DeliveryState): CruxDeliverySourceHealth {
  return {
    sourceId: ensureSourceId(state),
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
  return state.queue.length + state.pendingRecordCount + state.supersededRecordCount
}

export function sanitizeTransportError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'observability transport failed'
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? `observability transport failed (${status})` : 'observability transport failed'
}
