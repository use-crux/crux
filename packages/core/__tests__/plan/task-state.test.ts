import { afterEach, describe, expect, it } from 'vitest'
import { taskListKey } from '../../plan/helpers'
import { getTaskList, tasks } from '../../plan/tasks'
import { resetRuntime, updateRuntime } from '../../runtime/runtime'
import type { JsonObject, RecordListOptions, RecordPage, RecordStore, RecordWriteOptions } from '../../storage'
import { inMemoryRecordStore } from '../../storage'

/** Create fresh records and register them in the runtime. */
function setup() {
  const records = inMemoryRecordStore()
  updateRuntime({ records })
  return records
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
    const handle = await tasks()

    await handle.add({ id: 'research', label: 'Research cloud migration' })

    await expectTaskError(handle.add({ id: 'research', label: 'Different task' }), 'DuplicateTaskIdError', {
      taskListId: handle.id,
      taskId: 'research',
    })

    await handle.complete('research')

    const items = await handle.list()
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('Research cloud migration')
    expect((await handle.get())!.status).toBe('completed')
  })

  it('rejects concurrent duplicate task IDs atomically', async () => {
    const store = createDuplicateInsertRaceStore()
    updateRuntime({ records: store })
    const handle = await tasks()

    const results = await Promise.allSettled([
      handle.add({ id: 'research', label: 'Research cloud migration' }),
      handle.add({ id: 'research', label: 'Different task' }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      reason: {
        name: 'DuplicateTaskIdError',
        taskListId: handle.id,
        taskId: 'research',
      },
    })
    await expect(handle.list()).resolves.toEqual([expect.objectContaining({ id: 'research' })])
  })

  it('rejects updates to removed tasks without changing the removed row', async () => {
    const store = setup()
    const handle = await tasks()

    await handle.add({ id: 't1', label: 'Task 1' })
    await handle.remove('t1')

    await expectTaskError(handle.complete('t1'), 'TaskRemovedError', {
      taskListId: handle.id,
      taskId: 't1',
    })

    const stored = await store.get(`task:${handle.id}:t1`)
    expect(stored!.removedAt).toBeTypeOf('number')
    expect(stored!.status).toBe('pending')
    expect(await handle.list()).toEqual([])
  })

  it('rejects task mutations after discard while preserving discarded state', async () => {
    const store = setup()
    const handle = await tasks()

    await handle.add({ id: 't1', label: 'Task 1' })
    await handle.discard('No longer needed')

    await expectTaskError(handle.complete('t1'), 'TaskListDiscardedError', {
      taskListId: handle.id,
    })
    await expectTaskError(handle.add({ id: 't2', label: 'New task' }), 'TaskListDiscardedError', {
      taskListId: handle.id,
    })
    await expectTaskError(handle.remove('t1'), 'TaskListDiscardedError', {
      taskListId: handle.id,
    })

    expect((await handle.get())!.status).toBe('discarded')
    expect(await handle.list()).toHaveLength(1)

    const t1 = await store.get(`task:${handle.id}:t1`)
    expect(t1!.status).toBe('cancelled')
    expect(await store.get(`task:${handle.id}:t2`)).toBeNull()
  })

  it('keeps discard idempotent without rewriting the original reason', async () => {
    const store = setup()
    const handle = await tasks()

    await handle.add({ id: 't1', label: 'Task 1' })
    await handle.discard('Original reason')
    await handle.discard('Second reason')

    const list = await getTaskList(handle.id)
    expect(list!.status).toBe('discarded')
    expect(list!.discardReason).toBe('Original reason')

    const task = await store.get(`task:${handle.id}:t1`)
    expect(task!.status).toBe('cancelled')
  })

  it('rejects remove() when the task list does not exist', async () => {
    setup()
    const handle = tasks.ref('missing-list')

    await expectTaskError(handle.remove('t1'), 'TaskListNotFoundError', {
      taskListId: 'missing-list',
    })
  })

  it('rejects discard() when the task list does not exist', async () => {
    setup()
    const handle = tasks.ref('missing-list')

    await expectTaskError(handle.discard('No longer needed'), 'TaskListNotFoundError', {
      taskListId: 'missing-list',
    })
  })

  it('rejects status changes from terminal tasks but allows display-field edits', async () => {
    setup()
    const handle = await tasks()

    await handle.add({ id: 't1', label: 'Task 1' })
    await handle.complete('t1')

    await expectTaskError(handle.fail('t1', 'Too late'), 'InvalidTaskTransitionError', {
      taskListId: handle.id,
      taskId: 't1',
      from: 'completed',
      to: 'failed',
    })

    const edited = await handle.progress('t1', 'Final notes recorded')
    expect(edited.status).toBe('completed')
    expect(edited.progress).toBe('Final notes recorded')
  })

  it('allows task-list management tools to cancel tasks', async () => {
    setup()
    const handle = await tasks()
    await handle.add({ id: 't1', label: 'Task 1' })

    const { updateTask } = handle.asTools()
    expect(updateTask.parameters.safeParse({ taskId: 't1', status: 'cancelled' }).success).toBe(true)

    await updateTask.execute({ taskId: 't1', status: 'cancelled' })
    await expect(handle.getTask('t1')).resolves.toMatchObject({
      status: 'cancelled',
    })
  })

  it('get() repairs stale counts from task rows', async () => {
    const store = setup()
    const handle = await tasks()

    await handle.add({ id: 't1', label: 'Task 1' })
    await handle.complete('t1')

    const key = taskListKey(handle.id)
    const rawList = await store.get(key)
    await store.put(key, {
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

    expect((await handle.get())!.status).toBe('completed')

    const repaired = await store.get(key)
    expect(repaired!.status).toBe('completed')
    expect(repaired!.counts).toMatchObject({
      pending: 0,
      completed: 1,
    })
  })

  it('clears completedAt when repaired status moves away from completed', async () => {
    const store = setup()
    const handle = await tasks()

    await handle.add({ id: 't1', label: 'Task 1' })
    await handle.complete('t1')

    const key = taskListKey(handle.id)
    const rawList = await store.get(key)
    await store.put(`task:${handle.id}:t2`, {
      id: 't2',
      taskListId: handle.id,
      label: 'Task 2',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    expect(rawList!.completedAt).toBeTypeOf('number')
    const repaired = await handle.get()
    expect(repaired!.status).toBe('in_progress')
    expect(repaired).not.toHaveProperty('completedAt')
  })
})

function createDuplicateInsertRaceStore(): RecordStore {
  const base = inMemoryRecordStore()
  let taskKey: string | undefined
  let waitingTaskInserts = 0
  let releaseInserts: (() => void) | undefined
  const releasePromise = new Promise<void>((resolve) => {
    releaseInserts = resolve
  })

  return {
    async get(key: string): Promise<JsonObject | null> {
      return base.get(key)
    },
    put(key: string, value: JsonObject, options?: RecordWriteOptions): Promise<void> {
      return base.put(key, value, options)
    },
    async create(key: string, value: JsonObject, options?: RecordWriteOptions): Promise<boolean> {
      if (key.startsWith('task:') && !taskKey) {
        taskKey = key
      }
      if (key === taskKey) {
        waitingTaskInserts += 1
        if (waitingTaskInserts === 2) releaseInserts?.()
        await releasePromise
      }
      return base.create(key, value, options)
    },
    delete(key: string): Promise<void> {
      return base.delete(key)
    },
    list(prefix: string, options?: RecordListOptions): Promise<RecordPage> {
      return base.list(prefix, options)
    },
    watch: base.watch?.bind(base),
    capabilities: base.capabilities,
  }
}
