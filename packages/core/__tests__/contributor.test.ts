import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { context } from '../src/prompt/context'
import { contributor } from '../src/prompt/contributor'
import { prompt } from '../src/prompt/prompt'
import { constraint } from '../src/safety/constraint'
import { boundary } from '../src/safety'

describe('contributor()', () => {
  it('lets prompt use entries inject context, tools, constraints, and metadata', async () => {
    const check = constraint({
      id: 'custom-check',
      on: boundary.output.both(),
      run: () => ({ pass: true, metadata: { checked: true } }),
    })
    const execute = vi.fn(async () => 'ok')
    const source = contributor({
      id: 'custom-source',
      async contribute({ input, promptId }) {
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
    const nested = contributor({
      id: 'nested',
      contribute: () => ({
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
    const first = contributor({
      id: 'first',
      contribute: () => ({
        tools: {
          search: {
            description: 'first',
            parameters: z.object({}),
            execute: async () => 'first',
          },
        },
      }),
    })
    const second = contributor({
      id: 'second',
      contribute: () => ({
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

    await expect(answer.resolve({})).rejects.toThrow(
      'Tool name collision for "search": contributed by both contributor:first and contributor:second. ' +
        'Rename one of them, or pass the overriding tool at the call site (call-site tools intentionally win).',
    )
  })
})
