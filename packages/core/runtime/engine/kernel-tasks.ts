/**
 * Task enqueue composite for the Runtime Engine kernel.
 *
 * @module
 */

import type { WorkId } from '../ports/ids'
import type { RuntimeWork } from '../ports/work'
import type { RuntimeStoreTransaction } from '../store'
import { taskRunKey } from './idempotency'
import type { EnqueueTaskInput } from './kernel-types'
import { wakeEnvelopeForWork } from './kernel-shared'
import type { RuntimeCompositeDeps, RuntimeCompositeRunner } from './composites'
import type { WorkItem } from './work'

/** Dependencies for task enqueue. */
export interface EnqueueTaskDeps extends RuntimeCompositeDeps {
  /** Execute a named composite through the store default or adapter override. */
  readonly runComposite: RuntimeCompositeRunner
}

/** Create pending task work and write its wake envelope to the outbox. */
export async function enqueueTask(
  deps: EnqueueTaskDeps,
  input: EnqueueTaskInput,
): Promise<WorkItem> {
  return await deps.runComposite('task.enqueue', input)
}

/** Create pending task work and write its wake envelope inside a transaction. */
export async function enqueueTaskInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: EnqueueTaskInput,
): Promise<WorkItem> {
  const workId = deps.newWorkId()
  const work: RuntimeWork = {
    kind: 'task.run',
    taskId: input.taskId,
    targetId: input.targetId,
    input: input.input,
  }
  const idempotencyKey = taskRunKey(workId)

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
  await tx.outbox.put(wakeEnvelopeForWork(item), {
    deliverAt: input.notBefore ?? deps.now(),
  })
  return item
}
