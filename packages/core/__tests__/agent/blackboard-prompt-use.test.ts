import { describe, expect, it, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { prompt } from '../../src/prompt/prompt'
import { blackboard } from '../../src/agent'
import { resetHooks, updateHooks } from '../../src/runtime/runtime'

const boardSchema = z.object({
  goal: z.string(),
  status: z.enum(['idle', 'running', 'done']),
  findings: z.array(z.string()),
})

  afterEach(() => {
  resetHooks()
})

describe('blackboard prompt use integration', () => {
  it('injects blackboard state and focused tools when used directly in prompt use', async () => {
    const board = blackboard({ id: 'thread', schema: boardSchema })
    await board.patch({ goal: 'Write launch post', status: 'running' })

    const assistant = prompt({
      id: 'assistant',
      use: [board],
      system: 'You coordinate the task.',
    })

    const resolved = await assistant.resolve({})

    expect(resolved.system).toContain('You coordinate the task.')
    expect(resolved.system).toContain('Shared Blackboard (thread)')
    expect(resolved.system).toContain('Write launch post')
    expect(resolved.tools).toHaveProperty('readBlackboard')
    expect(resolved.tools).toHaveProperty('writeBlackboard')
    expect(resolved.tools).toHaveProperty('patchBlackboard')
    expect(resolved.tools).toHaveProperty('clearBlackboard')
  })

    it('keeps tools available when the blackboard is empty', async () => {
    const board = blackboard({ id: 'empty', schema: boardSchema })
    const assistant = prompt({ use: [board], system: 'Base.' })

    const resolved = await assistant.resolve({})

    expect(resolved.system).toBe('Base.')
    expect(resolved.tools).toHaveProperty('readBlackboard')
  })

    it('injects blackboard tools for structured-output prompts too', async () => {
    const board = blackboard({ id: 'structured', schema: boardSchema })
    const assistant = prompt({
      use: [board],
      system: 'Return a decision.',
      output: z.object({ decision: z.string() }),
    })

    const resolved = await assistant.resolve({})

    expect(resolved.schema).toBeDefined()
    expect(resolved.tools).toHaveProperty('readBlackboard')
    expect(resolved.tools).toHaveProperty('patchBlackboard')
  })

    it('does not add blackboard fields to the prompt input schema', () => {
    const board = blackboard({ id: 'thread', schema: boardSchema })
    const assistant = prompt({ use: [board], system: 'Base.' })

    expect(assistant.inputSchema).toBeUndefined()
  })

    it('lists injected blackboard tools in inspect output', async () => {
    const board = blackboard({ id: 'thread', schema: boardSchema })
    const assistant = prompt({ use: [board], system: 'Base.' })

    const resolved = await assistant.resolve({})

    expect(Object.keys(resolved.tools ?? {})).toEqual(
      expect.arrayContaining(['readBlackboard', 'writeBlackboard', 'patchBlackboard', 'clearBlackboard']),
    )
  })

    it('keeps board.asContext() as context-only integration', async () => {
    const board = blackboard({ id: 'thread', schema: boardSchema })
    await board.set('goal', 'Context only')
    const assistant = prompt({ use: [board.asContext()], system: 'Base.' })

    const resolved = await assistant.resolve({})

    expect(resolved.system).toContain('Context only')
    expect(resolved.tools).toBeUndefined()
  })

    it('throws a clear error when multiple auto-injected blackboards collide on tool names', async () => {
    const first = blackboard({ id: 'first', schema: boardSchema })
    const second = blackboard({ id: 'second', schema: boardSchema })
    const assistant = prompt({ use: [first, second], system: 'Base.' })

    await expect(assistant.resolve({})).rejects.toThrow(
      'Tool name collision for "readBlackboard": contributed by both blackboard:first and blackboard:second. ' +
        'Rename one of them, or pass the overriding tool at the call site (call-site tools intentionally win).',
    )
  })

    it('supports prefixed blackboard tools for multiple boards', async () => {
    const research = blackboard({ id: 'research', schema: boardSchema, tools: { prefix: 'research' } })
    const writing = blackboard({ id: 'writing', schema: boardSchema, tools: { prefix: 'writing' } })
    const assistant = prompt({ use: [research, writing], system: 'Base.' })

    const resolved = await assistant.resolve({})

    expect(resolved.tools).toHaveProperty('readResearchBlackboard')
    expect(resolved.tools).toHaveProperty('writeResearchBlackboard')
    expect(resolved.tools).toHaveProperty('readWritingBlackboard')
    expect(resolved.tools).toHaveProperty('writeWritingBlackboard')
  })
})
