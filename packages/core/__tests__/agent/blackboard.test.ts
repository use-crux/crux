import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { blackboard as makeBlackboard } from '../../agent/blackboard'
import { inMemoryRecordStore as inMemoryStore } from '../../storage'

const testSchema = z.object({
  goal: z.string(),
  findings: z.array(z.string()),
  status: z.enum(['idle', 'running', 'done']),
})

describe('blackboard', () => {
  it('has correct id', () => {
    const board = makeBlackboard({ id: 'test', schema: testSchema })
    expect(board.id).toBe('test')
  })

    it('getAll returns null for uninitialized board', async () => {
    const board = makeBlackboard({ id: 'test', schema: testSchema })
    expect(await board.getAll()).toBeNull()
  })

    it('set + getAll round-trips a field', async () => {
    const board = makeBlackboard({ id: 'test', schema: testSchema })
    await board.set('goal', 'Research AI safety')
    const state = await board.getAll()
    expect(state).toEqual({ goal: 'Research AI safety' })
  })

    it('get returns a single field', async () => {
    const board = makeBlackboard({ id: 'test', schema: testSchema })
    await board.set('goal', 'Test goal')
    expect(await board.get('goal')).toBe('Test goal')
  })

    it('get returns undefined for unset field', async () => {
    const board = makeBlackboard({ id: 'test', schema: testSchema })
    await board.set('goal', 'Something')
    expect(await board.get('status')).toBeUndefined()
  })

    it('patch merges multiple fields', async () => {
    const board = makeBlackboard({ id: 'test', schema: testSchema })
    await board.set('goal', 'Initial')
    await board.patch({ findings: ['fact1'], status: 'running' })

    const state = await board.getAll()
    expect(state).toEqual({
      goal: 'Initial',
      findings: ['fact1'],
      status: 'running',
    })
  })

    it('patch on uninitialized board creates state', async () => {
    const board = makeBlackboard({ id: 'test', schema: testSchema })
    await board.patch({ goal: 'New goal' })
    expect(await board.get('goal')).toBe('New goal')
  })

    it('clear removes all state', async () => {
    const board = makeBlackboard({ id: 'test', schema: testSchema })
    await board.set('goal', 'Something')
    await board.clear()
    expect(await board.getAll()).toBeNull()
  })

    it('uses custom store', async () => {
    const store = inMemoryStore()
    const board = makeBlackboard({ id: 'test', schema: testSchema, records: store })
    await board.set('goal', 'Stored')

    const entry = await store.get('blackboard:test')
    expect(entry).not.toBeNull()
    expect(JSON.parse(entry!.content)).toEqual({ goal: 'Stored' })
  })

    it('set rejects invalid field value via schema', async () => {
    const board = makeBlackboard({ id: 'test', schema: testSchema })
    await expect(board.set('goal', 123 as any)).rejects.toThrow()
  })

    it('patch rejects invalid field values via schema', async () => {
    const board = makeBlackboard({ id: 'test', schema: testSchema })
    await expect(board.patch({ findings: 'not-an-array' as any })).rejects.toThrow()
  })

describe('subscribe', () => {
    it('callback is called after set()', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const listener = vi.fn()
      board.subscribe(listener)

      await board.set('goal', 'New goal')
      expect(listener).toHaveBeenCalledOnce()
    })

    it('receives correct boardId and fieldsChanged', async () => {
      const board = makeBlackboard({ id: 'myboard', schema: testSchema })
      const listener = vi.fn()
      board.subscribe(listener)

      await board.set('goal', 'Updated')
      expect(listener).toHaveBeenCalledWith('myboard', ['goal'])
    })

    it('is called after patch() with all changed field keys', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const listener = vi.fn()
      board.subscribe(listener)

      await board.patch({ goal: 'G', status: 'done' })
      expect(listener).toHaveBeenCalledWith('test', ['goal', 'status'])
    })

    it('unsubscribe stops future notifications', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const listener = vi.fn()
      const unsub = board.subscribe(listener)

      await board.set('goal', 'First')
      expect(listener).toHaveBeenCalledOnce()

      unsub()
      await board.set('goal', 'Second')
      expect(listener).toHaveBeenCalledOnce() // still 1
    })

    it('multiple subscribers are all notified', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const l1 = vi.fn()
      const l2 = vi.fn()
      board.subscribe(l1)
      board.subscribe(l2)

      await board.set('goal', 'Shared')
      expect(l1).toHaveBeenCalledOnce()
      expect(l2).toHaveBeenCalledOnce()
    })

    it('notifies subscribers when clear() is called', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const listener = vi.fn()
      board.subscribe(listener)

      await board.set('goal', 'Something')
      listener.mockClear()

      await board.clear()
      expect(listener).toHaveBeenCalledWith('test', ['*'])
    })
  })

describe('onUpdate', () => {
    it('fires after set()', async () => {
      const onUpdate = vi.fn()
      const board = makeBlackboard({
        id: 'test',
        schema: testSchema,
        onUpdate,
      })
      await board.set('goal', 'Go')
      expect(onUpdate).toHaveBeenCalledWith('test', ['goal'])
    })

    it('fires after patch()', async () => {
      const onUpdate = vi.fn()
      const board = makeBlackboard({
        id: 'test',
        schema: testSchema,
        onUpdate,
      })
      await board.patch({ goal: 'G', status: 'idle' })
      expect(onUpdate).toHaveBeenCalledWith('test', ['goal', 'status'])
    })
  })

describe('asContext', () => {
    it('returns a Context instance', () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const ctx = board.asContext()
      expect(ctx._tag).toBe('Context')
      expect(ctx.id).toBe('blackboard:test')
    })

    it('renders board state as JSON in system message', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      await board.set('goal', 'Build feature')

      const ctx = board.asContext()
      const text = await ctx.systemFn({})
      expect(text).toContain('Shared Blackboard')
      expect(text).toContain('Build feature')
      expect(text).toContain('json')
    })

    it('returns empty string when board is empty', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const ctx = board.asContext()
      const text = await ctx.systemFn({})
      expect(text).toBe('')
    })

    it('uses custom priority', () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const ctx = board.asContext({ priority: 85 })
      expect(ctx.priority).toBe(85)
    })

    it('defaults to priority 70', () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const ctx = board.asContext()
      expect(ctx.priority).toBe(70)
    })
  })

})
