/**
 * Operator retry composite for blocked and dead-lettered runtime work.
 *
 * The kernel owns retry state, fresh idempotency keys, idle accounting, audit
 * events, and wake outbox writes. Store adapters only provide a guarded
 * terminal-to-pending transition.
 *
 * @module
 */

import type { RuntimeStoreTransaction } from '../store'
import { operatorRetryEventName, operatorRetryKey } from './idempotency'
import type { RetryWorkInput, RetryWorkResult } from './kernel-types'
import { wakeEnvelopeForWork } from './kernel-shared'
import type { RuntimeCompositeDeps, RuntimeCompositeRunner } from './composites'
import { recordApplicationWorkStatusTransition } from './application-work-events'

/** Dependencies for operator retry. */
export interface KernelRetryDeps extends RuntimeCompositeDeps {
  /** Execute a named composite through the store default or adapter override. */
  readonly runComposite: RuntimeCompositeRunner
}

/** Move blocked or dead-lettered work back to pending with a fresh wake. */
export async function retryWork(
  deps: KernelRetryDeps,
  input: RetryWorkInput,
): Promise<RetryWorkResult> {
  return await deps.runComposite('work.operator-retry', input)
}

/** Move retryable terminal work back to pending inside a transaction. */
export async function retryWorkInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: RetryWorkInput,
): Promise<RetryWorkResult> {
  const current = await tx.state.getWork(input.workId, {
    namespace: input.namespace,
  })
  if (
    !current ||
    (current.status !== 'blocked' && current.status !== 'dead-letter')
  ) {
    return { retried: false }
  }

  let retried = await tx.state.setWorkPending(input.workId, {
    namespace: input.namespace,
    work: current.work,
    idempotencyKey: operatorRetryKey(input.workId, deps.now()),
    now: deps.now(),
    from: ['blocked', 'dead-letter'],
  })
  if (!retried) return { retried: false }
  if (retried.application) {
    retried = await recordApplicationWorkStatusTransition(
      tx,
      current,
      retried,
      deps.now(),
    )
  }

  if (current.idleScope) {
    await tx.state.incrementIdle(current.namespace, current.idleScope)
  }
  await tx.events.append({
    namespace: input.namespace,
    name: operatorRetryEventName(input.workId),
    payload: { workId: input.workId },
  })
  await tx.outbox.put(wakeEnvelopeForWork(retried), {
    deliverAt: deps.now(),
  })

  return { retried: true, work: retried }
}
