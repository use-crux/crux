import { describe, it, expect, afterEach } from 'vitest'
import { inMemoryRecordStore } from '../../src/storage'
import { plan } from '../../src/plan/plans'
import { tasks } from '../../src/plan/tasks'
import { task } from '../../src/plan/task-spec'
import * as planEntrypoint from '../../src/plan'
import * as tasksEntrypoint from '../../src/tasks'
import * as rootEntrypoint from '../../src/index'
import { updateHooks, resetHooks } from '../../src/runtime/runtime'

/** Register a fresh in-memory store for each test. */
function setup() {
  const store = inMemoryRecordStore()
  updateHooks({ records: store })
  return store
}

afterEach(() => resetHooks())

describe('canonical Plans & Tasks API', () => {
  it('public entrypoints export canonical names and omit removed names', () => {
    expect(planEntrypoint.plan).toBe(plan)
    expect(planEntrypoint.tasks).toBe(tasks)
    expect(planEntrypoint.task).toBe(task)
    expect(tasksEntrypoint.tasks).toBe(tasks)
    expect(tasksEntrypoint.task).toBe(task)
    expect(rootEntrypoint.plan).toBe(plan)
    expect(rootEntrypoint.tasks).toBe(tasks)
    expect(rootEntrypoint.task).toBe(task)

    for (const entrypoint of [planEntrypoint, tasksEntrypoint, rootEntrypoint]) {
      expect(entrypoint).not.toHaveProperty('tasklist')
      expect(entrypoint).not.toHaveProperty('planAgent')
      expect(entrypoint).not.toHaveProperty('taskListAgent')
      expect(entrypoint).not.toHaveProperty('taskWorker')
      expect(entrypoint).not.toHaveProperty('createPlanTool')
      expect(entrypoint).not.toHaveProperty('createTaskListTool')
      expect(entrypoint).not.toHaveProperty('getTaskListByPlan')
      expect(entrypoint).not.toHaveProperty('createHandle')
    }
  })

  it('tasks() creates a canonical handle with focused lifecycle methods', async () => {
    setup()
    const p = await plan({ title: 'Launch' })
    const work = await tasks({ plan: p, title: 'Launch tasks' })

    await expect(work.get()).resolves.toMatchObject({
      id: work.id,
      planId: p.id,
      title: 'Launch tasks',
      status: 'pending',
    })

    const added = await work.add({ id: 'research', label: 'Research launch channels' })
    expect(added.status).toBe('pending')

    await work.start('research')
    await work.progress('research', 'Reading launch examples')
    const completed = await work.complete('research', { channels: ['partners'] })

    expect(completed.status).toBe('completed')
    expect(completed.result).toEqual({ channels: ['partners'] })
    await expect(work.getTask('research')).resolves.toMatchObject({
      id: 'research',
      progress: 'Reading launch examples',
      status: 'completed',
    })
    await expect(work.list()).resolves.toHaveLength(1)

    await expect(work.get()).resolves.toMatchObject({ status: 'completed' })
  })

  it('canonical factories expose ref() and list() helpers', async () => {
    setup()
    const p = await plan({
      title: 'Launch',
      metadata: { threadId: 'thread-1' },
    })
    const work = await tasks({ plan: p, title: 'Launch tasks' })

    await expect(plan.ref(p.id).get()).resolves.toMatchObject({ title: 'Launch' })
    await expect(tasks.ref(work.id).get()).resolves.toMatchObject({ title: 'Launch tasks' })

    await expect(plan.list({ metadata: { threadId: 'thread-1' } })).resolves.toEqual([
      expect.objectContaining({ id: p.id }),
    ])
    await expect(plan.list({ metadata: { 'thread.id': 'thread-1' } })).rejects.toThrow(
      'Metadata filter keys cannot contain "."',
    )
    await expect(tasks.list({ plan: p })).resolves.toEqual([expect.objectContaining({ id: work.id })])
    await expect(tasks.list({ metadata: { 'thread.id': 'thread-1' } })).rejects.toThrow(
      'Metadata filter keys cannot contain "."',
    )
  })

  it('canonical creation tools expose safe created() accessors', async () => {
    setup()
    const makePlan = plan.tool({ template: '1. Objective\n2. Risks' })

    expect(() => makePlan.created()).toThrowError(
      expect.objectContaining({
        name: 'CreationToolNotCreatedError',
      }),
    )

    const planResult = JSON.parse(await makePlan.execute({ title: 'Tool Plan' }))
    const createdPlan = makePlan.created()
    expect(planResult).toMatchObject({ id: createdPlan.id, title: 'Tool Plan', version: 1 })
    await expect(createdPlan.get()).resolves.toMatchObject({ title: 'Tool Plan' })

    const makeTasks = tasks.tool({ plan: createdPlan, title: 'Tool Tasks' })
    const taskResult = JSON.parse(await makeTasks.execute({}))
    const createdTasks = makeTasks.created()
    expect(taskResult).toMatchObject({ id: createdTasks.id, status: 'pending', planId: createdPlan.id })
    await expect(createdTasks.get()).resolves.toMatchObject({ title: 'Tool Tasks' })
  })
})
