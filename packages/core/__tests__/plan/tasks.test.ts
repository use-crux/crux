import { describe, it, expect, afterEach } from 'vitest'
import { inMemoryCruxStore } from '../../store/memory'
import { plan } from '../../plan/plans'
import { tasklist, getTaskList, getTaskListByPlan } from '../../plan/tasks'
import { updateRuntime, resetRuntime } from '../../runtime/runtime'

/** Create a fresh store and register it in the runtime. */
function setup() {
  const store = inMemoryCruxStore()
  updateRuntime({ store })
  return store
}

afterEach(() => resetRuntime())

describe('TaskList lifecycle', () => {
  it('tasklist() persists immediately with status pending', async () => {
    const store = setup()
    const handle = await tasklist({})

    expect(handle.id).toBeDefined()

    // Verify persisted in store
    const stored = await store.get(`tasklist:${handle.id}`)
    expect(stored).not.toBeNull()
    expect(stored!.status).toBe('pending')
  })

  it('tasklist() with planId association', async () => {
    const store = setup()
    const p = await plan({ title: 'Test' })
    const handle = await tasklist({ planId: p.id })

    const list = await getTaskList(handle.id)
    expect(list).not.toBeNull()
    expect(list!.planId).toBe(p.id)
  })

  it('addTask stores task with user-provided ID', async () => {
    const store = setup()
    const handle = await tasklist({})

    const task = await handle.addTask({
      id: 'research',
      label: 'Research cloud migration',
      description: 'Find recent case studies',
      assignee: { agent: 'researcher', model: 'gpt-4o' },
    })

    expect(task.id).toBe('research')
    expect(task.taskListId).toBe(handle.id)
    expect(task.label).toBe('Research cloud migration')
    expect(task.status).toBe('pending')
    expect(task.assignee).toEqual({ agent: 'researcher', model: 'gpt-4o' })
  })

  it('addTask transitions list from pending to in_progress', async () => {
    const store = setup()
    const handle = await tasklist({})

    // Before adding tasks
    const statusBefore = await handle.getStatus()
    expect(statusBefore).toBe('pending')

    await handle.addTask({ id: 't1', label: 'First task' })

    const statusAfter = await handle.getStatus()
    expect(statusAfter).toBe('in_progress')
  })

  it('updateTask to completed on all tasks triggers auto-completion', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.addTask({ id: 't2', label: 'Task 2' })

    await handle.updateTask('t1', { status: 'completed' })
    // One task still pending — list should be in_progress
    expect(await handle.getStatus()).toBe('in_progress')

    await handle.updateTask('t2', { status: 'completed' })
    // All tasks completed — list should auto-complete
    expect(await handle.getStatus()).toBe('completed')

    const list = await getTaskList(handle.id)
    expect(list!.completedAt).toBeTypeOf('number')
  })

  it('updateTask to failed with no in_progress tasks fails the list', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.addTask({ id: 't2', label: 'Task 2' })

    await handle.updateTask('t1', { status: 'completed' })
    await handle.updateTask('t2', { status: 'failed', error: 'API timeout' })

    expect(await handle.getStatus()).toBe('failed')
  })

  it('failed task with in_progress task keeps list in_progress', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.addTask({ id: 't2', label: 'Task 2' })

    await handle.updateTask('t1', { status: 'in_progress' })
    await handle.updateTask('t2', { status: 'failed' })

    // t1 still in_progress — list stays in_progress
    expect(await handle.getStatus()).toBe('in_progress')
  })

  it('removeTask soft-deletes and is excluded from auto-completion', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.addTask({ id: 't2', label: 'Task 2 (will remove)' })

    await handle.updateTask('t1', { status: 'completed' })
    await handle.removeTask('t2')

    // t2 removed, t1 completed — list should complete
    expect(await handle.getStatus()).toBe('completed')

    // Removed task still in store but with removedAt
    const stored = await store.get(`task:${handle.id}:t2`)
    expect(stored).not.toBeNull()
    expect(stored!.removedAt).toBeTypeOf('number')
  })

  it('discard sets list to discarded and cancels pending/in_progress tasks', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.addTask({ id: 't2', label: 'Task 2' })
    await handle.updateTask('t1', { status: 'in_progress' })
    await handle.updateTask('t2', { status: 'completed' })

    await handle.discard('User changed direction')

    expect(await handle.getStatus()).toBe('discarded')

    const list = await getTaskList(handle.id)
    expect(list!.discardedAt).toBeTypeOf('number')
    expect(list!.discardReason).toBe('User changed direction')

    // t1 was in_progress — should be cancelled
    const t1 = await store.get(`task:${handle.id}:t1`)
    expect(t1!.status).toBe('cancelled')

    // t2 was completed — should stay completed
    const t2 = await store.get(`task:${handle.id}:t2`)
    expect(t2!.status).toBe('completed')
  })

  it('dynamic addTask mid-execution', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Initial task' })
    await handle.updateTask('t1', { status: 'in_progress' })

    // Dynamically add a new task
    const newTask = await handle.addTask({
      id: 't2',
      label: 'Discovered task',
    })
    expect(newTask.id).toBe('t2')
    expect(newTask.status).toBe('pending')

    const tasks = await handle.getTasks()
    expect(tasks).toHaveLength(2)
  })

  it('all tasks removed results in list completed', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.addTask({ id: 't2', label: 'Task 2' })

    await handle.removeTask('t1')
    await handle.removeTask('t2')

    // No work remaining — should complete
    expect(await handle.getStatus()).toBe('completed')
  })

  it('getStatus self-heals stale status', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.updateTask('t1', { status: 'completed' })

    // Manually corrupt stored status to be stale
    const rawList = await store.get(`tasklist:${handle.id}`)
    await store.set(`tasklist:${handle.id}`, {
      ...rawList!,
      status: 'in_progress',
    })

    // getStatus should self-heal and return the correct derived status
    const status = await handle.getStatus()
    expect(status).toBe('completed')

    // Verify it was corrected in the store
    const fixed = await store.get(`tasklist:${handle.id}`)
    expect(fixed!.status).toBe('completed')
  })

  it('getTaskListByPlan finds task list by planId', async () => {
    const store = setup()
    const p = await plan({ title: 'Test Plan' })
    const handle = await tasklist({ planId: p.id })

    const found = await getTaskListByPlan(p.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(handle.id)
  })

  it('getTaskListByPlan returns null for no match', async () => {
    const store = setup()
    const found = await getTaskListByPlan('nonexistent')
    expect(found).toBeNull()
  })

  it('getTasks excludes removed tasks', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Keep' })
    await handle.addTask({ id: 't2', label: 'Remove' })
    await handle.removeTask('t2')

    const tasks = await handle.getTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe('t1')
  })

  it('updateTask returns updated task', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    const updated = await handle.updateTask('t1', {
      status: 'in_progress',
      progress: 'Working on it...',
    })

    expect(updated.status).toBe('in_progress')
    expect(updated.progress).toBe('Working on it...')
  })

  it('skipped tasks count as terminal for auto-completion', async () => {
    const store = setup()
    const handle = await tasklist({})

    await handle.addTask({ id: 't1', label: 'Task 1' })
    await handle.addTask({ id: 't2', label: 'Task 2' })

    await handle.updateTask('t1', { status: 'completed' })
    await handle.updateTask('t2', { status: 'skipped' })

    expect(await handle.getStatus()).toBe('completed')
  })

  it('tasklist() with metadata', async () => {
    const store = setup()
    const handle = await tasklist({
      metadata: { threadId: 'thread-abc' },
    })

    const list = await getTaskList(handle.id)
    expect(list!.metadata).toEqual({ threadId: 'thread-abc' })
  })
})

