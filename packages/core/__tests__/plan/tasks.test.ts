import { describe, it, expect, afterEach } from 'vitest'
import { z } from 'zod'
import { inMemoryRecordStore } from '../../storage'
import { plan } from '../../plan/plans'
import { task } from '../../plan/task-spec'
import { getTaskList, tasks } from '../../plan/tasks'
import type { JsonObject, JsonValue, TasksHandle } from '../../plan/types'
import { updateHooks, resetHooks } from '../../runtime/runtime'

/** Create a fresh store and register it in the runtime. */
function setup() {
  const store = inMemoryRecordStore()
  updateHooks({ records: store })
  return store
}

afterEach(() => resetHooks())

describe('Task ledger lifecycle', () => {
  it('tasks() persists immediately with optional plan, title, and metadata', async () => {
    setup()
    const p = await plan({ title: 'Test' })
    const handle = await tasks({
      plan: p,
      title: 'Test tasks',
      metadata: { threadId: 'thread-abc' },
    })

    await expect(handle.get()).resolves.toMatchObject({
      id: handle.id,
      planId: p.id,
      title: 'Test tasks',
      metadata: { threadId: 'thread-abc' },
      status: 'pending',
    })
  })

  it('tasks({ items }) creates pending task rows from keyed task specs', async () => {
    setup()

    const handle = await tasks({
      title: 'Launch tasks',
      items: {
        research: task('Research launch channels', {
          description: 'Find partner and community launch options.',
          assignee: { agent: 'researcher' },
          metadata: { phase: 'research' },
        }),
        draft: task('Draft announcement'),
      },
    })

    await expect(handle.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'research',
          label: 'Research launch channels',
          description: 'Find partner and community launch options.',
          assignee: { agent: 'researcher' },
          metadata: { phase: 'research' },
          status: 'pending',
        }),
        expect.objectContaining({
          id: 'draft',
          label: 'Draft announcement',
          status: 'pending',
        }),
      ]),
    )
    await expect(handle.get()).resolves.toMatchObject({ status: 'pending' })
  })

  it('complete() validates schema-backed task results before storing them', async () => {
    setup()
    const handle = await tasks({
      items: {
        research: task('Research', {
          result: z.object({ sources: z.array(z.string()) }),
        }),
      },
    })
    const unsafeHandle = handle as unknown as TasksHandle

    await expect(unsafeHandle.complete('research', { markdown: 'wrong shape' })).rejects.toMatchObject({
      name: 'TaskResultValidationError',
      taskListId: handle.id,
      taskId: 'research',
    })
    const pendingTask = await handle.getTask('research')
    expect(pendingTask).toMatchObject({ status: 'pending' })
    expect(pendingTask).not.toHaveProperty('result')

    await expect(handle.complete('research', { sources: ['docs'] })).resolves.toMatchObject({
      status: 'completed',
      result: { sources: ['docs'] },
    })
  })

  it('rejects non-JSON task values before they enter the store', async () => {
    setup()

    await expect(
      tasks({
        metadata: { bad: () => undefined } as unknown as JsonObject,
      }),
    ).rejects.toMatchObject({ name: 'TaskJsonValueError' })

    const handle = await tasks()
    const unsafeAdd = handle.add as unknown as (input: {
      id: string
      label: string
      metadata: unknown
    }) => Promise<unknown>
    await expect(
      unsafeAdd({
        id: 'bad-metadata',
        label: 'Bad metadata',
        metadata: { bad: () => undefined },
      }),
    ).rejects.toMatchObject({
      name: 'TaskJsonValueError',
      taskListId: handle.id,
      taskId: 'bad-metadata',
    })

    await handle.add({ id: 'result', label: 'Result' })
    const unsafeHandle = handle as unknown as TasksHandle
    await expect(unsafeHandle.complete('result', 1n as unknown as JsonValue)).rejects.toMatchObject({
      name: 'TaskJsonValueError',
      taskListId: handle.id,
      taskId: 'result',
    })
    const symbolKeyed = { ok: true } as Record<PropertyKey, unknown>
    symbolKeyed[Symbol('hidden')] = 'dropped'
    await expect(unsafeHandle.complete('result', symbolKeyed as JsonValue)).rejects.toMatchObject({
      name: 'TaskJsonValueError',
      taskListId: handle.id,
      taskId: 'result',
    })
    const nonEnumerable = { ok: true }
    Object.defineProperty(nonEnumerable, 'hidden', {
      enumerable: false,
      value: 'dropped',
    })
    await expect(unsafeHandle.complete('result', nonEnumerable as JsonValue)).rejects.toMatchObject({
      name: 'TaskJsonValueError',
      taskListId: handle.id,
      taskId: 'result',
    })
    await expect(handle.getTask('result')).resolves.toMatchObject({ status: 'pending' })
  })

  it('preserves schema validation through task tools and workers', async () => {
    setup()
    const handle = await tasks({
      items: {
        research: task('Research', {
          result: z.object({ sources: z.array(z.string()) }),
        }),
      },
    })

    const { updateTask } = handle.asTools()
    expect(updateTask.parameters.safeParse({ taskId: 'research', status: 'pending' }).success).toBe(false)
    await expect(
      updateTask.execute({ taskId: 'research', status: 'completed', result: { markdown: 'wrong' } }),
    ).rejects.toMatchObject({
      name: 'TaskResultValidationError',
      taskListId: handle.id,
      taskId: 'research',
    })

    const { completeTask } = handle.worker('research').asTools()
    await expect(completeTask.execute({ result: { markdown: 'wrong' } })).rejects.toMatchObject({
      name: 'TaskResultValidationError',
      taskListId: handle.id,
      taskId: 'research',
    })
  })

  it('add() stores user-provided task IDs and keeps all-pending lists pending', async () => {
    setup()
    const handle = await tasks()

    const task = await handle.add({
      id: 'research',
      label: 'Research cloud migration',
      description: 'Find recent case studies',
      assignee: { agent: 'researcher', model: 'gpt-4o' },
    })

    expect(task).toMatchObject({
      id: 'research',
      taskListId: handle.id,
      label: 'Research cloud migration',
      status: 'pending',
      assignee: { agent: 'researcher', model: 'gpt-4o' },
    })
    expect((await handle.get())!.status).toBe('pending')
  })

  it('focused lifecycle methods derive list status from active task rows', async () => {
    setup()
    const handle = await tasks()

    await handle.add({ id: 't1', label: 'Task 1' })
    await handle.add({ id: 't2', label: 'Task 2' })

    await handle.complete('t1')
    expect((await handle.get())!.status).toBe('in_progress')

    await handle.fail('t2', 'API timeout')
    expect((await handle.get())!.status).toBe('failed')

    const failed = await handle.getTask('t2')
    expect(failed).toMatchObject({ status: 'failed', error: 'API timeout' })
  })

  it('in-progress work takes precedence over failed work', async () => {
    setup()
    const handle = await tasks()

    await handle.add({ id: 't1', label: 'Task 1' })
    await handle.add({ id: 't2', label: 'Task 2' })
    await handle.start('t1')
    await handle.fail('t2', 'Blocked')

    expect((await handle.get())!.status).toBe('in_progress')
  })

  it('remove() excludes tasks from list() and status derivation', async () => {
    const store = setup()
    const handle = await tasks()

    await handle.add({ id: 't1', label: 'Keep' })
    await handle.add({ id: 't2', label: 'Remove' })
    await handle.complete('t1')
    await handle.remove('t2')

    expect(await handle.list()).toEqual([expect.objectContaining({ id: 't1' })])
    expect((await handle.get())!.status).toBe('completed')

    const removed = await store.get(`task:${handle.id}:t2`)
    expect(removed!.removedAt).toBeTypeOf('number')
  })

  it('all tasks removed completes the list because no active work remains', async () => {
    setup()
    const handle = await tasks()

    await handle.add({ id: 't1', label: 'Task 1' })
    await handle.add({ id: 't2', label: 'Task 2' })
    await handle.remove('t1')
    await handle.remove('t2')

    expect((await handle.get())!.status).toBe('completed')
  })

  it('skip() counts as terminal completion', async () => {
    setup()
    const handle = await tasks()

    await handle.add({ id: 't1', label: 'Task 1' })
    await handle.add({ id: 't2', label: 'Task 2' })
    await handle.complete('t1')
    await handle.skip('t2', 'No longer needed')

    expect((await handle.get())!.status).toBe('completed')
  })

  it('tasks.list() returns all task ledgers for a plan', async () => {
    setup()
    const p = await plan({ title: 'Test Plan' })
    const first = await tasks({ plan: p, title: 'First' })
    const second = await tasks({ plan: p.id, title: 'Second' })
    await tasks({ title: 'Standalone' })

    const listed = await tasks.list({ plan: p })
    expect(listed).toHaveLength(2)
    expect(listed).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: second.id }), expect.objectContaining({ id: first.id })]),
    )
  })

  it('handle.asContext(), asTools(), and worker() use canonical handle operations', async () => {
    setup()
    const handle = await tasks()
    await handle.add({ id: 'write-intro', label: 'Write introduction' })
    await handle.add({ id: 'research', label: 'Research' })
    await handle.complete('research')

    const system = await handle.asContext().systemFn({})
    expect(system).toContain('Write introduction')
    expect(system).toContain('Research')
    expect(system).toContain('1/2')

    const tools = handle.asTools()
    expect(tools.listTasks).toBeDefined()
    expect(tools.addTask).toBeDefined()
    expect(tools.updateTask).toBeDefined()
    expect(tools.removeTask).toBeDefined()

    const worker = handle.worker('write-intro')
    const workerSystem = await worker.asContext().systemFn({})
    expect(workerSystem).toContain('Write introduction')
    expect(workerSystem).toContain('Your Assignment')

    await worker.asTools().startTask.execute({})
    await worker.asTools().completeTask.execute({ result: { ok: true } })
    await expect(handle.getTask('write-intro')).resolves.toMatchObject({
      status: 'completed',
      result: { ok: true },
    })
  })

  it('getTaskList() remains available for internal read-model plumbing', async () => {
    setup()
    const handle = await tasks()
    await handle.add({ id: 't1', label: 'Task 1' })
    await handle.complete('t1')

    await expect(getTaskList(handle.id)).resolves.toMatchObject({
      id: handle.id,
      status: 'completed',
    })
  })
})
