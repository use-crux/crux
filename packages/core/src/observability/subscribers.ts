import type { CruxGraphRecord } from './contract'

/**
 * A synchronous, in-process consumer of the canonical Crux observability graph
 * stream.
 *
 * Subscribers run inside the active observability context and receive every
 * record emitted through `observe.*`, including records that are also queued
 * for the async devtools transport.
 */
export type CruxObservabilitySubscriber<TRecord extends CruxGraphRecord = CruxGraphRecord> = (record: TRecord) => void
export type CruxObservabilityRecordType = CruxGraphRecord['type']
export type CruxObservabilityRecordOfType<TType extends CruxObservabilityRecordType> = Extract<
  CruxGraphRecord,
  { type: TType }
>

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
export function subscribeObservability(subscriber: CruxObservabilitySubscriber): () => void
/**
 * Register a synchronous subscriber for only the selected graph record types.
 *
 * The type filter is applied before invoking the callback, so user code does
 * not need to branch over unrelated record variants.
 *
 * @param types - Record discriminants the subscriber wants to receive.
 * @param subscriber - Callback invoked only for matching graph records.
 * @returns A function that unregisters the subscriber.
 */
export function subscribeObservability<TType extends CruxObservabilityRecordType>(
  types: readonly TType[],
  subscriber: CruxObservabilitySubscriber<CruxObservabilityRecordOfType<TType>>,
): () => void
export function subscribeObservability<TType extends CruxObservabilityRecordType>(
  subscriberOrTypes: CruxObservabilitySubscriber | readonly TType[],
  filteredSubscriber?: CruxObservabilitySubscriber<CruxObservabilityRecordOfType<TType>>,
): () => void {
  const subscriber =
    typeof subscriberOrTypes === 'function'
      ? subscriberOrTypes
      : createFilteredSubscriber(subscriberOrTypes, filteredSubscriber)
  subscribers.add(subscriber)
  let subscribed = true
  return () => {
    if (!subscribed) return
    subscribed = false
    subscribers.delete(subscriber)
  }
}

function createFilteredSubscriber<TType extends CruxObservabilityRecordType>(
  types: readonly TType[],
  subscriber: CruxObservabilitySubscriber<CruxObservabilityRecordOfType<TType>> | undefined,
): CruxObservabilitySubscriber {
  if (!subscriber) return () => undefined

  const typeSet = new Set<TType>(types)
  return (record) => {
    if (isRecordOfType(record, typeSet)) {
      subscriber(record)
    }
  }
}

function isRecordOfType<TType extends CruxObservabilityRecordType>(
  record: CruxGraphRecord,
  types: ReadonlySet<TType>,
): record is CruxObservabilityRecordOfType<TType> {
  return types.has(record.type as TType)
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

/**
 * Returns whether any in-process observability subscriber is currently
 * registered.
 *
 * This is intended for Crux internals that need to decide whether to preserve
 * observable execution boundaries when no devtools transport is configured.
 */
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
