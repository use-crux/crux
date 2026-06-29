import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { handoff as cruxHandoff } from '../../agent/handoff'
import { inMemoryCruxStore } from '../../store/memory'
import type { GenerateTextFn } from '../../compaction/types'

const inputSchema = z.object({
  query: z.string(),
  results: z.array(z.object({ title: z.string(), url: z.string() })),
})

const outputSchema = z.object({
  query: z.string(),
  resultCount: z.number(),
})

const sampleInput = {
  query: 'AI safety',
  results: [
    { title: 'AI Safety Research', url: 'https://example.com/1' },
    { title: 'Safety Guidelines', url: 'https://example.com/2' },
  ],
}

function makeHandoff(overrides?: Record<string, unknown>) {
  return cruxHandoff({
    id: 'test-handoff',
    inputSchema,
    outputSchema,
    transform: (input) => ({
      query: input.query,
      resultCount: input.results.length,
    }),
    ...overrides,
  })
}

describe('handoff send/receive (store-backed)', () => {
  let store: ReturnType<typeof inMemoryCruxStore>

  beforeEach(() => {
    store = inMemoryCruxStore()
  })

describe('send()', () => {
    it('persists payload to store', async () => {
      const h = makeHandoff({ store })
      await h.send(sampleInput)

      const entry = await store.get('handoff:test-handoff')
      expect(entry).not.toBeNull()
      const parsed = JSON.parse(entry!.content as string)
      expect(parsed.data.query).toBe('AI safety')
      expect(parsed.data.resultCount).toBe(2)
    })

    it('returns a valid HandoffPayload', async () => {
      const h = makeHandoff({ store })
      const payload = await h.send(sampleInput)

      expect(payload.handoffId).toBe('test-handoff')
      expect(payload.data.query).toBe('AI safety')
      expect(payload.data.resultCount).toBe(2)
      expect(payload.createdAt).toBeInstanceOf(Date)
    })

    it('throws when no store configured', async () => {
      const h = makeHandoff() // no store
      await expect(h.send(sampleInput)).rejects.toThrow(/requires a store/)
    })

    it('includes summary when summarize configured', async () => {
      const gen: GenerateTextFn = async () => ({
        text: 'Summary of research results',
      })
      const h = makeHandoff({
        store,
        summarize: { generate: gen, model: 'mock' },
      })

      const payload = await h.send(sampleInput)
      expect(payload.summary).toBe('Summary of research results')

      // Verify summary is also persisted in store
      const entry = await store.get('handoff:test-handoff')
      const parsed = JSON.parse(entry!.content as string)
      expect(parsed.summary).toBe('Summary of research results')
    })
  })

describe('receive()', () => {
    it('retrieves persisted payload', async () => {
      const h = makeHandoff({ store })
      await h.send(sampleInput)

      const payload = await h.receive()
      expect(payload).not.toBeNull()
      expect(payload!.handoffId).toBe('test-handoff')
      expect(payload!.data.query).toBe('AI safety')
      expect(payload!.data.resultCount).toBe(2)
    })

    it('returns null when no payload exists', async () => {
      const h = makeHandoff({ store })
      const payload = await h.receive()
      expect(payload).toBeNull()
    })

    it('throws when no store configured', async () => {
      const h = makeHandoff() // no store
      await expect(h.receive()).rejects.toThrow(/requires a store/)
    })

    it('returns payload with createdAt as Date', async () => {
      const h = makeHandoff({ store })
      await h.send(sampleInput)

      const payload = await h.receive()
      expect(payload!.createdAt).toBeInstanceOf(Date)
    })
  })

describe('round-trip', () => {
    it('send then receive returns correct data', async () => {
      const h = makeHandoff({ store })

      const sent = await h.send(sampleInput)
      const received = await h.receive()

      expect(received).not.toBeNull()
      expect(received!.handoffId).toBe(sent.handoffId)
      expect(received!.data).toEqual(sent.data)
    })

    it('send then receive preserves summary', async () => {
      const gen: GenerateTextFn = async () => ({ text: 'Round-trip summary' })
      const h = makeHandoff({
        store,
        summarize: { generate: gen, model: 'mock' },
      })

      await h.send(sampleInput)
      const received = await h.receive()

      expect(received!.summary).toBe('Round-trip summary')
    })

    it('latest send overwrites previous', async () => {
      const h = makeHandoff({ store })

      await h.send(sampleInput)
      await h.send({
        query: 'ML models',
        results: [{ title: 'Model Research', url: 'https://example.com/3' }],
      })

      const received = await h.receive()
      expect(received!.data.query).toBe('ML models')
      expect(received!.data.resultCount).toBe(1)
    })
  })
})
