import type { NormalizedObservabilityDeliveryOptions } from './options'

export interface DeliveryRetryState {
  retryTimer: ReturnType<typeof setTimeout> | undefined
  retryAttempt: number
  /** Resolves the in-flight backoff wait promise deferred to the host lifecycle, if any. */
  retryWaitResolve: (() => void) | undefined
}

/**
 * Schedule a jittered, capped exponential retry without keeping Node alive on
 * its own.
 *
 * The backoff wait itself - not just the eventual retry send - is exposed to
 * `onScheduled` as a promise so a caller can bind it to a host lifecycle's
 * `defer()`. A bare unref'd timer is a batching optimization, never a
 * lifetime guarantee: a host that only tracks deferred promises would
 * otherwise see no pending work during the backoff window and could freeze
 * the process before the retry ever fires. The wait promise resolves once
 * this attempt is dispatched (or the retry is cancelled); it does not chain
 * onto any later retry's own wait promise, so a run of failures produces one
 * independent deferred promise per attempt instead of a growing chain.
 */
export function scheduleDeliveryRetry(
  state: DeliveryRetryState,
  options: NormalizedObservabilityDeliveryOptions,
  dispatch: () => void,
  retryAfterMs = 0,
  onScheduled?: (wait: Promise<void>) => void,
): void {
  if (state.retryTimer !== undefined) return
  const delayMs = Math.min(options.maxRetryDelayMs, Math.max(retryAfterMs, retryDelayMs(state.retryAttempt, options)))
  state.retryAttempt += 1
  const wait = new Promise<void>((resolve) => {
    state.retryWaitResolve = resolve
  })
  onScheduled?.(wait)
  state.retryTimer = setTimeout(() => {
    state.retryTimer = undefined
    dispatch()
    resolveRetryWait(state)
  }, delayMs)
  unrefTimer(state.retryTimer)
}

export function clearDeliveryRetryTimer(state: DeliveryRetryState): void {
  if (state.retryTimer === undefined) {
    resolveRetryWait(state)
    return
  }
  clearTimeout(state.retryTimer)
  state.retryTimer = undefined
  resolveRetryWait(state)
}

function resolveRetryWait(state: DeliveryRetryState): void {
  state.retryWaitResolve?.()
  state.retryWaitResolve = undefined
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
