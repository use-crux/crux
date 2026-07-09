/**
 * Timer scheduling and firing composites for the Runtime Engine kernel.
 *
 * Store-backed timers use the same race gate as event delivery: the linked
 * waiter moves from `armed` to `timed-out` inside the timer-firing transaction
 * before any work is resumed or enqueued.
 *
 * @module
 */

import type { WorkId } from '../ports/ids'
import type {
  RuntimeOutboxItem,
  RuntimeStoreTransaction,
  RuntimeTimerRecord,
} from '../store'
import { timerKey } from './idempotency'
import { targetIdForNewWork, wakeEnvelopeForWork } from './kernel-shared'
import type {
  FireTimerRecordResult,
  ScanTimersOptions,
  ScanTimersResult,
  ScheduleTimerInput,
} from './kernel-types'
import type { RuntimeCompositeDeps, RuntimeCompositeRunner } from './composites'

/** Dependencies for timer kernel operations. */
export interface KernelTimerDeps extends RuntimeCompositeDeps {
  /** Store-backed timer port used for pre-transaction claims and single puts. */
  readonly store: {
    readonly timers: {
      readonly claimDue: RuntimeStoreTransaction['timers']['claimDue']
      readonly put: RuntimeStoreTransaction['timers']['put']
    }
  }
  /** Execute a named composite through the store default or adapter override. */
  readonly runComposite: RuntimeCompositeRunner
}

/** Persist a store-backed timer record. */
export async function scheduleTimer(
  deps: KernelTimerDeps,
  input: ScheduleTimerInput,
): Promise<RuntimeTimerRecord> {
  return await deps.store.timers.put({
    namespace: input.namespace,
    fireAt: input.fireAt,
    workId: input.workId,
    waiterId: input.waiterId,
    idleScope: input.idleScope,
    work: input.work,
  })
}

/** Persist a timer record inside an existing composite transaction. */
export async function scheduleTimerInTransaction(
  tx: RuntimeStoreTransaction,
  input: ScheduleTimerInput,
): Promise<RuntimeTimerRecord> {
  return await tx.timers.put({
    namespace: input.namespace,
    fireAt: input.fireAt,
    workId: input.workId,
    waiterId: input.waiterId,
    idleScope: input.idleScope,
    work: input.work,
  })
}

/** Fire due store-backed timers through the waiter CAS race gate. */
export async function scanTimers(
  deps: KernelTimerDeps,
  options: ScanTimersOptions = {},
): Promise<ScanTimersResult> {
  const now = options.now ?? deps.now()
  const due = await deps.store.timers.claimDue({
    namespace: options.namespace,
    now,
    limit: options.limit,
  })

  return await deps.runComposite('timers.fire-due', { timers: due })
}

/** Fire claimed timer records inside a transaction. */
export async function fireDueTimersInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: { readonly timers: readonly RuntimeTimerRecord[] },
): Promise<ScanTimersResult> {
  const results = await input.timers.reduce<
    Promise<readonly FireTimerRecordResult[]>
  >(
    async (previous, timer) => [
      ...(await previous),
      await fireTimerRecord({ tx, deps, timer }),
    ],
    Promise.resolve([]),
  )
  const outboxItems = results
    .map((result) => result.outboxItem)
    .filter((item): item is RuntimeOutboxItem => item !== undefined)
  return {
    fired: outboxItems.length,
    skipped: results.length - outboxItems.length,
    outboxItems,
  }
}

/** Fire one timer record inside a transaction. */
export async function fireTimerRecord(options: {
  readonly tx: RuntimeStoreTransaction
  readonly deps: RuntimeCompositeDeps
  readonly timer: RuntimeTimerRecord
}): Promise<FireTimerRecordResult> {
  const transitioned = await options.tx.timers.transition(
    options.timer.timerId,
    'scheduled',
    'fired',
  )
  if (!transitioned) return { fired: false }

  if (options.timer.waiterId) {
    const won = await options.tx.waiters.transition(
      options.timer.waiterId,
      'armed',
      'timed-out',
    )
    if (!won) return { fired: false }
  }

  const work = options.timer.workId
    ? await options.tx.state.setWorkPending(options.timer.workId, {
        namespace: options.timer.namespace,
        work: options.timer.work,
        idempotencyKey: timerKey(options.timer.timerId),
        now: options.deps.now(),
      })
    : await createTimerMintedWork(options)

  if (!work) return { fired: false }
  return {
    fired: true,
    outboxItem: await options.tx.outbox.put(wakeEnvelopeForWork(work), {
      deliverAt: options.deps.now(),
    }),
  }
}

async function createTimerMintedWork(options: {
  readonly tx: RuntimeStoreTransaction
  readonly deps: RuntimeCompositeDeps
  readonly timer: RuntimeTimerRecord
}) {
  const workId = options.deps.newWorkId()
  return await options.tx.state.createWork({
    workId,
    namespace: options.timer.namespace,
    work: options.timer.work,
    targetId: targetIdForNewWork(options.timer.work),
    idempotencyKey: timerKey(options.timer.timerId),
    idleScope: options.timer.idleScope,
    now: options.deps.now(),
  })
}
