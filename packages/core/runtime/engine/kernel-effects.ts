/**
 * Barrier flush for replay-visible flow durable effects.
 *
 * `flow.defer()` and `flow.after()` buffer intents while user code runs. The
 * kernel flushes them only at a flow progress barrier, inside the same
 * transaction that records suspension or completion, so replay cannot duplicate
 * child work.
 *
 * @module
 */

import type { RuntimeStoreTransaction } from '../store'
import type { RuntimeScheduledEffect } from '../ports/state'
import type {
  RuntimeScheduledEffectFlushRecord,
  RuntimeScheduledEffectIntent,
} from './kernel-types'
import { taskRunKey } from './idempotency'
import { scheduleTimerInTransaction } from './kernel-timers'
import { wakeEnvelopeForWork } from './kernel-shared'

/** Flush buffered defer/after effects inside the current barrier transaction. */
export async function flushScheduledEffectsInTransaction(
  tx: RuntimeStoreTransaction,
  effects: readonly RuntimeScheduledEffectIntent[] = [],
  now: () => Date,
): Promise<readonly RuntimeScheduledEffectFlushRecord[]> {
  const records: RuntimeScheduledEffectFlushRecord[] = []
  for (const effect of effects) {
    if (effect.kind === 'defer') {
      const work = await tx.state.createWork({
        workId: effect.workId,
        namespace: effect.namespace,
        work: {
          kind: 'task.run',
          taskId: effect.taskId,
          targetId: effect.targetId,
          input: effect.input,
        },
        targetId: effect.targetId,
        idempotencyKey: taskRunKey(effect.workId),
        idleScope: effect.idleScope,
        now: now(),
      })
      await tx.outbox.put(wakeEnvelopeForWork(work), { deliverAt: now() })
      records.push({ key: effect.key, workId: work.workId })
      continue
    }

    const timer = await scheduleTimerInTransaction(tx, {
      namespace: effect.namespace,
      fireAt: effect.fireAt,
      work: {
        kind: 'task.run',
        taskId: effect.taskId,
        targetId: effect.targetId,
        input: effect.input,
      },
      idleScope: effect.idleScope,
    })
    records.push({ key: effect.key, timerId: timer.timerId })
  }
  return records
}

/** Merge newly flushed effect records into the replay-visible snapshot map. */
export function mergeScheduledEffectRecords(
  existing: Readonly<Record<string, RuntimeScheduledEffect>> | undefined,
  flushed: readonly RuntimeScheduledEffectFlushRecord[],
): Readonly<Record<string, RuntimeScheduledEffect>> {
  return Object.freeze({
    ...(existing ?? {}),
    ...Object.fromEntries(
      flushed.map((effect) => [
        effect.key,
        { workId: effect.workId, timerId: effect.timerId },
      ]),
    ),
  })
}
