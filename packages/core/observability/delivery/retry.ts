import type { NormalizedObservabilityDeliveryOptions } from './options'

export interface DeliveryRetryState {
  retryTimer: ReturnType<typeof setTimeout> | undefined
  retryAttempt: number
}

/**
 * Schedule a delivery retry using capped exponential backoff.
 *
 * Timers are unref'd when the runtime supports it so observability retry work
 * never keeps a Node.js process alive by itself.
 */
export function scheduleDeliveryRetry(
  state: DeliveryRetryState,
  options: NormalizedObservabilityDeliveryOptions,
  dispatch: () => void,
): void {
  if (state.retryTimer !== undefined) return
  const delayMs = retryDelayMs(state.retryAttempt, options)
  state.retryAttempt += 1
  state.retryTimer = setTimeout(() => {
    state.retryTimer = undefined
    dispatch()
  }, delayMs)
  unrefTimer(state.retryTimer)
}

export function clearDeliveryRetryTimer(state: DeliveryRetryState): void {
  if (state.retryTimer === undefined) return
  clearTimeout(state.retryTimer)
  state.retryTimer = undefined
}

function retryDelayMs(
  attempt: number,
  options: NormalizedObservabilityDeliveryOptions,
): number {
  return Math.min(options.retryDelayMs * 2 ** attempt, options.maxRetryDelayMs)
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeUnref = (timer as { unref?: unknown }).unref
  if (typeof maybeUnref === 'function') maybeUnref.call(timer)
}
