/**
 * Runtime outbox dispatch loop.
 *
 * Store transactions write outbox rows after durable state changes. Dispatch
 * delivers those wake envelopes outside the transaction and confirms only
 * after delivery succeeds, so a crash can duplicate a wake but cannot lose it.
 *
 * @module
 */

import type { WakeEnvelope } from './envelope'
import { retryDelayMs } from './retry'
import type { RuntimeOutboxItem, RuntimeStoreAdapter } from '../store'

/** Wake delivery callback used by queue, HTTP, or in-process dispatchers. */
export type RuntimeWakeDeliver = (envelope: WakeEnvelope) => Promise<void>

/** Options for one bounded outbox dispatch pass. */
export interface DispatchBatchOptions {
  /** Runtime store containing pending outbox records. */
  readonly store: RuntimeStoreAdapter
  /** Deliver one wake envelope to the selected wake substrate. */
  readonly deliver: RuntimeWakeDeliver
  /** Namespace to claim. Omit only for maintenance diagnostics. */
  readonly namespace?: string
  /** Maximum rows to dispatch in this pass. Defaults to 32. */
  readonly limit?: number
  /**
   * Maximum wake deliveries to run at once. Defaults to 8.
   *
   * Outbox ordering is not a contract; retries and concurrent lanes can deliver
   * later rows before earlier rows finish.
   */
  readonly concurrency?: number
  /** Current time source for deterministic tests. */
  readonly now?: () => Date
  /** Retry jitter source for deterministic tests. */
  readonly rng?: () => number
}

/** Summary of one outbox dispatch pass. */
export interface DispatchBatchResult {
  /** Rows successfully delivered and confirmed. */
  readonly delivered: number
  /** Rows requeued after delivery or confirmation failed. */
  readonly failed: number
}

/** Functional dispatcher facade used by kernels and maintenance loops. */
export interface RuntimeOutboxDispatcher {
  /** Run a bounded dispatch pass. */
  dispatchBatch(
    options?: Partial<Pick<DispatchBatchOptions, 'limit' | 'concurrency' | 'now'>>,
  ): Promise<DispatchBatchResult>
  /** Best-effort immediate dispatch after new outbox rows are written. */
  nudge(): Promise<DispatchBatchResult>
}

/** Create a reusable dispatcher around a store and wake delivery callback. */
export function createOutboxDispatcher(
  options: Omit<DispatchBatchOptions, 'limit'>,
): RuntimeOutboxDispatcher {
  return Object.freeze({
    dispatchBatch: (overrides = {}) =>
      dispatchBatch({ ...options, ...overrides }),
    nudge: () => dispatchBatch(options),
  })
}

/** Dispatch a bounded batch of pending wake envelopes. */
export async function dispatchBatch(
  options: DispatchBatchOptions,
): Promise<DispatchBatchResult> {
  const now = options.now ?? (() => new Date())
  const batch = await options.store.outbox.claimPending({
    namespace: options.namespace,
    now: now(),
    limit: options.limit ?? 32,
  })
  if (batch.length === 0) return { delivered: 0, failed: 0 }

  let nextIndex = 0
  const laneCount = Math.min(normalizeConcurrency(options.concurrency), batch.length)
  const lanes = Array.from({ length: laneCount }, async () => {
    let delivered = 0
    let failed = 0
    for (;;) {
      const item = batch[nextIndex]
      nextIndex += 1
      if (!item) return { delivered, failed }

      const result = await dispatchItem(options, item, now)
      delivered += result.delivered
      failed += result.failed
    }
  })
  const results = await Promise.all(lanes)
  return results.reduce<DispatchBatchResult>(
    (total, result) => ({
      delivered: total.delivered + result.delivered,
      failed: total.failed + result.failed,
    }),
    { delivered: 0, failed: 0 },
  )
}

async function dispatchItem(
  options: DispatchBatchOptions,
  item: RuntimeOutboxItem,
  now: () => Date,
): Promise<DispatchBatchResult> {
  try {
    await options.deliver(item.envelope)
    await options.store.outbox.confirm(item.outboxId)
    return { delivered: 1, failed: 0 }
  } catch {
    const delayMs = retryDelayMs({
      attempt: item.attempts,
      rng: options.rng,
    })
    await options.store.outbox.retryLater(
      item.outboxId,
      new Date(now().getTime() + delayMs),
    )
    return { delivered: 0, failed: 1 }
  }
}

function normalizeConcurrency(concurrency: number | undefined): number {
  if (concurrency === undefined) return 8
  return Math.max(1, Math.floor(concurrency))
}
