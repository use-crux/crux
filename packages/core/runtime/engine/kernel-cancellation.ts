/**
 * Cancellation composite for the Runtime Engine kernel.
 *
 * Cancellation is a durable state transition owned by the kernel. Store
 * adapters provide record lookup and compare-and-set transitions only; they do
 * not decide which records should be cancelled.
 *
 * @module
 */

import type { WorkId } from '../ports/ids'
import type { RuntimeStoreAdapter } from '../store'
import { putWorkWithIdleAccounting } from './kernel-idle'
import type { CancelWorkInput, CancelWorkResult } from './kernel-types'
import { isTerminalWork } from './kernel-shared'
import { transition } from './work'

/** Dependencies for cancellation. */
export interface KernelCancellationDeps {
  /** Durable runtime store. */
  readonly store: RuntimeStoreAdapter
  /** Kernel-owned work id generator for waiter firings during terminal events. */
  readonly newWorkId: () => WorkId
  /** Current time source. */
  readonly now: () => Date
}

/** Cancel non-terminal work and its owned waiter/timer registrations. */
export async function cancelWork(
  deps: KernelCancellationDeps,
  input: CancelWorkInput,
): Promise<CancelWorkResult> {
  return await deps.store.transact(async (tx) => {
    const current = await tx.state.getWork(input.workId, {
      namespace: input.namespace,
    })
    if (!current || isTerminalWork(current)) return { cancelled: false }

    await putWorkWithIdleAccounting(
      tx,
      { newWorkId: deps.newWorkId, now: deps.now },
      current,
      transition(current, { status: 'cancelled' }),
    )

    const waiters = await tx.waiters.listByWork(input.workId)
    for (const waiter of waiters) {
      await tx.waiters.transition(waiter.waiterId, 'armed', 'cancelled')
    }

    const timers = await tx.timers.listByWork(input.workId)
    for (const timer of timers) {
      await tx.timers.transition(timer.timerId, 'scheduled', 'cancelled')
    }

    await tx.events.append({
      namespace: input.namespace,
      name: `crux.cancelled:${input.workId}`,
      payload: { workId: input.workId },
    })
    return { cancelled: true }
  })
}
