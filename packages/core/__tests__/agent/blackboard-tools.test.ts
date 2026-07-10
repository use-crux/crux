import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { blackboard as makeBlackboard } from '../../src/agent/blackboard'

const testSchema = z.object({
  goal: z.string(),
  findings: z.array(z.string()),
  status: z.enum(['idle', 'running', 'done']),
  score: z.number().optional(),
})

describe('blackboard asTools()', () => {
  it('returns readBlackboard, writeBlackboard, patchBlackboard, clearBlackboard', () => {
    const board = makeBlackboard({ id: 'test', schema: testSchema })
    const tools = board.asTools()

    expect(tools.readBlackboard).toBeDefined()
    expect(tools.writeBlackboard).toBeDefined()
    expect(tools.patchBlackboard).toBeDefined()
    expect(tools.clearBlackboard).toBeDefined()
  })

    it('each tool has description, parameters, and execute', () => {
    const board = makeBlackboard({ id: 'test', schema: testSchema })
    const tools = board.asTools()

    for (const tool of Object.values(tools)) {
      expect(tool.description).toEqual(expect.any(String))
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.parameters).toBeDefined()
      expect(tool.execute).toBeInstanceOf(Function)
    }
  })

describe('readBlackboard', () => {
    it('without field returns full board', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      await board.set('goal', 'Build feature')
      await board.set('status', 'running')

      const tools = board.asTools()
      const result = await tools.readBlackboard.execute({})
      const parsed = JSON.parse(result)

      expect(parsed.goal).toBe('Build feature')
      expect(parsed.status).toBe('running')
    })

    it('with field returns single value', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      await board.set('goal', 'Test goal')
      await board.set('status', 'idle')

      const tools = board.asTools()
      const result = await tools.readBlackboard.execute({ field: 'goal' })

      expect(JSON.parse(result)).toBe('Test goal')
    })

    it('on empty board returns null', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const tools = board.asTools()
      const result = await tools.readBlackboard.execute({})

      expect(result).toBe('null')
    })

    it('with field returns undefined for unset field', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const tools = board.asTools()
      const result = await tools.readBlackboard.execute({ field: 'goal' })

      expect(result).toBe('undefined')
    })
  })

describe('writeBlackboard', () => {
    it('sets a field', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const tools = board.asTools()

      await tools.writeBlackboard.execute({ field: 'goal', value: 'New goal' })
      expect(await board.get('goal')).toBe('New goal')
    })

    it('rejects invalid value (schema validation)', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const tools = board.asTools()

      // status must be 'idle' | 'running' | 'done', not an arbitrary string
      await expect(tools.writeBlackboard.execute({ field: 'status', value: 'invalid-status' })).rejects.toThrow()
    })

    it('preserves other fields', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      await board.set('goal', 'Original goal')
      await board.set('status', 'idle')

      const tools = board.asTools()
      await tools.writeBlackboard.execute({ field: 'status', value: 'running' })

      expect(await board.get('goal')).toBe('Original goal')
      expect(await board.get('status')).toBe('running')
    })
  })

describe('patchBlackboard', () => {
    it('merges multiple fields', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      await board.set('goal', 'Keep this')

      const tools = board.asTools()
      await tools.patchBlackboard.execute({
        fields: { status: 'done', findings: ['fact1', 'fact2'] },
      })

      expect(await board.get('goal')).toBe('Keep this')
      expect(await board.get('status')).toBe('done')
      expect(await board.get('findings')).toEqual(['fact1', 'fact2'])
    })

    it('rejects invalid field values via schema', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const tools = board.asTools()

      await expect(tools.patchBlackboard.execute({ fields: { findings: 'not-an-array' } })).rejects.toThrow()
    })
  })

describe('clearBlackboard', () => {
    it('removes all state', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      await board.set('goal', 'Something')
      await board.set('status', 'running')

      const tools = board.asTools()
      await tools.clearBlackboard.execute({})

      expect(await board.getAll()).toBeNull()
    })
  })

describe('subscriber notifications', () => {
    it('writeBlackboard triggers subscriber', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const listener = vi.fn()
      board.subscribe(listener)

      const tools = board.asTools()
      await tools.writeBlackboard.execute({ field: 'goal', value: 'Via tool' })

      expect(listener).toHaveBeenCalledWith('test', ['goal'])
    })

    it('patchBlackboard triggers subscriber with all changed keys', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      const listener = vi.fn()
      board.subscribe(listener)

      const tools = board.asTools()
      await tools.patchBlackboard.execute({
        fields: { goal: 'Patched', status: 'done' },
      })

      expect(listener).toHaveBeenCalledWith('test', ['goal', 'status'])
    })

    it('clearBlackboard triggers subscriber with wildcard', async () => {
      const board = makeBlackboard({ id: 'test', schema: testSchema })
      await board.set('goal', 'Something')

      const listener = vi.fn()
      board.subscribe(listener)

      const tools = board.asTools()
      await tools.clearBlackboard.execute({})

      expect(listener).toHaveBeenCalledWith('test', ['*'])
    })
  })
})
