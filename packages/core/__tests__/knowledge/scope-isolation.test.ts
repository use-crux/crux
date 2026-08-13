import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { embedding } from '../../src/embedding'
import { indexingPipeline, type CruxChunk } from '../../src/indexing'
import { knowledgeBase, relate, type KnowledgeRef } from '../../src/knowledge'
import { expandRelations, retrieve, retrievalStep, type RetrieverHit } from '../../src/retrieval'
import { inMemoryStorage, type RecordStore } from '../../src/storage'
import { textOf } from '../embedding/text-input'
import { schema2TextChunk } from '../fixtures/schema2-stored-evidence'

const schema = z.object({
  status: z.enum(['open', 'closed']),
  team: z.string(),
})

const relations = relate({
  id: 'scope-links',
  version: 1,
  types: {
    related: {
      from: ['chunk'],
      to: ['chunk'],
      direction: 'directed',
      description: 'Connects a seed chunk to its target chunk.',
    },
  },
  run: ({ chunks }, api) => {
    const seed = chunks.find((chunk) => chunk.chunkId === 'seed')
    const target = chunks.find((chunk) => chunk.chunkId === 'target')
    if (!seed || !target) return
    const evidence = chunkRef(seed.sourceId, seed.chunkId)
    api.emit('related', evidence, chunkRef(target.sourceId, target.chunkId), {
      evidence,
      provenance: 'exact',
    })
  },
})

describe('connected knowledge scope isolation', () => {
  it('isolates retrieval, claims, views, graph reads, hydration, and relation expansion by namespace', async () => {
    const storage = inMemoryStorage()
    const root = knowledgeBase({
      id: 'docs',
      storage,
      embeddings: testEmbedding(),
      metadataSchema: schema,
      pipeline: indexingPipeline({ derive: [relations] }),
      lifecycle: { retention: 'retain-inactive' },
    })
    const tenantA = root.scope({ namespace: 'tenant-a' })
    const tenantB = root.scope({ namespace: 'tenant-b' })

    await tenantA.index([
      chunk('tenant-a', 'guide', 'seed', 'alpha seed'),
      chunk('tenant-a', 'guide', 'target', 'alpha target'),
    ])
    await tenantB.index([
      chunk('tenant-b', 'guide', 'seed', 'beta seed'),
      chunk('tenant-b', 'guide', 'target', 'beta target'),
      chunk('tenant-b', 'extra', 'seed', 'beta extra'),
    ])

    await expect(tenantA.retriever().retrieve('alpha seed', { limit: 4 })).resolves.toEqual([
      expect.objectContaining({ namespace: 'tenant-a', source: { id: 'guide' }, chunkId: 'seed' }),
      expect.objectContaining({ namespace: 'tenant-a', source: { id: 'guide' }, chunkId: 'target' }),
    ])
    await expect(tenantB.retriever().retrieve('beta seed', { limit: 4 })).resolves.toEqual([
      expect.objectContaining({ namespace: 'tenant-b', source: { id: 'extra' }, chunkId: 'seed' }),
      expect.objectContaining({ namespace: 'tenant-b', source: { id: 'guide' }, chunkId: 'seed' }),
      expect.objectContaining({ namespace: 'tenant-b', source: { id: 'guide' }, chunkId: 'target' }),
    ])

    const claimsA = await listKeys(storage.records, 'indexer:docs:namespace:tenant-a:claims:')
    const claimsB = await listKeys(storage.records, 'indexer:docs:namespace:tenant-b:claims:')
    expect(claimsA.length).toBeGreaterThan(0)
    expect(claimsB.length).toBeGreaterThan(0)
    expect(claimsA.every((key) => key.includes(':namespace:tenant-a:'))).toBe(true)
    expect(claimsB.every((key) => key.includes(':namespace:tenant-b:'))).toBe(true)

    const viewA = tenantA.view({ id: 'open', where: { status: 'open' } })
    const viewB = tenantB.view({ id: 'open', where: { status: 'open' } })
    const resolvedA = await viewA.resolve()
    const resolvedB = await viewB.resolve()
    expect(resolvedA.members).toEqual(['guide'])
    expect(resolvedB.members).toEqual(['extra', 'guide'])
    expect(resolvedA.revisionHash).not.toBe(resolvedB.revisionHash)
    await expect(viewA.at(resolvedA.revisionHash).resolve()).resolves.toEqual(resolvedA)

    await expect(observeGraph(tenantA, 'alpha seed')).resolves.toEqual({
      namespace: 'tenant-a',
      neighbors: [{ ref: chunkRef('guide', 'target'), type: 'related', direction: 'out' }],
      hydrated: ['tenant-a:guide:target:alpha target'],
    })
    await expect(observeGraph(tenantB, 'beta seed')).resolves.toEqual({
      namespace: 'tenant-b',
      neighbors: [{ ref: chunkRef('guide', 'target'), type: 'related', direction: 'out' }],
      hydrated: ['tenant-b:guide:target:beta target'],
    })

    await expect(expand(tenantA, 'alpha seed')).resolves.toEqual([
      'tenant-a:guide:seed:alpha seed',
      'tenant-a:guide:target:alpha target',
    ])
    await expect(expand(tenantB, 'beta seed')).resolves.toEqual([
      'tenant-b:extra:seed:beta extra',
      'tenant-b:guide:seed:beta seed',
      'tenant-b:guide:target:beta target',
    ])
  })
})

function testEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'scope-isolation',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map((input) => {
      const text = textOf(input)
      return text.includes('seed') || text.includes('extra') ? [1, 0] : [0.9, 0.1]
    }),
  })
}

function chunk(namespace: string, sourceId: string, chunkId: string, content: string): CruxChunk {
  return schema2TextChunk({
    namespace,
    sourceId,
    chunkId,
    ordinal: chunkId === 'seed' ? 0 : 1,
    content,
    metadata: { status: 'open', team: namespace },
  })
}

async function observeGraph(
  surface: ReturnType<ReturnType<typeof knowledgeBase>['scope']>,
  query: string,
) {
  let observed:
    | {
        namespace: string
        neighbors: readonly { readonly ref: KnowledgeRef; readonly type: string; readonly direction: 'out' | 'in' }[]
        hydrated: readonly string[]
      }
    | undefined

  await surface.recipe({
    steps: [
      retrievalStep({
        id: 'observe-graph',
        phase: { in: 'queries', out: 'hits' },
        async run(_, context) {
          if (!context.knowledge) throw new Error('Expected scoped graph access.')
          const neighbors = await context.knowledge.reader.neighbors(chunkRef('guide', 'seed'), {
            types: ['related'],
            direction: 'out',
          })
          const hydrated = await Promise.all(neighbors.map((neighbor) => context.knowledge!.hydrate(neighbor.ref)))
          observed = {
            namespace: context.knowledge.namespace,
            neighbors,
            hydrated: hydrated.filter(isHit).map(hitLabel),
          }
          return { hits: hydrated.filter(isHit) }
        },
      }),
    ],
  }).retrieve(query)

  if (!observed) throw new Error('Graph observation did not run.')
  return observed
}

async function expand(
  surface: ReturnType<ReturnType<typeof knowledgeBase>['scope']>,
  query: string,
): Promise<readonly string[]> {
  const hits = await surface.recipe({
    steps: [retrieve({ limit: 2 }), expandRelations({ types: ['related'], direction: 'out', seeds: ['hits'] })],
  }).retrieve(query, { limit: 5 })
  return hits.map(hitLabel)
}

async function listKeys(records: RecordStore, prefix: string): Promise<readonly string[]> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await records.list(prefix, { cursor })
    keys.push(...page.entries.map((record) => record.key))
    cursor = page.cursor
  } while (cursor)
  return keys.sort()
}

function chunkRef(sourceId: string, chunkId: string): KnowledgeRef {
  return { kind: 'chunk', sourceId, chunkId }
}

function isHit(hit: RetrieverHit | null): hit is RetrieverHit {
  return hit !== null
}

function hitLabel(hit: RetrieverHit): string {
  return `${hit.namespace}:${hit.source.id}:${hit.chunkId}:${hit.content}`
}
