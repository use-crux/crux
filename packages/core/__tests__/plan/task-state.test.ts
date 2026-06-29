import { afterEach, describe, expect, it } from 'vitest'
import { createHandle, getTaskList, tasklist } from '../../plan/tasks'
import { resetRuntime, updateRuntime } from '../../runtime/runtime'
import { inMemoryCruxStore } from '../../store/memory'

/** Create a fresh store and register it in the runtime. */
function setup() {
  const store = inMemoryCruxStore()
  updateRuntime({ store })
  return store
}

/** Expect a typed task lifecycle error without depending on class identity. */
async function expectTaskError(
  promise: Promise<unknown>,
  name: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name, ...fields })
}

afterEach(() => resetRuntime())

describe('TaskList state correctness', () => {
  it('rejects duplicate task IDs without corrupting visible state', async () => {
    setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 'research', label: 'Research cloud migration' })

    await expectTaskError(handle.addTask({ id: 'research', label: 'Different task' }), 'DuplicateTaskIdError', {
      taskListId: handle.id,
      taskId: 'research',
    })

    await handle.updateTask('research', { status: 'completed' })

    const tasks = await handle.getTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].label).toBe('Research cloud migration')
    expect(await handle.getStatus()).toBe('completed')
  })

  it('rejects updates to removed tasks without changing the removed row', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.removeTask('t1')

    await expectTaskError(handle.updateTask('t1', { status: 'completed' }), 'TaskRemovedError', {
      taskListId: handle.id,
      taskId: 't1',
    })

    const stored = await store.get(`task:${handle.id}:t1`)
    expect(stored!.removedAt).toBeTypeOf('number')
    expect(stored!.status).toBe('pending')
    expect(await handle.getTasks()).toEqual([])
  })

  it('rejects task mutations after discard while preserving discarded state', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.discard('No longer needed')

    await expectTaskError(handle.updateTask('t1', { status: 'completed' }), 'TaskListDiscardedError', {
      taskListId: handle.id,
    })
    await expectTaskError(handle.addTask({ id: 't2', label: 'New task' }), 'TaskListDiscardedError', {
      taskListId: handle.id,
    })
    await expectTaskError(handle.removeTask('t1'), 'TaskListDiscardedError', {
      taskListId: handle.id,
    })

    expect(await handle.getStatus()).toBe('discarded')
    expect(await handle.getTasks()).toHaveLength(1)

    const t1 = await store.get(`task:${handle.id}:t1`)
    expect(t1!.status).toBe('cancelled')
    expect(await store.get(`task:${handle.id}:t2`)).toBeNull()
  })

  it('keeps discard idempotent without rewriting the original reason', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.discard('Original reason')
    await handle.discard('Second reason')

    const list = await getTaskList(handle.id)
    expect(list!.status).toBe('discarded')
    expect(list!.discardReason).toBe('Original reason')

    const task = await store.get(`task:${handle.id}:t1`)
    expect(task!.status).toBe('cancelled')
  })

  it('rejects removeTask when the task list does not exist', async () => {
    setup()
    const handle = createHandle('missing-list')

    await expectTaskError(handle.removeTask('t1'), 'TaskListNotFoundError', {
      taskListId: 'missing-list',
    })
  })

  it('rejects status changes from terminal tasks but allows display-field edits', async () => {
    setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.updateTask('t1', { status: 'completed' })

    await expectTaskError(
      handle.updateTask('t1', { status: 'failed', error: 'Too late' }),
      'InvalidTaskTransitionError',
      {
        taskListId: handle.id,
        taskId: 't1',
        from: 'completed',
        to: 'failed',
      },
    )

    const edited = await handle.updateTask('t1', {
      progress: 'Final notes recorded',
    })
    expect(edited.status).toBe('completed')
    expect(edited.progress).toBe('Final notes recorded')
  })

  it('getStatus repairs stale counts from task rows', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.updateTask('t1', { status: 'completed' })

    const rawList = await store.get(`tasklist:${handle.id}`)
    await store.set(`tasklist:${handle.id}`, {
      ...rawList!,
      status: 'pending',
      counts: {
        pending: 1,
        in_progress: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
      },
    })

    expect(await handle.getStatus()).toBe('completed')

    const repaired = await store.get(`tasklist:${handle.id}`)
    expect(repaired!.status).toBe('completed')
    expect(repaired!.counts).toMatchObject({
      pending: 0,
      completed: 1,
    })
  })
})
