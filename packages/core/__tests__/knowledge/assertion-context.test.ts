import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { indexingPipeline, type CruxChunk } from '../../src/indexing'
import { assertions, knowledgeBase } from '../../src/knowledge'
import { prompt } from '../../src/prompt'
import { inMemoryStorage } from '../../src/storage'
import { schema2TextChunk } from '../fixtures/schema2-stored-evidence'

const types = {
  fact: z.object({ id: z.string(), text: z.string(), detail: z.string().optional() }).describe('A fact'),
  price: z.object({ amount: z.number(), currency: z.string() }).describe('A price'),
}

describe('assertion context', () => {
  it('renders bounded deterministic assertion listings with explicit truncation', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), pipeline: indexingPipeline({ derive: [stage()] }) })
    await docs.index([
      chunk('b', 'fact B', 'z'.repeat(120)),
      chunk('a', 'fact A', 'a'.repeat(120)),
      chunk('c', 'price'),
    ])
    const ctx = docs.assertions(stage()).asContext({ limit: 2, itemCharLimit: 90 })

    const first = await ctx.systemFn({})
    const second = await ctx.systemFn({})

    expect(second).toBe(first)
    expect(first).toContain('## Assertions: facts')
    expect(first).toContain('- fact')
    expect(first).toContain('detail=')
    expect(first).toContain('sources=1')
    expect(first).toContain('[truncated]')
    expect(first).toContain('1 more not shown')
    expect(first).not.toContain('z'.repeat(120))
  })

  it('renders only view-visible assertions from a view-bound set', async () => {
    const storage = inMemoryStorage()
    const metadataSchema = z.object({ status: z.enum(['open', 'closed']) })
    const docs = knowledgeBase({ id: 'docs', storage, metadataSchema, pipeline: indexingPipeline({ derive: [stage()] }) })
    await docs.index([
      chunk('open-source', 'shared', undefined, { status: 'open' }),
      chunk('closed-source', 'shared', undefined, { status: 'closed' }),
      chunk('closed-only', 'fact closed-only', undefined, { status: 'closed' }),
    ])

    const rendered = await docs.view({ id: 'open', where: { status: 'open' } }).assertions(stage()).asContext().systemFn({})

    expect(rendered).toContain('View revision:')
    expect(rendered).toContain('id="shared"')
    expect(rendered).not.toContain('closed-only')
    expect(rendered).toContain('sources=1')
  })

  it('resolution context prepares lazily once and renders selected partition counts', async () => {
    const run = vi.fn(({ assertions }, decision) => {
      const [first, second] = assertions
      if (first) decision.select(first)
      if (second) decision.unresolved(second)
    })
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), pipeline: indexingPipeline({ derive: [stage()] }) })
    await docs.index([chunk('a', 'fact A'), chunk('b', 'fact B')])
    const resolution = docs.assertions(stage()).resolve({ id: 'policy', version: 1, run })
    const ctx = resolution.asContext()

    await expect(resolution.status()).resolves.toMatchObject({ state: 'idle' })
    const first = await ctx.systemFn({})
    const second = await ctx.systemFn({})

    expect(run).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(first).toContain('## Assertion Resolution: facts')
    expect(first).toContain('Selected: 1; superseded: 0; contested: 0; unresolved: 1')
    expect(first).toContain('- selected')
    expect(first).toContain('id="A"')
    expect(first).not.toContain('id="B"')
  })

  it('injects assertion context when a set is used directly by a prompt', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), pipeline: indexingPipeline({ derive: [stage()] }) })
    await docs.index([chunk('a', 'fact A')])
    const answer = prompt({ id: 'assertion-use', use: [docs.assertions(stage())], system: 'Base.' })

    const resolved = await answer.resolve()

    expect(resolved.system).toContain('Base.')
    expect(resolved.system).toContain('## Assertions: facts')
    expect(resolved.system).toContain('id="A"')
  })
})

function stage() {
  return assertions({
    id: 'facts',
    version: 1,
    types,
    run: (input, api) => {
      const evidence = { kind: 'chunk' as const, sourceId: input.document.sourceId, chunkId: input.chunks[0]?.chunkId ?? 'main' }
      if ((input.document.content ?? '').includes('price')) api.emit('price', { amount: 12, currency: 'EUR' }, { evidence })
      else {
        const id = (input.document.content ?? '').replace(/^fact /, '')
        api.emit('fact', { id, text: id, detail: input.chunks[0]?.metadata.detail as string | undefined }, { evidence })
      }
    },
  })
}

function chunk(
  sourceId: string,
  content: string,
  detail?: string,
  metadata: Record<string, unknown> = {},
): CruxChunk {
  return schema2TextChunk({
    namespace: 'docs',
    sourceId,
    chunkId: 'main',
    ordinal: 0,
    content,
    metadata: { ...metadata, ...(detail ? { detail } : {}) },
  })
}
