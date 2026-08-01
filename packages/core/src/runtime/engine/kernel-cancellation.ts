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
import { transition, type RuntimeWorkItem } from './work'

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
  if (!current) return { cancelled: false }
  if (current.status === 'cancelled') {
    await cancelFlowSnapshot(tx, current, deps.now())
    return { cancelled: false }
  }
  if (isTerminalWork(current)) return { cancelled: false }

  await putWorkWithIdleAccounting(
    tx,
    { newWorkId: deps.newWorkId, now: deps.now },
    current,
    transition(current, { status: 'cancelled' }),
  )
  await cancelFlowSnapshot(tx, current, deps.now())

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

async function cancelFlowSnapshot(
  tx: RuntimeStoreTransaction,
  work: RuntimeWorkItem,
  now: Date,
): Promise<void> {
  if (work.work.kind !== 'flow.resume' && work.work.kind !== 'flow.timeout') return

  const snapshot = await tx.state.getSnapshot(work.work.flowId, {
    namespace: work.namespace,
  })
  if (!snapshot || snapshot.status === 'cancelled') return

  await tx.state.putSnapshot({
    ...snapshot,
    status: 'cancelled',
    updatedAt: now,
  })
}
