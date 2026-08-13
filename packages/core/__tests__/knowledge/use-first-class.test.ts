import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  adapter,
  droppable,
  offloadable,
  prompt,
  summarizable,
  type AdapterResponse,
  type AdapterSpec,
  type CallArgs,
} from '../../src'
import { embedding } from '../../src/embedding'
import { assertions, knowledgeBase } from '../../src/knowledge'
import { compilePrompt } from '../../src/resolver/compile'
import { createResolverFakes } from '../../src/resolver/fakes'
import type { CruxChunk } from '../../src/indexing'
import { inMemoryRecordStore, inMemoryStorage } from '../../src/storage'
import { schema2TextChunk } from '../fixtures/schema2-stored-evidence'

describe('first-class connected knowledge use entries', () => {
  it('injects bare knowledge-base retrieval context from prompt input', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), embeddings: testEmbedding() })
    await docs.index([chunk({ sourceId: 'pricing', content: 'Pricing guide' })])
    const fakes = createResolverFakes()
    const answer = compilePrompt({
      id: 'bare-docs',
      input: z.object({ query: z.string() }),
      use: [docs],
      system: 'Base.',
    }, { ports: fakes.ports })

    const resolved = await answer.resolve({ input: { query: 'pricing' } })

    expect(resolved.args.system).toContain('Pricing guide')
    expect(resolved.args.tools).toBeUndefined()
    expect(fakes.observability.contributionPreviews('active')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'injectable:docs',
          injectableKind: 'retriever',
          injects: ['system'],
        }),
      ]),
    )
  })

  it('injects bare view retrieval from only view-visible members', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      metadataSchema: z.object({ status: z.enum(['open', 'closed']) }),
      embeddings: testEmbedding(),
    })
    await docs.index([
      chunk({ sourceId: 'open-guide', content: 'Open guide', metadata: { status: 'open' } }),
      chunk({ sourceId: 'closed-guide', content: 'Closed guide', metadata: { status: 'closed' } }),
    ])
    const view = docs.view({ id: 'open', where: { status: 'open' } })
    const answer = prompt({
      id: 'bare-view',
      input: z.object({ query: z.string() }),
      use: [view],
      system: 'Base.',
    })

    const resolved = await answer.resolve({ input: { query: 'guide' } })

    expect(resolved.system).toContain('Open guide')
    expect(resolved.system).not.toContain('Closed guide')
  })

  it('plans wrapper-over-handle and wrapper-over-context forms identically', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), embeddings: testEmbedding() })
    await docs.index([chunk({ sourceId: 'guide', content: 'Large guide content. '.repeat(120) })])
    const summarizedHandleRecords = inMemoryRecordStore()
    const summarizedContextRecords = inMemoryRecordStore()
    const droppedHandleRecords = inMemoryRecordStore()
    const droppedContextRecords = inMemoryRecordStore()
    const summarizedHandleUse = [summarizable(docs)]
    const summarizedContextUse = [summarizable(docs.asContext())]
    await runPlanned(summarizedHandleRecords, summarizedHandleUse, { optimizeAt: 640, max: 690 })
    await runPlanned(summarizedContextRecords, summarizedContextUse, { optimizeAt: 640, max: 690 })
    const summarizedHandle = await runPlanned(
      summarizedHandleRecords,
      summarizedHandleUse,
      { optimizeAt: 640, max: 690 },
    )
    const summarizedContext = await runPlanned(
      summarizedContextRecords,
      summarizedContextUse,
      { optimizeAt: 640, max: 690 },
    )
    const droppedHandle = await runPlanned(
      droppedHandleRecords,
      [droppable(offloadable(docs))],
      { optimizeAt: 40, max: 100 },
    )
    const droppedContext = await runPlanned(
      droppedContextRecords,
      [droppable(offloadable(docs.asContext()))],
      { optimizeAt: 40, max: 100 },
    )

    expect(adaptationShapes(summarizedHandle.adaptations)).toEqual(adaptationShapes(summarizedContext.adaptations))
    expect(summarizedHandle.contributions).toEqual(summarizedContext.contributions)
    expect(adaptationShapes(droppedHandle.adaptations)).toEqual(adaptationShapes(droppedContext.adaptations))
    expect(droppedHandle.contributions).toEqual(droppedContext.contributions)
  })

  it('preserves explicit asContext customization and tools through wrappers', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), embeddings: testEmbedding() })
    await docs.index([
      chunk({ sourceId: 'guide', content: 'Guide content' }),
      chunk({ sourceId: 'other', content: 'Other content' }),
    ])
    const source = docs.asContext({
      query: 'guide',
      limit: 1,
      tools: true,
      renderContext: (hits) => `CUSTOM:${hits.map((hit) => hit.kind === 'finding' ? hit.content : hit.source.id).join(',')}`,
    })
    const answer = prompt({
      id: 'explicit-wrapper',
      use: [summarizable(source)],
      system: 'Base.',
    })

    const resolved = await answer.resolve()

    expect(resolved.system).toContain('CUSTOM:guide')
    expect(resolved.system).not.toContain('Other content')
    expect(Object.keys(resolved.tools ?? {})).toEqual(['search'])
    expect(resolved.representations?.[0]).toMatchObject({
      contributor: 'retriever:docs',
      ownedToolNames: ['search'],
      rungs: [{ kind: 'full' }, { kind: 'summary' }],
    })
  })

  it('keeps bare assertion sets and resolutions injectable', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), pipeline: undefined })
    const set = docs.assertions(stage())
    const resolution = set.resolve({ id: 'policy', version: 1, run: ({ assertions }, api) => assertions.forEach(api.select) })

    const answer = prompt({ id: 'assertions-bare', use: [set, resolution], system: 'Base.' })
    const resolved = await answer.resolve()

    expect(resolved.system).toContain('Base.')
    expect(resolved.system).toContain('## Assertions: facts')
    expect(resolved.system).toContain('## Assertion Resolution: facts')
  })
})

