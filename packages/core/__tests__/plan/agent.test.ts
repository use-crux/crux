import { describe, it, expect, afterEach } from 'vitest'
import { inMemoryCruxStore } from '../../store/memory'
import { plan } from '../../plan/plans'
import { tasklist } from '../../plan/tasks'
import {
  planAgent,
  taskListAgent,
  taskWorker,
  createPlanTool,
  createTaskListTool,
} from '../../plan/agent'
import { updateRuntime, resetRuntime } from '../../runtime/runtime'

/** Create a fresh store and register it in the runtime. */
function setup() {
  const store = inMemoryCruxStore()
  updateRuntime({ store })
  return store
}

afterEach(() => resetRuntime())

describe('planAgent', () => {
  it('asContext injects full plan content by default', async () => {
    const store = setup()
    const p = await plan({
      title: 'Migration Guide',
      content: '## Step 1\nDo the thing.',
    })

    const agent = planAgent(p.id)
    const ctx = agent.asContext()

    const system = await ctx.systemFn({})
    expect(system).toContain('Migration Guide')
    expect(system).toContain('## Step 1')
    expect(system).toContain('v1')
  })

  it('asContext in reference mode injects only metadata', async () => {
    const store = setup()
    const p = await plan({ title: 'Big Plan', content: 'Long content...' })

    const agent = planAgent(p.id, { context: 'reference' })
    const ctx = agent.asContext()

    const system = await ctx.systemFn({})
    expect(system).toContain('Big Plan')
    expect(system).not.toContain('Long content')
    expect(system).toContain('getPlan')
  })

  it('renderContext override replaces default template', async () => {
    const store = setup()
    const p = await plan({ title: 'Custom', content: 'Body' })

    const agent = planAgent(p.id, {
      renderContext: (doc) => `CUSTOM: ${doc.title} v${doc.version}`,
    })

    const system = await agent.asContext().systemFn({})
    expect(system).toBe('CUSTOM: Custom v1')
  })

  it('asTools returns focused getPlan and updatePlan tools', async () => {
    const store = setup()
    const p = await plan({ title: 'Test Plan', content: 'Content' })

    const agent = planAgent(p.id)
    const { getPlan, updatePlan } = agent.asTools()

    // getPlan
    expect(getPlan.description).toContain('plan')
    const getResult = JSON.parse(await getPlan.execute({}))
    expect(getResult.title).toBe('Test Plan')

    // updatePlan
    await updatePlan.execute({ title: 'Updated Title' })
    const after = JSON.parse(await getPlan.execute({}))
    expect(after.title).toBe('Updated Title')
    expect(after.version).toBe(2)
  })
})

describe('taskListAgent', () => {
  it('asContext injects task list summary', async () => {
    const store = setup()
    const handle = await tasklist({})
    await handle.addTask({ id: 't1', label: 'Research' })
    await handle.addTask({ id: 't2', label: 'Write' })
    await handle.updateTask('t1', { status: 'completed' })

    const agent = taskListAgent(handle.id)
    const system = await agent.asContext().systemFn({})
    expect(system).toContain('Research')
    expect(system).toContain('Write')
    expect(system).toContain('1/2')
  })

  it('renderContext override replaces default template', async () => {
    const store = setup()
    const handle = await tasklist({})
    await handle.addTask({ id: 't1', label: 'Research' })

    const agent = taskListAgent(handle.id, {
      renderContext: (tasks) => `TASKS: ${tasks.length} items`,
    })

    const system = await agent.asContext().systemFn({})
    expect(system).toBe('TASKS: 1 items')
  })

  it('asTools returns focused tools for each operation', async () => {
    const store = setup()
    const handle = await tasklist({})

    const agent = taskListAgent(handle.id)
    const { listTasks, addTask, updateTask, removeTask } = agent.asTools()

    // Add
    const added = JSON.parse(await addTask.execute({ taskId: 'research', label: 'Research sources' }))
    expect(added.id).toBe('research')
    expect(added.status).toBe('pending')

    // List
    const tasks = JSON.parse(await listTasks.execute({}))
    expect(tasks).toHaveLength(1)

    // Update
    await updateTask.execute({ taskId: 'research', status: 'completed' })
    const afterUpdate = JSON.parse(await listTasks.execute({}))
    expect(afterUpdate[0].status).toBe('completed')

    // Remove
    await addTask.execute({ taskId: 't2', label: 'Extra' })
    await removeTask.execute({ taskId: 't2' })
    const afterRemove = JSON.parse(await listTasks.execute({}))
    expect(afterRemove).toHaveLength(1)
  })

  it('updateTask supports assignee reassignment', async () => {
    const store = setup()
    const handle = await tasklist({})
    await handle.addTask({
      id: 't1',
      label: 'Research',
      assignee: { agent: 'agent-a' },
    })

    const { updateTask, listTasks } = taskListAgent(handle.id).asTools()

    await updateTask.execute({
      taskId: 't1',
      assignee: { agent: 'agent-b', model: 'gpt-4o' },
    })
    const tasks = JSON.parse(await listTasks.execute({}))
    expect(tasks[0].assignee).toEqual({ agent: 'agent-b', model: 'gpt-4o' })
  })
})

