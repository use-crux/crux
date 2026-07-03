export interface DeliveryTimeoutSignal {
  readonly promise: Promise<false>
  cancel(): void
}

/**
 * Create a cancelable timeout promise for bounded delivery flushes.
 *
 * Callers must invoke `cancel()` when their real work finishes first so the
 * timeout does not leave a live timer behind.
 */
export function deliveryTimeoutSignal(timeoutMs: number): DeliveryTimeoutSignal {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<false>((resolve) => {
    timeout = setTimeout(() => {
      timeout = undefined
      resolve(false)
    }, timeoutMs)
  })
  return {
    promise,
    cancel() {
      if (timeout === undefined) return
      clearTimeout(timeout)
      timeout = undefined
    },
  }
}
