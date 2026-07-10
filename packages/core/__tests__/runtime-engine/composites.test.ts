import { describe, expect, it } from 'vitest'
import { inMemoryRuntimeStore } from '../../src/runtime/adapters/memory'
import { runDefaultRuntimeComposite } from '../../src/runtime/engine/composites'
import { createRuntimeKernel } from '../../src/runtime/engine/kernel'
import type {
  RuntimeCompositeInput,
  RuntimeCompositeKind,
  RuntimeCompositeResult,
} from '../../src/runtime/engine/composites'
import type { RuntimeStoreAdapter } from '../../src/runtime/store'
import type { RuntimeTargetId, TaskId, WorkId } from '../../src/runtime/ports'

describe('runtime composites', () => {
  it('routes task enqueue commits through the named composite contract', async () => {
    const base = inMemoryRuntimeStore()
    const seen: RuntimeCompositeKind[] = []
    const now = () => new Date('2026-07-06T12:00:00.000Z')
    const newWorkId = () => 'work_task_1' as WorkId
    const store: RuntimeStoreAdapter = {
      ...base,
      runComposite: async <K extends RuntimeCompositeKind>(
        kind: K,
        input: RuntimeCompositeInput[K],
      ): Promise<RuntimeCompositeResult[K]> => {
        seen.push(kind)
        return await runDefaultRuntimeComposite(
          base,
          { now, newWorkId },
          kind,
          input,
        )
      },
    }
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId,
      now,
    })

    const work = await kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: 'embed-document' as RuntimeTargetId,
    })

    expect(seen).toEqual(['task.enqueue'])
    await expect(
      base.state.getWork(work.workId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'pending', workId: work.workId })
    await expect(
      base.outbox.list({ namespace: 'tenant-a', state: 'pending' }),
    ).resolves.toHaveLength(1)
  })
})
