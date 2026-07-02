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
import type { RuntimeStoreAdapter } from '../store'

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
    options?: Partial<Pick<DispatchBatchOptions, 'limit' | 'now'>>,
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
  return await batch.reduce<Promise<DispatchBatchResult>>(
    async (previous, item) => {
      const counts = await previous
      try {
        await options.deliver(item.envelope)
        await options.store.outbox.confirm(item.outboxId)
        return { delivered: counts.delivered + 1, failed: counts.failed }
      } catch {
        const delayMs = retryDelayMs({
          attempt: item.attempts,
          rng: options.rng,
        })
        await options.store.outbox.retryLater(
          item.outboxId,
          new Date(now().getTime() + delayMs),
        )
        return { delivered: counts.delivered, failed: counts.failed + 1 }
      }
    },
    Promise.resolve({ delivered: 0, failed: 0 }),
  )
}
