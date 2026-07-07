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
import type { RuntimeStoreTransaction } from '../store'
import { putWorkWithIdleAccounting } from './kernel-idle'
import type { CancelWorkInput, CancelWorkResult } from './kernel-types'
import { isTerminalWork } from './kernel-shared'
import type { RuntimeCompositeDeps, RuntimeCompositeRunner } from './composites'
import { transition } from './work'

/** Dependencies for cancellation. */
export interface KernelCancellationDeps extends RuntimeCompositeDeps {
  /** Execute a named composite through the store default or adapter override. */
  readonly runComposite: RuntimeCompositeRunner
}

/** Cancel non-terminal work and its owned waiter/timer registrations. */
export async function cancelWork(
  deps: KernelCancellationDeps,
  input: CancelWorkInput,
): Promise<CancelWorkResult> {
  return await deps.runComposite('work.cancel', input)
}

/** Cancel non-terminal work and its owned registrations inside a transaction. */
export async function cancelWorkInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: CancelWorkInput,
): Promise<CancelWorkResult> {
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
}
