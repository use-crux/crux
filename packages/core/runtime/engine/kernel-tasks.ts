/**
 * Task enqueue composite for the Runtime Engine kernel.
 *
 * @module
 */

import type { WorkId } from '../ports/ids'
import type { RuntimeWork } from '../ports/work'
import type { RuntimeStoreAdapter } from '../store'
import { taskRunKey } from './idempotency'
import type { EnqueueTaskInput } from './kernel-types'
import { wakeEnvelopeForWork } from './kernel-shared'
import type { WorkItem } from './work'

/** Dependencies for task enqueue. */
export interface EnqueueTaskDeps {
  /** Durable runtime store. */
  readonly store: RuntimeStoreAdapter
  /** Kernel-owned work id generator. */
  readonly newWorkId: () => WorkId
  /** Current time source. */
  readonly now: () => Date
}

/** Create pending task work and write its wake envelope to the outbox. */
export async function enqueueTask(
  deps: EnqueueTaskDeps,
  input: EnqueueTaskInput,
): Promise<WorkItem> {
  const workId = deps.newWorkId()
  const work: RuntimeWork = {
    kind: 'task.run',
    taskId: input.taskId,
    targetId: input.targetId,
  }
  const idempotencyKey = taskRunKey(workId)

  return await deps.store.transact(async (tx) => {
    const item = await tx.state.createWork({
      workId,
      namespace: input.namespace,
      work,
      targetId: input.targetId,
      idempotencyKey,
      notBefore: input.notBefore,
      idleScope: input.idleScope,
      now: deps.now(),
    })
    await tx.outbox.put(wakeEnvelopeForWork(item))
    return item
  })
}
