import { describe, it, expect, afterEach } from 'vitest'
import { inMemoryRecordStore } from '../../storage'
import { plan, getPlan, updatePlan } from '../../plan/plans'
import { updateHooks, resetHooks } from '../../runtime/runtime'
import type { CreatePlanInput, JsonObject, PlanUpdate } from '../../plan/types'

/** Create a fresh store and register it in the runtime. */
function setup() {
  const store = inMemoryRecordStore()
  updateHooks({ records: store })
  return store
}

afterEach(() => resetHooks())

describe('Plan CRUD', () => {
  it('plan() generates UUID, sets version=1, timestamps', async () => {
    const store = setup()
    const p = await plan({ title: 'Test Plan' })
    const data = await p.get()

    expect(p.id).toBeDefined()
    expect(p.id.length).toBeGreaterThan(10)
    expect(data!.title).toBe('Test Plan')
    expect(data!.content).toBe('')
    expect(data!.version).toBe(1)
    expect(data!.createdAt).toBeTypeOf('number')
    expect(data!.updatedAt).toBeTypeOf('number')
    expect(data!.createdAt).toBeLessThanOrEqual(Date.now())
  })

    it('plan() with explicit content and metadata', async () => {
    const store = setup()
    const p = await plan({
      title: 'Migration Guide',
      content: '## Step 1\nDo the thing.',
      metadata: { threadId: 'thread-123' },
    })
    const data = await p.get()

    expect(data!.title).toBe('Migration Guide')
    expect(data!.content).toBe('## Step 1\nDo the thing.')
    expect(data!.metadata).toEqual({ threadId: 'thread-123' })
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
    await expect(p.get()).resolves.toMatchObject({ version: 1 })

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
    const original = await p.get()
    const originalUpdatedAt = original!.updatedAt

    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 5))
    const updated = await updatePlan(p.id, { content: 'Changed' })

    expect(updated.updatedAt).toBeGreaterThan(originalUpdatedAt)
    expect(updated.createdAt).toBe(original!.createdAt) // unchanged
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

  it('rejects non-JSON plan metadata before storing it', async () => {
    const store = setup()
    const unsafePlan = plan as unknown as (input: CreatePlanInput) => Promise<unknown>

    await expect(
      unsafePlan({
        title: 'Bad metadata',
        metadata: { bad: () => undefined } as unknown as JsonObject,
      }),
    ).rejects.toMatchObject({ name: 'TaskJsonValueError' })

    const p = await plan({ title: 'Good metadata', metadata: { ok: true } })
    const unsafeUpdate = updatePlan as unknown as (planId: string, update: PlanUpdate) => Promise<unknown>
    await expect(
      unsafeUpdate(p.id, {
        metadata: { bad: 1n } as unknown as JsonObject,
      }),
    ).rejects.toMatchObject({ name: 'TaskJsonValueError' })

    await expect(store.get(`plan:${p.id}`)).resolves.toMatchObject({
      metadata: { ok: true },
    })
  })
})

describe('PlanHandle', () => {
  it('plan() returns a command handle, not a plan data snapshot', async () => {
    const store = setup()
    const p = await plan({ title: 'Handle Test', content: 'Body' })

    expect(p.id).toBeDefined()
    expect(typeof p.update).toBe('function')
    expect(typeof p.get).toBe('function')
    expect(typeof p.asContext).toBe('function')
    expect(typeof p.asTools).toBe('function')

    expect('title' in p).toBe(false)
    expect('content' in p).toBe(false)
    expect('version' in p).toBe(false)
    expect('createdAt' in p).toBe(false)

    await expect(p.get()).resolves.toMatchObject({
      id: p.id,
      title: 'Handle Test',
      content: 'Body',
      version: 1,
    })
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
