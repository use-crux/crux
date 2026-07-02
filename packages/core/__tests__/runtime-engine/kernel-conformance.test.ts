import { inMemoryRuntimeStore } from '../../runtime/adapters/memory'
import type { RuntimeTargetId, TaskId, WorkId } from '../../runtime/ports'
import { createRuntimeKernel } from '../../runtime/engine/kernel'
import { runRuntimeEngineAdapterTests } from '../../runtime/testing'

runRuntimeEngineAdapterTests({
  name: 'in-memory RuntimeKernel',
  createHarness: () => {
    const store = inMemoryRuntimeStore()
    const targetId = 'embed-document' as RuntimeTargetId
    const kernel = createRuntimeKernel({
      store,
      targets: {
        [targetId]: {
          targetId,
          kind: 'task',
          execute: async ({ work }) => {
            await store.events.append({
              namespace: work.namespace,
              name: 'conformance.executed',
              payload: { workId: work.workId },
            })
            return { status: 'completed' }
          },
        },
      },
      newWorkId: () => 'work_task_1' as WorkId,
    })
    return {
      store,
      kernel,
      targetId,
      taskId: 'task_1' as TaskId,
      readExecutionCount: async () =>
        (await store.events.read({ namespace: 'tenant-a' })).events.filter(
          (event) => event.name === 'conformance.executed',
        ).length,
    }
  },
})
