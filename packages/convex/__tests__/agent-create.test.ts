import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Agent, createAgent } from '../src/agent'

describe('createAgent', () => {
  it('creates a Crux-aware Convex Agent from a Crux prompt definition', async () => {
    const execute = vi.fn(async () => 'done')
    const prompt = {
      id: 'support-prompt',
      resolve: vi.fn(async () => ({ system: 'Resolved support instructions.' })),
      inspect: vi.fn(async () => ({ tools: [] })),
      tools: {
        lookup: {
          description: 'Lookup.',
          parameters: z.object({ id: z.string() }),
          execute,
        },
      },
    }
    const model = { modelId: 'test-model' }

    const agent = await createAgent({} as any, prompt as any, {
      name: 'Support',
      model: model as any,
      input: { locale: 'en' },
    })

    expect(agent).toBeInstanceOf(Agent)
    expect(prompt.resolve).toHaveBeenCalledWith({ input: { locale: 'en' }, tokenBudget: undefined })
    expect(agent.options.name).toBe('Support')
    expect(agent.options.instructions).toBe('Resolved support instructions.')
    expect(agent.options.languageModel).toBe(model)
    expect(agent.options.tools).toHaveProperty('lookup')
  })
})
