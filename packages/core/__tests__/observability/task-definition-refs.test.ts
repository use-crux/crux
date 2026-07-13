import { afterEach, describe, expect, it } from 'vitest'
import {
  createRuntime,
  durableTask,
  node,
  type TaskId,
  type WorkId,
} from '../../src/runtime/public'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import type { DefinitionRef } from '../../src/observability'
import { inMemoryRecordStore } from '../../src/storage'
import { tasks } from '../../src/plan/tasks'
import { updateHooks, resetHooks } from '../../src/runtime/runtime'

type Transport = ReturnType<typeof createInMemoryObservabilityTransport>

function taskOperationSpanStarts(transport: Transport) {
  return transport.records.filter(
    (record) => record.type === 'span:start' && record.primitive === 'task.operation',
  ) as Array<{ name?: string; definitionRefs?: DefinitionRef[] }>
}

describe('durableTask() execution emits an invoked-task definition ref; plan ledger CRUD never fabricates one', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

  it('emits task:<safeId(name)> on the task.operation span for a real durableTask() execution', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    let nextWork = 0
    const seenInputs: unknown[] = []
    // `durableTask()` requires `name`, so this ref is always canonical.
    const embedDocument = durableTask('embed-document', {
      run: async (input: { documentId: string }) => {
        seenInputs.push(input)
      },
    })
    const runtime = createRuntime({
      runtime: node({ namespace: 'tenant-a', autoStartMaintenance: false }),
      targets: { [embedDocument.name]: embedDocument },
      newWorkId: () => `work_task_${++nextWork}` as WorkId,
    })

    await runtime.kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: embedDocument.targetId,
      input: { documentId: 'doc_1' },
    })
    await runtime.dispatcher.nudge()
    await observe.flush()
    runtime.dispose()

    expect(seenInputs).toEqual([{ documentId: 'doc_1' }])

    const spans = taskOperationSpanStarts(transport)
    const executionSpan = spans.find((s) => s.name === 'task.operation')
    expect(executionSpan?.definitionRefs).toEqual([
      { id: 'task:embed-document', kind: 'task', role: 'invoked-task' },
    ])
  })

  it('never attaches a task DefinitionRef to plan/tasks.ts ledger CRUD spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    updateHooks({ records: inMemoryRecordStore() })

    const handle = await tasks()
    await handle.add({ id: 'research', label: 'Research launch channels' })
    await handle.complete('research')
    await observe.flush()

    const spans = taskOperationSpanStarts(transport)
    expect(spans.length).toBeGreaterThan(0)
    for (const span of spans) {
      expect(span.definitionRefs, span.name).toBeUndefined()
    }
  })
})