async function runPlanned(
  records: ReturnType<typeof inMemoryRecordStore>,
  use: Parameters<typeof prompt>[0]['use'],
  inputBudget: { readonly optimizeAt: number; readonly max: number },
) {
  const installation = (await import('../../src')).config({ storage: { records } })
  const harness = requestHarness((args) => args.system?.includes('source summarizer') ? 'Short summary.' : 'done')
  try {
    const result = await harness.runtime.generate(
      prompt({
        id: `planned-${Math.random()}`,
        input: z.object({ query: z.string() }),
        use,
        prompt: 'Answer.',
      }),
      { model: 'model-1', input: { query: 'guide' }, inputBudget },
    )
    const inspection = await result.steps[0]!.request!.inspect()
    return {
      adaptations: result.steps[0]!.request!.adaptations,
      contributions: inspection.contributions,
    }
  } finally {
    installation.dispose()
  }
}

function adaptationShapes(adaptations: readonly {
  readonly contributor: string
  readonly representation: string
  readonly fullTokens: number
  readonly selectedTokens: number
}[]) {
  return adaptations.map(({ contributor, representation, fullTokens, selectedTokens }) => ({
    contributor,
    representation,
    fullTokens,
    selectedTokens,
  }))
}

function requestHarness(reply?: (args: CallArgs) => string) {
  const spec: AdapterSpec<object, { readonly text: string }> = {
    providerId: 'knowledge-first-class-test',
    capacity: () => ({ contextWindow: 32_768, defaultOutputReserve: 256, countingConfidence: 'estimated' }),
    async call(_client, args) {
      const text = reply?.(args) ?? 'done'
      return { raw: { text }, extracted: response(text) }
    },
    async stream() {
      throw new Error('not used')
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  }
  return { runtime: adapter(spec)({}) }
}

function response(text: string): AdapterResponse {
  return { text, usage: undefined, finishReason: 'stop', responseId: 'response-1', actualModelId: 'model-1' }
}

function testEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'knowledge-first-class-test',
    dimensions: 2,
    maxInputTokens: 10_000,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map(() => [1, 0]),
  })
}

function stage() {
  return assertions({
    id: 'facts',
    version: 1,
    types: { fact: z.object({ id: z.string(), text: z.string() }) },
    run: (input, api) => api.emit('fact', { id: input.document.sourceId, text: input.document.content ?? '' }, {
      evidence: { kind: 'chunk', sourceId: input.document.sourceId, chunkId: input.chunks[0]?.chunkId ?? 'main' },
    }),
  })
}

function chunk(input: {
  readonly sourceId: string
  readonly content: string
  readonly metadata?: Record<string, unknown>
}): CruxChunk {
  return schema2TextChunk({
    namespace: 'docs',
    sourceId: input.sourceId,
    chunkId: 'main',
    ordinal: 0,
    content: input.content,
    metadata: input.metadata ?? {},
  })
}
