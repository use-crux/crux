/**
 * Operator retry composite for blocked and dead-lettered runtime work.
 *
 * The kernel owns retry state, fresh idempotency keys, idle accounting, audit
 * events, and wake outbox writes. Store adapters only provide a guarded
 * terminal-to-pending transition.
 *
 * @module
 */

import type { RuntimeStoreAdapter } from '../store'
import { operatorRetryEventName, operatorRetryKey } from './idempotency'
import type { RetryWorkInput, RetryWorkResult } from './kernel-types'
import { wakeEnvelopeForWork } from './kernel-shared'

/** Dependencies for operator retry. */
export interface KernelRetryDeps {
  /** Durable runtime store. */
  readonly store: RuntimeStoreAdapter
  /** Current time source used for fresh idempotency keys. */
  readonly now: () => Date
}

/** Move blocked or dead-lettered work back to pending with a fresh wake. */
export async function retryWork(
  deps: KernelRetryDeps,
  input: RetryWorkInput,
): Promise<RetryWorkResult> {
  return await deps.store.transact(async (tx) => {
    const current = await tx.state.getWork(input.workId, {
      namespace: input.namespace,
    })
    if (
      !current ||
      (current.status !== 'blocked' && current.status !== 'dead-letter')
    ) {
      return { retried: false }
    }

    const retried = await tx.state.setWorkPending(input.workId, {
      namespace: input.namespace,
      work: current.work,
      idempotencyKey: operatorRetryKey(input.workId, deps.now()),
      from: ['blocked', 'dead-letter'],
    })
    if (!retried) return { retried: false }

    if (current.idleScope) {
      await tx.state.incrementIdle(current.namespace, current.idleScope)
    }
    await tx.events.append({
      namespace: input.namespace,
      name: operatorRetryEventName(input.workId),
      payload: { workId: input.workId },
    })
    await tx.outbox.put(wakeEnvelopeForWork(retried))

    return { retried: true, work: retried }
  })
}
