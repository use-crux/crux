import type { CruxGraphRecord } from './contract'

/**
 * A synchronous, in-process consumer of the canonical Crux observability graph
 * stream.
 *
 * Subscribers run inside the active observability context and receive every
 * record emitted through `observe.*`, including records that are also queued
 * for the async devtools transport.
 */
export type CruxObservabilitySubscriber = (record: CruxGraphRecord) => void

const subscribers = new Set<CruxObservabilitySubscriber>()
let subscriberErrors = 0
let warnedAboutSubscriberError = false

/**
 * Register a synchronous subscriber for the canonical observability graph
 * stream.
 *
 * The returned function removes the subscriber. Calling it more than once is a
 * no-op, which makes it safe to use from test and request cleanup paths.
 *
 * @param subscriber - Callback invoked for each graph record in registration
 * order.
 * @returns A function that unregisters the subscriber.
 */
export function subscribeObservability(subscriber: CruxObservabilitySubscriber): () => void {
  subscribers.add(subscriber)
  let subscribed = true
  return () => {
    if (!subscribed) return
    subscribed = false
    subscribers.delete(subscriber)
  }
}

export function publishObservabilitySubscribers(record: CruxGraphRecord): void {
  if (subscribers.size === 0) return
  for (const subscriber of [...subscribers]) {
    try {
      subscriber(record)
    } catch (error) {
      recordSubscriberError(error)
    }
  }
}

export function hasObservabilitySubscribers(): boolean {
  return subscribers.size > 0
}

export function observabilitySubscriberErrorCount(): number {
  return subscriberErrors
}

export function resetObservabilitySubscribers(): void {
  subscribers.clear()
  subscriberErrors = 0
  warnedAboutSubscriberError = false
}

function recordSubscriberError(error: unknown): void {
  subscriberErrors += 1
  if (warnedAboutSubscriberError) return
  if (!shouldWarnAboutSubscriberErrors()) return

  warnedAboutSubscriberError = true
  console.warn('[crux] observability subscriber threw; continuing without interrupting execution.', error)
}

function shouldWarnAboutSubscriberErrors(): boolean {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Readonly<Record<string, string | undefined>> }
  }
  const nodeEnv = runtime.process?.env?.NODE_ENV
  return nodeEnv !== 'production' && nodeEnv !== 'test'
}
