import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { context } from '../context'
import { injectable } from '../injectable'
import { prompt } from '../define'
import { constraint } from '../safety/constraint'

describe('injectable()', () => {
  it('lets prompt use entries inject context, tools, constraints, and metadata', async () => {
    const check = constraint({
      name: 'custom-check',
      check: () => ({ pass: true, metadata: { checked: true } }),
    })
    const execute = vi.fn(async () => 'ok')
    const source = injectable({
      id: 'custom-source',
      async inject({ input, promptId }) {
        return {
          contexts: [
            context({
              id: 'custom-context',
              system: `Injected for ${promptId}: ${input.question}`,
            }),
          ],
          tools: {
            customSearch: {
              description: 'Search custom source',
              parameters: z.object({ query: z.string() }),
              execute,
            },
          },
          constraints: [check],
          metadata: {
            injected: true,
          },
        }
      },
    })

    const answer = prompt({
      id: 'answer',
      use: [source],
      input: z.object({ question: z.string() }),
      system: 'Base.',
    })

    const resolved = await answer.resolve({ input: { question: 'shipping' } })

    expect(resolved.system).toContain('Base.')
    expect(resolved.system).toContain('Injected for answer: shipping')
    expect(resolved.tools?.customSearch).toBeDefined()
    expect(resolved.constraints).toContain(check)
    expect(resolved.metadata).toMatchObject({ injected: true })
  })

  it('lets context use entries compose before the context system text', async () => {
    const nested = injectable({
      id: 'nested',
      inject: () => ({
        contexts: [context({ id: 'nested-context', system: 'Nested evidence.' })],
      }),
    })

    const reusable = context({
      id: 'reusable',
      use: [nested],
      system: 'Reusable instructions.',
    })

    const answer = prompt({
      use: [reusable],
      system: 'Base.',
    })

    const resolved = await answer.resolve({})

    expect(resolved.system).toBe('Base.\n\nNested evidence.\n\nReusable instructions.')
  })

  it('throws on injected tool collisions', async () => {
    const first = injectable({
      id: 'first',
      inject: () => ({
        tools: {
          search: {
            description: 'first',
            parameters: z.object({}),
            execute: async () => 'first',
          },
        },
      }),
    })
    const second = injectable({
      id: 'second',
      inject: () => ({
        tools: {
          search: {
            description: 'second',
            parameters: z.object({}),
            execute: async () => 'second',
          },
        },
      }),
    })

    const answer = prompt({ use: [first, second], system: 'Base.' })

    await expect(answer.resolve({})).rejects.toThrow('Injected tool name collision for "search"')
  })
})
