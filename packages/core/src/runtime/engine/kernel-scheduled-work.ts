/**
 * Barrier flush for replay-visible flow scheduled work.
 *
 * `flow.defer()` and `flow.after()` buffer intents while user code runs. The
 * kernel flushes them only at a flow progress barrier, inside the same
 * transaction that records suspension or completion, so replay cannot duplicate
 * child work.
 *
 * @module
 */

import type { RuntimeStoreTransaction } from '../store'
import type { RuntimeScheduledWork } from '../ports/state'
import type {
  RuntimeScheduledWorkFlushRecord,
  RuntimeScheduledWorkIntent,
} from './kernel-types'
import { taskRunKey } from './idempotency'
import { scheduleTimerInTransaction } from './kernel-timers'
import { wakeEnvelopeForWork } from './kernel-shared'

/** Flush buffered defer/after work inside the current barrier transaction. */
export async function flushScheduledWorkInTransaction(
  tx: RuntimeStoreTransaction,
  intents: readonly RuntimeScheduledWorkIntent[] = [],
  now: () => Date,
): Promise<readonly RuntimeScheduledWorkFlushRecord[]> {
  const records: RuntimeScheduledWorkFlushRecord[] = []
  for (const intent of intents) {
    if (intent.kind === 'defer') {
      const work = await tx.state.createWork({
        workId: intent.workId,
        namespace: intent.namespace,
        work: {
          kind: 'task.run',
          taskId: intent.taskId,
          targetId: intent.targetId,
          input: intent.input,
        },
        targetId: intent.targetId,
        idempotencyKey: taskRunKey(intent.workId),
        idleScope: intent.idleScope,
        now: now(),
      })
      await tx.outbox.put(wakeEnvelopeForWork(work), { deliverAt: now() })
      records.push({ key: intent.key, workId: work.workId })
      continue
    }

    const timer = await scheduleTimerInTransaction(tx, {
      namespace: intent.namespace,
      fireAt: intent.fireAt,
      work: {
        kind: 'task.run',
        taskId: intent.taskId,
        targetId: intent.targetId,
        input: intent.input,
      },
      idleScope: intent.idleScope,
    })
    records.push({ key: intent.key, timerId: timer.timerId })
  }
  return records
}

/** Merge newly flushed work records into the replay-visible snapshot map. */
export function mergeScheduledWorkRecords(
  existing: Readonly<Record<string, RuntimeScheduledWork>> | undefined,
  flushed: readonly RuntimeScheduledWorkFlushRecord[],
): Readonly<Record<string, RuntimeScheduledWork>> {
  return Object.freeze({
    ...(existing ?? {}),
    ...Object.fromEntries(
      flushed.map((work) => [
        work.key,
        { workId: work.workId, timerId: work.timerId },
      ]),
    ),
  })
}
