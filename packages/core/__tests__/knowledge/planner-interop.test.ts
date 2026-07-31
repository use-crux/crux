import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  adapter,
  config,
  droppable,
  knowledgeBase,
  offloadable,
  prompt,
  summarizable,
  type AdapterSpec,
  type CallArgs,
} from '../../src'
import { embedding } from '../../src/embedding'
import { assertions } from '../../src/knowledge'
import type { CruxChunk } from '../../src/indexing'
import type { AdapterResponse } from '../../src'
import { inMemoryStorage, inMemoryRecordStore } from '../../src/storage'

describe.sequential('knowledge planner interop', () => {
  it('keeps unwrapped view retrieval and assertion contexts exact and required', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      metadataSchema: z.object({ status: z.enum(['open', 'closed']) }),
      embeddings: testEmbedding(),
      pipeline: undefined,
    })
    await docs.index([
      chunk({ sourceId: 'guide', content: 'Open guide content', metadata: { status: 'open' } }),
      chunk({ sourceId: 'closed', content: 'Closed guide content', metadata: { status: 'closed' } }),
    ])
    const view = docs.view({ id: 'open', where: { status: 'open' } })
    const answer = prompt({
      id: 'knowledge-required',
      use: [
        view.retriever({ limit: 1 }).asContext({ query: 'guide' }),
        docs.assertions(stage()).asContext(),
      ],
      prompt: 'Answer.',
    })
    const harness = requestHarness()

    const result = await harness.runtime.generate(answer, { model: 'model-1' })
    const inspection = await result.steps[0]!.request!.inspect()

    expect(result.steps[0]?.request?.adaptations).toEqual([])
    expect(inspection.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'context:retriever:docs:open',
          boundary: 'required',
          representations: ['full'],
        }),
        expect.objectContaining({
          id: 'context:assertions:facts',
          boundary: 'required',
          representations: ['full'],
        }),
      ]),
    )
  })

  it('keys summarizable view artifacts by source versions as well as rendered text', async () => {
    const records = inMemoryRecordStore()
    const installation = config({ persistence: { records } })
    const storage = inMemoryStorage()
    const docs = knowledgeBase({
      id: 'docs',
      storage,
      metadataSchema: z.object({ status: z.enum(['open']), revisionMarker: z.string().optional() }),
      embeddings: testEmbedding(),
    })
    const harness = requestHarness((args) =>
      args.system?.includes('source summarizer') ? 'Stable summary.' : 'done')

    try {
      await docs.index([
        chunk({ sourceId: 'guide', content: 'Same visible content. '.repeat(400), metadata: { status: 'open' } }),
      ])
      const view = docs.view({ id: 'open', where: { status: 'open' } })
      await harness.runtime.generate(
        prompt({
          id: 'summary-rev-a',
          use: [summarizable(view.retriever({ limit: 1 }).asContext({ query: 'guide' }))],
          prompt: 'Answer.',
        }),
        { model: 'summary-model', inputBudget: { optimizeAt: 800, max: 850 } },
      )

      await docs.reindex([
        chunk({ sourceId: 'guide', content: 'Same visible content. '.repeat(400), metadata: { status: 'open', revisionMarker: 'b' } }),
      ])
      await harness.runtime.generate(
        prompt({
          id: 'summary-rev-b',
          use: [summarizable(view.retriever({ limit: 1 }).asContext({ query: 'guide' }))],
          prompt: 'Answer.',
        }),
        { model: 'summary-model', inputBudget: { optimizeAt: 800, max: 850 } },
      )

      expect((await records.list('crux:request-summary:v1:source:')).entries).toHaveLength(2)
    } finally {
      installation.dispose()
    }
  })

  it('keeps retriever tools for summarized references and removes them only on omission', async () => {
    const records = inMemoryRecordStore()
    const installation = config({ persistence: { records } })
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: testEmbedding(),
    })
    await docs.index([
      chunk({ sourceId: 'guide', content: 'Large retriever content. '.repeat(80) }),
    ])
    const source = docs.retriever({ limit: 1 }).asContext({ query: 'guide', tools: true })

    try {
      const summarized = requestHarness((args) =>
        args.system?.includes('source summarizer') ? 'Short summary.' : 'done')
      await summarized.runtime.generate(
        prompt({
          id: 'knowledge-summary-tools',
          use: [summarizable(source)],
          prompt: 'Answer.',
        }),
        { model: 'model-1', inputBudget: { optimizeAt: 640, max: 690 } },
      )
      expect(summarized.requests.at(-1)?.tools?.map((tool) => tool.name)).toEqual(['search'])

      const omitted = requestHarness()
      await omitted.runtime.generate(
        prompt({
          id: 'knowledge-omitted-tools',
          use: [droppable(offloadable(source))],
          prompt: 'Answer.',
        }),
        { model: 'model-1', inputBudget: { optimizeAt: 40, max: 100 } },
      )
      expect(omitted.requests.at(-1)?.tools ?? []).toEqual([])
    } finally {
      installation.dispose()
    }
  })

  it('receipts knowledge contributor identities without content text', async () => {
    const docs = knowledgeBase({ id: 'docs', storage: inMemoryStorage(), embeddings: testEmbedding() })
    await docs.index([chunk({ sourceId: 'guide', content: 'Receipt secret content' })])
    const result = await requestHarness().runtime.generate(
      prompt({
        id: 'knowledge-receipt-identity',
        use: [docs.retriever({ limit: 1 }).asContext({ query: 'guide' })],
        prompt: 'Answer.',
      }),
      { model: 'model-1' },
    )

    const serialized = JSON.stringify(await result.steps[0]!.request!.inspect())
    expect(serialized).toContain('context:retriever:docs')
    expect(serialized).not.toContain('Receipt secret content')
  })

})

function requestHarness(reply?: (args: CallArgs) => string) {
  const requests: CallArgs[] = []
  const spec: AdapterSpec<object, { readonly text: string }> = {
    providerId: 'knowledge-planner-test',
    capacity: () => ({
      contextWindow: 32_768,
      defaultOutputReserve: 256,
      countingConfidence: 'estimated',
    }),
    async call(_client, args) {
      requests.push(args)
      const text = reply?.(args) ?? 'done'
      return { raw: { text }, extracted: response(text) }
    },
    async stream() {
      throw new Error('not used')
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  }
  return { runtime: adapter(spec)({}), requests }
}

function response(text: string): AdapterResponse {
  return {
    text,
    usage: undefined,
    finishReason: 'stop',
    responseId: 'response-1',
    actualModelId: 'model-1',
  }
}

function testEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'knowledge-planner-test',
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
    types: {
      fact: z.object({ id: z.string(), text: z.string() }),
    },
    run: (input, api) => {
      api.emit('fact', {
        id: input.document.sourceId,
        text: input.document.content ?? '',
      }, {
        evidence: {
          kind: 'chunk',
          sourceId: input.document.sourceId,
          chunkId: input.chunks[0]?.chunkId ?? 'main',
        },
      })
    },
  })
}

function chunk(input: {
  readonly sourceId: string
  readonly content: string
  readonly metadata?: Record<string, unknown>
}): CruxChunk {
  return {
    namespace: 'docs',
    sourceId: input.sourceId,
    chunkId: 'main',
    ordinal: 0,
    content: input.content,
    metadata: input.metadata ?? {},
  }
}
