import { remainingHostDeadlineMs } from '../../runtime/api/host-lifecycle'
import { activeHostLifecycle } from './host-scope'
import { runTransportHook, type TransportHook } from './hooks'
import type { ObservabilityFlushOptions, ObservabilityFlushResult } from './options'
import {
  recordDeliveryError,
  remainingRecords,
  sanitizeTransportError,
  supersededChangeSignal,
  type DeliveryState,
} from './state'
import { deliveryTimeoutSignal } from './timeout'

const MAX_FLUSH_FAILURES = 3

/** Drain queued delivery without clearing records on failure or deadline. */
export async function drainDeliveryState(
  state: DeliveryState,
  dispatch: () => void,
  hook: TransportHook,
  options: ObservabilityFlushOptions,
): Promise<ObservabilityFlushResult> {
  const startedAccepted = state.accepted
  const startedRejected = state.permanentlyRejected
  const startedErrors = state.deliveryErrorCount
  const explicitDeadline = options.timeoutMs === undefined ? undefined : Date.now() + Math.max(0, options.timeoutMs)
  const hostRemainingMs = remainingHostDeadlineMs(activeHostLifecycle() ?? state.options.hostLifecycle)
  const hostDeadline = hostRemainingMs === undefined ? undefined : Date.now() + hostRemainingMs
  const deadline = nearestDeadline(explicitDeadline, hostDeadline)

  while (remainingRecords(state) > 0 || state.dispatchTimer || state.retryTimer) {
    if (deadline !== undefined && Date.now() >= deadline) {
      return result(state, startedAccepted, startedRejected, 'deadline')
    }
    if (deadline === undefined && state.deliveryErrorCount - startedErrors > MAX_FLUSH_FAILURES) {
      return result(state, startedAccepted, startedRejected, 'failed')
    }
    if (state.retryTimer) {
      if (!(await waitForRetry(state, deadline))) {
        return result(state, startedAccepted, startedRejected, 'deadline')
      }
    } else if (state.queue.length > 0 || state.dispatchTimer) {
      dispatch()
    }
    if (!(await waitForPending(state, deadline))) {
      return result(state, startedAccepted, startedRejected, 'deadline')
    }
  }

  const hookError = await runTransportHook(state.transport, hook)
  if (hookError !== undefined) {
    recordDeliveryError(state, `${hook}_failed`, sanitizeTransportError(hookError))
    return result(state, startedAccepted, startedRejected, 'failed')
  }
  return result(state, startedAccepted, startedRejected, 'drained')
}

async function waitForPending(state: DeliveryState, deadline: number | undefined): Promise<boolean> {
  // Superseded (reconfigured-out) deliveries are still awaited here so a
  // drain never reports `drained` while their outcome is unknown; they are
  // just not gated by the new epoch's `maxPendingDeliveries` budget.
  const refs: Promise<unknown>[] = [...state.pendingDeliveries, ...state.supersededDeliveries]
  if (refs.length === 0 && state.supersededRecordCount > 0) {
    // Every outstanding superseded delivery has had its promise reference
    // pruned to keep `supersededDeliveries` bounded, so there is nothing
    // left to await directly. `Promise.all([])` would resolve instantly and
    // spin the loop above hot until the deadline; wait on the shared
    // "a superseded delivery settled" signal instead.
    refs.push(supersededChangeSignal(state))
  }
  const pending = Promise.all(refs).then(() => true)
  return raceDeadline(pending, deadline)
}

async function waitForRetry(state: DeliveryState, deadline: number | undefined): Promise<boolean> {
  const scheduled = state.retryTimer
  const pending = new Promise<true>((resolve) => {
    const poll = () => (state.retryTimer !== scheduled ? resolve(true) : setTimeout(poll, 1))
    poll()
  })
  return raceDeadline(pending, deadline)
}

async function raceDeadline(pending: Promise<boolean>, deadline: number | undefined): Promise<boolean> {
  if (deadline === undefined) return pending
  const timeout = deliveryTimeoutSignal(Math.max(0, deadline - Date.now()))
  try {
    return await Promise.race([pending, timeout.promise])
  } finally {
    timeout.cancel()
  }
}

function nearestDeadline(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.min(a, b)
}

function result(
  state: DeliveryState,
  accepted: number,
  rejected: number,
  status: ObservabilityFlushResult['status'],
): ObservabilityFlushResult {
  return {
    status,
    delivered: state.accepted - accepted,
    rejected: state.permanentlyRejected - rejected,
    remaining: remainingRecords(state),
    deadlineExceeded: status === 'deadline',
  }
}
