import type { NormalizedObservabilityDeliveryOptions } from './options'

export interface DeliveryRetryState {
  retryTimer: ReturnType<typeof setTimeout> | undefined
  retryAttempt: number
}

/** Schedule a jittered, capped exponential retry without keeping Node alive. */
export function scheduleDeliveryRetry(
  state: DeliveryRetryState,
  options: NormalizedObservabilityDeliveryOptions,
  dispatch: () => void,
  retryAfterMs = 0,
): void {
  if (state.retryTimer !== undefined) return
  const delayMs = Math.min(options.maxRetryDelayMs, Math.max(retryAfterMs, retryDelayMs(state.retryAttempt, options)))
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

export function retryDelayMs(
  attempt: number,
  options: Pick<
    NormalizedObservabilityDeliveryOptions,
    'retryDelayMs' | 'maxRetryDelayMs' | 'retryJitterRatio' | 'random'
  >,
): number {
  const capped = Math.min(options.retryDelayMs * 2 ** attempt, options.maxRetryDelayMs)
  const spread = capped * options.retryJitterRatio
  const jittered = capped - spread + 2 * spread * clampRandom(options.random())
  return Math.min(options.maxRetryDelayMs, Math.max(0, Math.round(jittered)))
}

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeUnref = (timer as { unref?: unknown }).unref
  if (typeof maybeUnref === 'function') maybeUnref.call(timer)
}