describe('taskWorker', () => {
  it('asContext injects assignment and guidelines', async () => {
    const store = setup()
    const handle = await tasklist({})
    await handle.addTask({
      id: 'write-intro',
      label: 'Write introduction',
      description: 'Opening section',
      assignee: { agent: 'writer' },
    })

    const worker = taskWorker(handle.id, 'write-intro')
    const system = await worker.asContext().systemFn({})

    expect(system).toContain('Your Assignment')
    expect(system).toContain('Write introduction')
    expect(system).toContain('Opening section')
    expect(system).toContain('writer')
    expect(system).toContain('Guidelines')
    expect(system).toContain('startTask')
    expect(system).toContain('completeTask')
  })

  it('renderContext override replaces default', async () => {
    const store = setup()
    const handle = await tasklist({})
    await handle.addTask({ id: 't1', label: 'Research' })

    const worker = taskWorker(handle.id, 't1', {
      renderContext: (task, all) => `DO: ${task.label} (${all.length} total)`,
    })

    const system = await worker.asContext().systemFn({})
    expect(system).toBe('DO: Research (1 total)')
  })

  it('asTools returns focused start/progress/complete/fail tools', async () => {
    const store = setup()
    const handle = await tasklist({})
    await handle.addTask({ id: 't1', label: 'Research' })

    const worker = taskWorker(handle.id, 't1')
    const { startTask, reportProgress, completeTask } = worker.asTools()

    // No taskId param needed — bound
    const startResult = JSON.parse(await startTask.execute({}))
    expect(startResult.status).toBe('in_progress')

    const progressResult = JSON.parse(await reportProgress.execute({ message: 'Found 5 sources' }))
    expect(progressResult.ok).toBe(true)

    const completeResult = JSON.parse(await completeTask.execute({ result: { sourceCount: 5 } }))
    expect(completeResult.status).toBe('completed')

    const tasks = await handle.getTasks()
    expect(tasks[0].status).toBe('completed')
    expect(tasks[0].result).toEqual({ sourceCount: 5 })
  })

  it('failTask marks task as failed with error', async () => {
    const store = setup()
    const handle = await tasklist({})
    await handle.addTask({ id: 't1', label: 'Research' })

    const { startTask, failTask } = taskWorker(handle.id, 't1').asTools()

    await startTask.execute({})
    await failTask.execute({ error: 'API rate limited' })

    const tasks = await handle.getTasks()
    expect(tasks[0].status).toBe('failed')
    expect(tasks[0].error).toBe('API rate limited')
  })

  it('tool descriptions are self-contained and specific', async () => {
    const store = setup()
    const handle = await tasklist({})
    await handle.addTask({ id: 't1', label: 'Research' })

    const tools = taskWorker(handle.id, 't1').asTools()

    // Each tool description mentions the task ID (bound)
    expect(tools.startTask.description).toContain('t1')
    expect(tools.reportProgress.description).toContain('t1')
    expect(tools.completeTask.description).toContain('t1')
    expect(tools.failTask.description).toContain('t1')
  })
})

describe('createPlanTool', () => {
  it('creates a plan via tool execution', async () => {
    const store = setup()
    const tool = createPlanTool()

    expect(tool.description).toContain('plan')
    const result = JSON.parse(await tool.execute({ title: 'New Plan', content: 'Plan details' }))
    expect(result.id).toBeDefined()
    expect(result.title).toBe('New Plan')
    expect(result.version).toBe(1)
  })

  it('includes template in description when provided', () => {
    const store = setup()
    const tool = createPlanTool({
      template: '1. Objective\n2. Approach\n3. Risks',
    })

    expect(tool.description).toContain('The plan should follow this structure:')
    expect(tool.description).toContain('1. Objective')
  })

  it('.created captures a PlanHandle after execution', async () => {
    const store = setup()
    const tool = createPlanTool()

    expect(tool.created).toBeUndefined()
    await tool.execute({ title: 'Captured Plan' })
    expect(tool.created).not.toBeUndefined()
    expect(tool.created!.title).toBe('Captured Plan')
    expect(tool.created!.id).toBeDefined()

    // .created is a handle — has methods
    expect(typeof tool.created!.update).toBe('function')
    expect(typeof tool.created!.get).toBe('function')
    expect(typeof tool.created!.asContext).toBe('function')
    expect(typeof tool.created!.asTools).toBe('function')

    // Handle methods work
    const tools = tool.created!.asTools()
    expect(tools.getPlan).toBeDefined()
  })

  it('onCreated callback fires with the plan', async () => {
    const store = setup()
    let captured: unknown
    const tool = createPlanTool({
      onCreated: (p) => {
        captured = p
      },
    })

    await tool.execute({ title: 'Callback Plan' })
    expect(captured).toBeDefined()
    expect((captured as any).title).toBe('Callback Plan')
  })
})

describe('createTaskListTool', () => {
  it('creates a task list via tool execution', async () => {
    const store = setup()
    const p = await plan({ title: 'Test' })
    const tool = createTaskListTool()

    expect(tool.description).toContain('task list')
    const result = JSON.parse(await tool.execute({ planId: p.id }))
    expect(result.id).toBeDefined()
    expect(result.status).toBe('pending')
  })

  it('includes template in description when provided', () => {
    const store = setup()
    const tool = createTaskListTool({
      template: 'Each task should have a clear deliverable.',
    })

    expect(tool.description).toContain('When creating tasks:')
    expect(tool.description).toContain('Each task should have a clear deliverable.')
  })
})
