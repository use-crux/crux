import { describe, it, expect, afterEach } from 'vitest'
import { inMemoryCruxStore } from '../../store/memory'
import { plan, getPlan, updatePlan } from '../../plan/plans'
import { updateRuntime, resetRuntime } from '../../runtime'

/** Create a fresh store and register it in the runtime. */
function setup() {
  const store = inMemoryCruxStore()
  updateRuntime({ store })
  return store
}

afterEach(() => resetRuntime())

describe('Plan CRUD', () => {
  it('plan() generates UUID, sets version=1, timestamps', async () => {
    const store = setup()
    const p = await plan({ title: 'Test Plan' })

    expect(p.id).toBeDefined()
    expect(p.id.length).toBeGreaterThan(10)
    expect(p.title).toBe('Test Plan')
    expect(p.content).toBe('')
    expect(p.version).toBe(1)
    expect(p.createdAt).toBeTypeOf('number')
    expect(p.updatedAt).toBeTypeOf('number')
    expect(p.createdAt).toBeLessThanOrEqual(Date.now())
  })

  it('plan() with explicit content and metadata', async () => {
    const store = setup()
    const p = await plan({
      title: 'Migration Guide',
      content: '## Step 1\nDo the thing.',
      metadata: { threadId: 'thread-123' },
    })

    expect(p.title).toBe('Migration Guide')
    expect(p.content).toBe('## Step 1\nDo the thing.')
    expect(p.metadata).toEqual({ threadId: 'thread-123' })
  })

  it('plan() persists to store', async () => {
    const store = setup()
    const p = await plan({ title: 'Persisted' })

    const stored = await store.get(`plan:${p.id}`)
    expect(stored).not.toBeNull()
    expect(stored!.title).toBe('Persisted')
  })

  it('getPlan returns null for missing plan', async () => {
    const store = setup()
    const result = await getPlan('nonexistent')
    expect(result).toBeNull()
  })

  it('getPlan returns typed Plan', async () => {
    const store = setup()
    const created = await plan({ title: 'Fetch Me' })
    const fetched = await getPlan(created.id)

    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(created.id)
    expect(fetched!.title).toBe('Fetch Me')
    expect(fetched!.version).toBe(1)
  })

  it('updatePlan increments version on content change', async () => {
    const store = setup()
    const p = await plan({ title: 'V1', content: 'Original' })
    expect(p.version).toBe(1)

    const updated = await updatePlan(p.id, { content: 'Updated content' })
    expect(updated.version).toBe(2)
    expect(updated.content).toBe('Updated content')
    expect(updated.title).toBe('V1') // unchanged
  })

  it('updatePlan increments version on title change', async () => {
    const store = setup()
    const p = await plan({ title: 'Old Title' })

    const updated = await updatePlan(p.id, { title: 'New Title' })
    expect(updated.version).toBe(2)
    expect(updated.title).toBe('New Title')
  })

  it('updatePlan does NOT increment version on metadata-only change', async () => {
    const store = setup()
    const p = await plan({ title: 'Meta Test' })

    const updated = await updatePlan(p.id, { metadata: { key: 'val' } })
    expect(updated.version).toBe(1) // unchanged
    expect(updated.metadata).toEqual({ key: 'val' })
  })

  it('updatePlan updates updatedAt timestamp', async () => {
    const store = setup()
    const p = await plan({ title: 'Timestamp Test' })
    const originalUpdatedAt = p.updatedAt

    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 5))
    const updated = await updatePlan(p.id, { content: 'Changed' })

    expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt)
    expect(updated.createdAt).toBe(p.createdAt) // unchanged
  })

  it('updatePlan throws for missing plan', async () => {
    const store = setup()
    await expect(updatePlan('nonexistent', { title: 'Nope' })).rejects.toThrow()
  })

  it('updatePlan merges metadata', async () => {
    const store = setup()
    const p = await plan({
      title: 'Meta Test',
      metadata: { a: 1 },
    })

    const updated = await updatePlan(p.id, {
      metadata: { b: 2 },
    })
    // metadata replaces (not deep merge) — consistent with the interface
    expect(updated.metadata).toEqual({ b: 2 })
  })
})

describe('PlanHandle', () => {
  it('plan() returns a handle with data properties and methods', async () => {
    const store = setup()
    const p = await plan({ title: 'Handle Test', content: 'Body' })

    // Data properties (snapshot)
    expect(p.id).toBeDefined()
    expect(p.title).toBe('Handle Test')
    expect(p.content).toBe('Body')
    expect(p.version).toBe(1)

    // Methods exist
    expect(typeof p.update).toBe('function')
    expect(typeof p.get).toBe('function')
    expect(typeof p.asContext).toBe('function')
    expect(typeof p.asTools).toBe('function')
  })

  it('handle.update() persists changes and returns updated plan', async () => {
    const store = setup()
    const p = await plan({ title: 'V1', content: 'Original' })

    const updated = await p.update({ content: 'Revised' })
    expect(updated.version).toBe(2)
    expect(updated.content).toBe('Revised')

    // Verify persisted
    const latest = await getPlan(p.id)
    expect(latest!.content).toBe('Revised')
  })

  it('handle.get() re-reads latest from store', async () => {
    const store = setup()
    const p = await plan({ title: 'Test' })

    // Update via standalone function (not handle)
    await updatePlan(p.id, { title: 'Changed Externally' })

    // Handle.get() fetches latest
    const latest = await p.get()
    expect(latest!.title).toBe('Changed Externally')
  })

  it('handle.asContext() injects plan content', async () => {
    const store = setup()
    const p = await plan({ title: 'Context Test', content: '## Step 1' })

    const ctx = p.asContext()
    const system = await ctx.systemFn({})
    expect(system).toContain('Context Test')
    expect(system).toContain('## Step 1')
  })

  it('handle.asTools() returns focused tools', async () => {
    const store = setup()
    const p = await plan({ title: 'Tools Test' })

    const { getPlan: getPlanTool, updatePlan: updatePlanTool } = p.asTools()
    expect(getPlanTool.description).toContain('plan')
    expect(updatePlanTool.description).toContain('plan')

    // Tools work
    const result = JSON.parse(await getPlanTool.execute({}))
    expect(result.title).toBe('Tools Test')
  })
})