describe('TaskListHandle agent methods', () => {
  it('handle.asContext() renders task summary', async () => {
    const store = setup()
    const handle = await tasklist({})
    await handle.addTask({ id: 't1', label: 'Research' })
    await handle.addTask({ id: 't2', label: 'Write' })
    await handle.updateTask('t1', { status: 'completed' })

    const ctx = handle.asContext()
    const system = await ctx.systemFn({})
    expect(system).toContain('Research')
    expect(system).toContain('Write')
    expect(system).toContain('1/2')
  })

  it('handle.asTools() returns focused tools', async () => {
    const store = setup()
    const handle = await tasklist({})

    const tools = handle.asTools()
    expect(tools.listTasks).toBeDefined()
    expect(tools.addTask).toBeDefined()
    expect(tools.updateTask).toBeDefined()
    expect(tools.removeTask).toBeDefined()
    expect(tools.discardTaskList).toBeDefined()
  })

  it('handle.worker() returns a TaskWorker for a specific task', async () => {
    const store = setup()
    const handle = await tasklist({})
    await handle.addTask({ id: 'write-intro', label: 'Write introduction' })

    const worker = handle.worker('write-intro')
    expect(worker.taskId).toBe('write-intro')
    expect(worker.taskListId).toBe(handle.id)

    // Worker has context and tools
    const ctx = worker.asContext()
    const system = await ctx.systemFn({})
    expect(system).toContain('Write introduction')
    expect(system).toContain('Your Assignment')

    const tools = worker.asTools()
    expect(tools.startTask).toBeDefined()
    expect(tools.completeTask).toBeDefined()
  })
})
