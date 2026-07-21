import { describe, expect, it } from 'vitest'
import { adapter } from '../../src/adapter/define-adapter'
import type { AdapterSpec } from '../../src/adapter/spec'
import { embedding as makeEmbedding } from '../../src/embedding'
import { indexer as makeIndexer } from '../../src/indexing'
import { prompt } from '../../src/prompt/prompt'
import { RETRIEVAL_HITS_KIND, retriever as makeRetriever } from '../../src/retrieval'
import { inMemoryRecordStore, inMemoryVectorStore } from '../../src/storage'
import { boundary, guardrail } from '../../src/safety'
import type { Message } from '../../src/generation/messages'
import { textOf } from '../embedding/text-input'

function createDenseEmbedding() {
  return makeEmbedding({
    kind: 'dense',
    name: 'test-dense',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map((input) => [textOf(input).length, textOf(input).length / 2]),
  })
}

describe('retriever tools', () => {
  it('guards rendered retrieval-tool output exactly once as tool text', async () => {
    const retriever = makeRetriever({
      id: 'private-docs',
      namespace: 'docs',
      retrieve: async () => [
        {
          namespace: 'docs',
          source: {
            id: 'doc-1',
            assetRef: { uri: 'memory://asset/private' },
            mediaType: 'image/png',
            url: 'https://private.example/doc-1.png',
            location: { type: 'page' as const, pageNumber: 7 },
          },
          chunkId: '0',
          content: 'Private retrieval text',
          metadata: {},
          score: 0.93,
        },
      ],
    })
    const assistant = prompt({ id: 'retrieval-tool-ingress', use: [retriever], prompt: 'Search.' })
    const providerMessages: Array<readonly Message[]> = []
    let calls = 0
    const client = {}
    const spec: AdapterSpec<typeof client, { readonly call: number }, never> = {
      providerId: 'retrieval-tool-ingress',
      async call(_client, args) {
        calls++
        providerMessages.push(args.messages)
        return {
          raw: { call: calls },
          extracted: {
            text: calls === 1 ? '' : 'done',
            toolCalls: calls === 1 ? [{ id: 'call-search', name: 'search', args: { query: 'private' } }] : undefined,
            usage: undefined,
            finishReason: calls === 1 ? 'tool_calls' : 'stop',
            responseId: undefined,
            actualModelId: undefined,
          },
        }
      },
      async stream() {
        throw new Error('not used')
      },
      appendToolRound(messages, assistantResponse, results) {
        return [
          ...messages,
          { role: 'assistant', content: assistantResponse.text, metadata: { toolCalls: assistantResponse.toolCalls } },
          ...results.map((result) => ({
            role: 'tool' as const,
            content: result.content,
            metadata: { toolCallId: result.toolCallId, toolName: result.name },
          })),
        ]
      },
      mapSettings: (settings) => ({ ...settings }),
    }
    let toolEvaluations = 0
    let retrievalEvaluations = 0

    await adapter(spec)(client).generate(assistant, {
      model: 'test-model',
      guardrails: [
        guardrail({
          id: 'guard-retrieval-tool-text',
          on: boundary.input.text({ from: 'tool' }),
          run: (text, context) => {
            toolEvaluations++
            expect(context.origin).toEqual({
              source: 'tool',
              kind: 'tool-result',
              toolName: 'search',
              toolCallId: 'call-search',
            })
            expect(text).toBe('[doc-1/0] (0.93) Private retrieval text')
            expect(text).not.toMatch(/asset|image\/png|private\.example|page/i)
            return { action: 'rewrite', value: 'safe search result', rewrite: { kind: 'redact' } }
          },
        }),
        guardrail({
          id: 'do-not-route-tool-as-retrieval',
          on: boundary.input.text({ from: 'retrieval' }),
          run: () => {
            retrievalEvaluations++
            return { action: 'allow' }
          },
        }),
      ],
    })

    expect(toolEvaluations).toBe(1)
    expect(retrievalEvaluations).toBe(0)
    expect(providerMessages[1]).toContainEqual(
      expect.objectContaining({ role: 'tool', content: 'safe search result' }),
    )
  })

  it('injects a typed search tool by default when used directly in a prompt', async () => {
    const retriever = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [
        {
          namespace: 'docs',
          source: { id: 'doc-1' },
          chunkId: '0',
          content: 'Release notes',
          metadata: {},
          score: 0.93,
        },
      ],
    })
    const answer = prompt({ use: [retriever], system: 'Base.' })

    const resolved = await answer.resolve({})

    expect(resolved.system).toBe('Base.')
    expect(resolved.tools?.search).toBeDefined()
    const payload = await resolved.tools!.search.execute({ query: 'release', limit: 1 })
    expect(payload).toMatchObject({
      kind: RETRIEVAL_HITS_KIND,
      hits: [
        {
          namespace: 'docs',
          source: { id: 'doc-1' },
          chunkId: '0',
          content: 'Release notes',
          score: 0.93,
        },
      ],
    })
    const modelOutput = await resolved.tools!.search.toModelOutput?.({
      toolCallId: 'call-1',
      input: { query: 'release', limit: 1 },
      output: payload,
    })
    expect(modelOutput).toEqual({
      type: 'text',
      value: '[doc-1/0] (0.93) Release notes',
    })
  })

  it('exposes search payloads and rejects getSource without store or session visibility', async () => {
    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      retrieve: async (query, options) => [
        {
          namespace: 'docs',
          source: { id: 'doc-4' },
          chunkId: '1',
          content: `${query}:${options.limit}`,
          metadata: { kind: 'note' },
          score: 0.7,
        },
      ],
    })

    const tools = retriever.asTools({ include: ['search', 'getSource'] })

    expect(Object.keys(tools)).toEqual(['search', 'getSource'])
    expect(tools.search.parameters.safeParse({ query: 'ops', limit: 2 }).success).toBe(true)
    await expect(
      tools.search.execute({ query: 'ops', limit: 2, filter: { topic: 'launch' } }),
    ).resolves.toEqual({
      kind: RETRIEVAL_HITS_KIND,
      hits: [
        {
          namespace: 'docs',
          source: { id: 'doc-4' },
          chunkId: '1',
          content: 'ops:2',
          score: 0.7,
        },
      ],
    })
    await expect(tools.getSource.execute({ sourceId: 'doc-4', chunkId: '1' })).rejects.toThrow(
      'getSource requires a store-backed retriever or grounding session',
    )
  })

  it('reads active source chunks through store-backed getSource namespace visibility', async () => {
    const records = inMemoryRecordStore()
    const vectors = inMemoryVectorStore()
    const dense = createDenseEmbedding()
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'docs',
      records,
      vectors,
      dense,
    })
    await indexer.indexDocuments([
      {
        namespace: 'docs',
        sourceId: 'guide.md',
        content: 'Store-backed source body',
      },
    ])
    const retriever = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      records,
      vectors,
      dense,
    })

    const tools = retriever.asTools({
      include: ['getSource'],
      getSource: { visibility: 'namespace' },
    })
    const page = await records.list('indexer:docs:namespace:docs:source:guide.md:chunk:')
    const chunkId = page.entries[0].value.chunkId
    expect(typeof chunkId).toBe('string')

    await expect(tools.getSource.execute({ sourceId: 'guide.md', chunkId })).resolves.toMatchObject({
      kind: RETRIEVAL_HITS_KIND,
      hits: [
        {
          namespace: 'docs',
          source: { id: 'guide.md' },
          chunkId,
          content: 'Store-backed source body',
        },
      ],
    })
  })
})
