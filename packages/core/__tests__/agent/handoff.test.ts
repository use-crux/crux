import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { handoff as cruxHandoff } from '../../agent/handoff'
import type { GenerateTextFn } from '../../compaction/types'

const inputSchema = z.object({
  query: z.string(),
  results: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() })),
  metadata: z.object({ searchEngine: z.string(), timestamp: z.number() }),
})

const outputSchema = z.object({
  query: z.string(),
  topResults: z.array(z.object({ title: z.string(), url: z.string() })),
})

const sampleInput = {
  query: 'AI safety',
  results: [
    {
      title: 'AI Safety Research',
      url: 'https://example.com/1',
      snippet: 'Research on...',
    },
    {
      title: 'Safety Guidelines',
      url: 'https://example.com/2',
      snippet: 'Guidelines for...',
    },
  ],
  metadata: { searchEngine: 'google', timestamp: 1700000000 },
}

function makeHandoff(overrides?: Record<string, unknown>) {
  return cruxHandoff({
    id: 'research-to-writer',
    inputSchema,
    outputSchema,
    transform: (input) => ({
      query: input.query,
      topResults: input.results.map((r) => ({ title: r.title, url: r.url })),
    }),
    ...overrides,
  })
}

describe('handoff', () => {
  it('has correct id', () => {
    const h = makeHandoff()
    expect(h.id).toBe('research-to-writer')
  })

  it('exposes inputSchema and outputSchema', () => {
    const h = makeHandoff()
    expect(h.inputSchema).toBe(inputSchema)
    expect(h.outputSchema).toBe(outputSchema)
  })

  it('prepare validates input against inputSchema', async () => {
    const h = makeHandoff()
    const payload = await h.prepare(sampleInput)
    expect(payload.data.query).toBe('AI safety')
  })

  it('prepare rejects invalid input', async () => {
    const h = makeHandoff()
    await expect(h.prepare({ bad: 'data' } as any)).rejects.toThrow()
  })

  it('prepare runs transform function', async () => {
    const h = makeHandoff()
    const payload = await h.prepare(sampleInput)
    expect(payload.data.topResults).toHaveLength(2)
    expect(payload.data.topResults[0].title).toBe('AI Safety Research')
    // snippet and metadata should be stripped by transform
    expect((payload.data as any).metadata).toBeUndefined()
  })

  it('prepare validates transform output against outputSchema', async () => {
    const badHandoff = makeHandoff({
      id: 'bad',
      inputSchema: z.object({ x: z.string() }),
      outputSchema: z.object({ y: z.number() }),
      transform: () => ({ y: 'not-a-number' }) as any,
    })
    await expect(badHandoff.prepare({ x: 'test' })).rejects.toThrow()
  })

  it('prepare returns payload with correct shape', async () => {
    const h = makeHandoff()
    const payload = await h.prepare(sampleInput)
    expect(payload.handoffId).toBe('research-to-writer')
    expect(payload.createdAt).toBeInstanceOf(Date)
    expect(payload.data).toBeDefined()
  })

  describe('without summarize', () => {
    it('payload has no summary', async () => {
      const h = makeHandoff()
      const payload = await h.prepare(sampleInput)
      expect(payload.summary).toBeUndefined()
    })
  })

  describe('with summarize', () => {
    const mockGenerate: GenerateTextFn = vi.fn(async () => ({
      text: 'Summary: research results about AI safety',
    }))

    it('calls generate when configured', async () => {
      const h = makeHandoff({
        summarize: { generate: mockGenerate, model: 'mock-model' },
      })
      await h.prepare(sampleInput)
      expect(mockGenerate).toHaveBeenCalledOnce()
    })

    it('attaches summary to payload', async () => {
      const gen: GenerateTextFn = async () => ({ text: 'Brief summary' })
      const h = makeHandoff({
        summarize: { generate: gen, model: 'mock' },
      })
      const payload = await h.prepare(sampleInput)
      expect(payload.summary).toBe('Brief summary')
    })

    it('uses custom system prompt', async () => {
      const gen: GenerateTextFn = vi.fn(async () => ({ text: 'ok' }))
      const h = makeHandoff({
        summarize: {
          generate: gen,
          model: 'mock',
          system: 'Custom system prompt',
        },
      })
      await h.prepare(sampleInput)
      expect(gen).toHaveBeenCalledWith(expect.objectContaining({ system: 'Custom system prompt' }))
    })
  })

  describe('onPrepare', () => {
    it('fires with handoffId and sizes', async () => {
      const onPrepare = vi.fn()
      const h = makeHandoff({ onPrepare })
      await h.prepare(sampleInput)
      expect(onPrepare).toHaveBeenCalledWith('research-to-writer', expect.any(Number), expect.any(Number))
      // Output should be smaller than input (stripped fields)
      const [, inputSize, outputSize] = onPrepare.mock.calls[0]
      expect(inputSize).toBeGreaterThan(outputSize)
    })
  })

  describe('asContext', () => {
    it('returns a Context instance', async () => {
      const h = makeHandoff()
      const payload = await h.prepare(sampleInput)
      const ctx = h.asContext(payload)
      expect(ctx._tag).toBe('Context')
      expect(ctx.id).toBe('handoff:research-to-writer')
    })

    it('system message contains data as JSON', async () => {
      const h = makeHandoff()
      const payload = await h.prepare(sampleInput)
      const ctx = h.asContext(payload)
      const text = await ctx.systemFn({})
      expect(text).toContain('Handoff Context')
      expect(text).toContain('AI safety')
      expect(text).toContain('json')
    })

    it('includes summary when present', async () => {
      const gen: GenerateTextFn = async () => ({
        text: 'Key findings summary',
      })
      const h = makeHandoff({
        summarize: { generate: gen, model: 'mock' },
      })
      const payload = await h.prepare(sampleInput)
      const ctx = h.asContext(payload)
      const text = await ctx.systemFn({})
      expect(text).toContain('Summary')
      expect(text).toContain('Key findings summary')
    })

    it('excludes summary section when absent', async () => {
      const h = makeHandoff()
      const payload = await h.prepare(sampleInput)
      const ctx = h.asContext(payload)
      const text = await ctx.systemFn({})
      expect(text).not.toContain('Summary')
    })

    it('uses custom priority', async () => {
      const h = makeHandoff()
      const payload = await h.prepare(sampleInput)
      const ctx = h.asContext(payload, { priority: 95 })
      expect(ctx.priority).toBe(95)
    })

    it('defaults to priority 80', async () => {
      const h = makeHandoff()
      const payload = await h.prepare(sampleInput)
      const ctx = h.asContext(payload)
      expect(ctx.priority).toBe(80)
    })
  })

  it('handles async transform function', async () => {
    const h = makeHandoff({
      id: 'async-test',
      inputSchema,
      outputSchema,
      transform: async (input) => {
        await new Promise((r) => setTimeout(r, 5))
        return {
          query: input.query,
          topResults: input.results.map((r) => ({
            title: r.title,
            url: r.url,
          })),
        }
      },
    })

    const payload = await h.prepare(sampleInput)
    expect(payload.data.query).toBe('AI safety')
    expect(payload.data.topResults).toHaveLength(2)
  })

  it('filters fields via transform (schema contract)', async () => {
    const h = makeHandoff()
    const payload = await h.prepare(sampleInput)
    // Input had: query, results (with snippets), metadata
    // Output should only have: query, topResults (without snippets)
    const keys = Object.keys(payload.data)
    expect(keys).toEqual(['query', 'topResults'])
    expect(payload.data.topResults[0]).not.toHaveProperty('snippet')
  })
})
