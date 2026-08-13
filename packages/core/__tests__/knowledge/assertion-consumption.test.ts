import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { embedding } from '../../src/embedding'
import { indexingPipeline, type CruxChunk } from '../../src/indexing'
import { assertions, knowledgeBase } from '../../src/knowledge'
import { expandRelations, retrieve } from '../../src/retrieval'
import { inMemoryStorage, type RecordStore } from '../../src/storage'
import { textOf } from '../embedding/text-input'
import { schema2TextChunk } from '../fixtures/schema2-stored-evidence'

const types = {
  fact: z.object({ id: z.string(), text: z.string() }).describe('A fact'),
  price: z.object({ amount: z.number(), currency: z.string() }).describe('A price'),
}

describe('assertion consumption', () => {
  it('narrows assertion types and paginates list and stream results', async () => {
    const storage = inMemoryStorage()
    const stage = assertionStage()
    const docs = knowledgeBase({ id: 'docs', storage, pipeline: indexingPipeline({ derive: [stage] }) })
    await docs.index([chunk('a', 'fact A'), chunk('b', 'price 12 EUR')])

    const prices = docs.assertions(stage, { types: ['price'] as const })
    const first = await prices.list({ limit: 1 })
    const streamed = []
    for await (const assertion of prices.stream()) streamed.push(assertion)

    expect(first.items).toHaveLength(1)
    expect(first.items[0]?.type).toBe('price')
    expect(first.items[0]?.data.amount).toBe(12)
    expect(streamed.map((assertion) => assertion.type)).toEqual(['price'])
  })

  it('excludes view-outside supports and hides unsupported visible assertions', async () => {
    const storage = inMemoryStorage()
    const stage = assertionStage()
    const metadataSchema = z.object({ status: z.enum(['open', 'closed']) })
    const docs = knowledgeBase({ id: 'docs', storage, metadataSchema, pipeline: indexingPipeline({ derive: [stage] }) })
    await docs.index([
      chunk('open-source', 'shared', { status: 'open' }),
      chunk('closed-source', 'shared', { status: 'closed' }),
      chunk('closed-only', 'fact closed-only', { status: 'closed' }),
    ])

    const view = docs.view({ id: 'open', where: { status: 'open' } })
    const page = await view.assertions(stage).list()

    expect(page.items.map((assertion) => assertion.data)).toEqual([{ id: 'shared', text: 'shared' }])
    expect(page.items[0]?.evidence.map((support) => support.sourceId)).toEqual(['open-source'])
  })

  it('persists assertion relations and resolves explicit supersession and conflicts', async () => {
    const storage = inMemoryStorage()
    const stage = assertionStage()
    const docs = knowledgeBase({ id: 'docs', storage, pipeline: indexingPipeline({ derive: [stage] }) })
    await docs.index([chunk('relations', 'relations')])

    const generation = await storage.records.get('indexer:docs:namespace:docs:knowledge:current')
    const relationPage = await storage.records.list(`indexer:docs:namespace:docs:assertions:facts:gen:${generation?.generationId}:relation:`)
    expect(relationPage.entries.map((entry) => entry.value.type).sort()).toEqual(['conflictsWith', 'supersedes'])

    const result = await docs.assertions(stage).resolve().result()

    expect(factIds(result.selected)).toEqual(['A', 'C'])
    expect(factIds(result.superseded)).toEqual(['B'])
    expect(factIds(result.contested)).toEqual(['D', 'E'])
    expect(result.trace.every((entry) => Array.isArray(entry.evidence))).toBe(true)
  })

  it('applies deterministic policy decisions and caches prepared revisions', async () => {
    const storage = inMemoryStorage()
    const stage = assertionStage()
    const metadataSchema = z.object({ status: z.enum(['open']) })
    const counted = countLists(storage.records)
    const docs = knowledgeBase({
      id: 'docs',
      records: counted.records,
      metadataSchema,
      pipeline: indexingPipeline({ derive: [stage] }),
    })
    await docs.index([chunk('a', 'fact A', { status: 'open' })])
    const view = docs.view({ id: 'open', where: { status: 'open' } })
    const resolution = view.assertions(stage).resolve({
      id: 'policy',
      version: 1,
      run: ({ assertions }, decision) => {
        const first = assertions[0]
        if (first) decision.unresolved(first, 'needs review')
      },
    })

    await resolution.prepare()
    await resolution.prepare()
    await expect(resolution.status()).resolves.toMatchObject({ state: 'ready', cached: true })
    expect(factIds((await resolution.result()).unresolved)).toEqual(['A'])

    await docs.index([chunk('b', 'fact B', { status: 'open' })])
    await resolution.prepare()
    expect(factIds((await resolution.result()).unresolved)).toEqual(['A'])
    expect(factIds((await view.assertions(stage).list()).items)).toEqual(['A', 'B'])
  })

  it('does not expose assertion support records to expandRelations', async () => {
    const storage = inMemoryStorage()
    const stage = assertionStage()
    const docs = knowledgeBase({
      id: 'docs',
      storage,
      embeddings: testEmbedding(),
      pipeline: indexingPipeline({ derive: [stage] }),
    })
    await docs.index([chunk('relations', 'relations')])

    const hits = await docs.recipe({
      id: 'no-assertion-graph',
      steps: [retrieve({ limit: 1 }), expandRelations({ types: ['supports'], direction: 'out' })],
    }).retrieve('relations', { limit: 5 })

    expect(hits).toHaveLength(1)
  })
})

function assertionStage() {
  return assertions({
    id: 'facts',
    version: 1,
    types,
    run: (input, api) => {
      const evidence = { kind: 'chunk' as const, sourceId: input.document.sourceId, chunkId: input.chunks[0]?.chunkId ?? 'main' }
      const text = input.document.content ?? ''
      if (text.includes('price')) api.emit('price', { amount: 12, currency: 'EUR' }, { evidence, provenance: 'exact' })
      else if (text === 'relations') {
        api.emit('fact', { id: 'C', text: 'unrelated' }, { evidence })
        api.relate('supersedes',
          api.emit('fact', { id: 'A', text: 'new' }, { evidence }),
          api.emit('fact', { id: 'B', text: 'old' }, { evidence }),
          { evidence })
        const left = api.emit('fact', { id: 'D', text: 'left' }, { evidence })
        const right = api.emit('fact', { id: 'E', text: 'right' }, { evidence })
        api.relate('conflictsWith', left, right, { evidence })
      } else {
        const id = text.replace(/^fact /, '')
        api.emit('fact', { id, text: id }, { evidence })
      }
    },
  })
}

function chunk(sourceId: string, content: string, metadata: Record<string, unknown> = {}): CruxChunk {
  return schema2TextChunk({ namespace: 'docs', sourceId, chunkId: 'main', ordinal: 0, content, metadata })
}

function countLists(records: RecordStore): { readonly records: RecordStore; readonly prefixes: string[] } {
  const prefixes: string[] = []
  return {
    records: {
      ...records,
      list: async (prefix, options) => {
        prefixes.push(prefix)
        return records.list(prefix, options)
      },
    },
    prefixes,
  }
}

function factIds(items: ReadonlyArray<{ readonly type: string; readonly data: unknown }>): readonly string[] {
  return items.flatMap((item) =>
    item.type === 'fact' && isRecord(item.data) && typeof item.data.id === 'string' ? [item.data.id] : [],
  ).sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function testEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'assertion-consumption-test',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map((input) => (textOf(input).includes('relations') ? [1, 0] : [0, 1])),
  })
}
