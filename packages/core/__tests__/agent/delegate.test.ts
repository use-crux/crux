import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { delegate as cruxDelegate } from '../../agent/delegate'
import { handoff as makeHandoff } from '../../agent/handoff'
import { updateRuntime, resetRuntime } from '../../runtime/runtime'

const inputSchema = z.object({
  synthesis: z.string(),
  sources: z.array(z.object({ title: z.string(), url: z.string().optional() })),
})

const outputSchema = z.object({
  researchContext: z.string(),
  sourceCount: z.number(),
})

const handoff = makeHandoff({
  id: 'research-to-writer',
  inputSchema,
  outputSchema,
  transform: (input) => ({
    researchContext: input.synthesis.slice(0, 5000),
    sourceCount: input.sources.length,
  }),
})

const argsSchema = z.object({
  query: z.string(),
  instruction: z.string().optional(),
})

function makeDelegate(overrides?: Partial<Parameters<typeof cruxDelegate>[0]>) {
  return cruxDelegate({
    id: 'delegate-research',
    argsSchema,
    handoff,
    execute: async (args) => ({
      synthesis: `Research findings for: ${args.query}`,
      sources: [{ title: 'Source 1', url: 'https://example.com' }],
    }),
    ...overrides,
  })
}

describe('delegate', () => {
  it('has correct id', () => {
    const d = makeDelegate()
    expect(d.id).toBe('delegate-research')
  })

  it('exposes argsSchema and handoff', () => {
    const d = makeDelegate()
    expect(d.argsSchema).toBe(argsSchema)
    expect(d.handoff).toBe(handoff)
  })

  describe('run()', () => {
    it('executes subagent and returns transformed result', async () => {
      const d = makeDelegate()
      const result = await d.run({ query: 'AI safety' })
      expect(result.delegateId).toBe('delegate-research')
      expect(result.data.researchContext).toContain('AI safety')
      expect(result.data.sourceCount).toBe(1)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('validates tool args against argsSchema', async () => {
      const d = makeDelegate()
      await expect(d.run({ bad: 'data' } as any)).rejects.toThrow()
    })

    it('validates subagent output via handoff', async () => {
      const d = makeDelegate({
        id: 'bad-delegate',
        argsSchema: z.object({ x: z.string() }),
        handoff: makeHandoff({
          id: 'bad-handoff',
          inputSchema: z.object({ y: z.number() }),
          outputSchema: z.object({ z: z.string() }),
          transform: (input) => ({ z: String(input.y) }),
        }),
        execute: async () => ({ y: 'not-a-number' }) as any,
      })
      await expect(d.run({ x: 'test' })).rejects.toThrow()
    })

    it('emits delegate instrumentation events', async () => {
      const onDelegateStart = vi.fn()
      const onDelegateComplete = vi.fn()
      updateRuntime({
        instrumentationHooks: { onDelegateStart, onDelegateComplete },
      })

      try {
        const d = makeDelegate()
        await d.run({ query: 'test' })

        expect(onDelegateStart).toHaveBeenCalledWith(
          expect.objectContaining({
            delegateId: 'delegate-research',
            handoffId: 'research-to-writer',
          }),
        )
        expect(onDelegateComplete).toHaveBeenCalledWith(
          expect.objectContaining({
            delegateId: 'delegate-research',
            handoffId: 'research-to-writer',
            durationMs: expect.any(Number),
          }),
        )
      } finally {
        resetRuntime()
      }
    })
  })

  describe('asTools()', () => {
    it('returns object with delegate tool', () => {
      const d = makeDelegate()
      const tools = d.asTools()
      expect(tools).toHaveProperty('delegate')
      expect(tools.delegate.execute).toBeInstanceOf(Function)
    })

    it('delegate tool has correct description and parameters', () => {
      const d = makeDelegate()
      const { delegate } = d.asTools()
      expect(delegate.description).toContain('delegate-research')
      expect(delegate.parameters).toBe(argsSchema)
    })

    it('delegate tool uses custom description', () => {
      const d = makeDelegate()
      const { delegate } = d.asTools({ description: 'Custom delegation' })
      expect(delegate.description).toBe('Custom delegation')
    })

    it('delegate tool execute calls run() and returns JSON', async () => {
      const d = makeDelegate()
      const { delegate } = d.asTools()
      const result = await delegate.execute({ query: 'test query' })
      const parsed = JSON.parse(result)
      expect(parsed.data.researchContext).toContain('test query')
      expect(parsed.data.sourceCount).toBe(1)
    })

    it('delegate tool includes summary when handoff has summarize', async () => {
      const summarizingHandoff = makeHandoff({
        id: 'research-to-writer',
        inputSchema,
        outputSchema,
        transform: (input) => ({
          researchContext: input.synthesis.slice(0, 5000),
          sourceCount: input.sources.length,
        }),
        summarize: {
          generate: async () => ({ text: 'Summary from asTools' }),
          model: 'mock',
        },
      })

      const d = makeDelegate({
        id: 'delegate-with-summary',
        argsSchema,
        handoff: summarizingHandoff,
        execute: async (args) => ({
          synthesis: `Findings for: ${args.query}`,
          sources: [{ title: 'Source 1', url: 'https://example.com' }],
        }),
      })

      const { delegate } = d.asTools()
      const result = await delegate.execute({ query: 'test' })
      const parsed = JSON.parse(result)
      expect(parsed.summary).toBe('Summary from asTools')
    })
  })

})
