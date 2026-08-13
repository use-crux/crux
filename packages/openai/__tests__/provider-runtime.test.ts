import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import { createStoredEvidence, prompt as makePrompt, type RetrieverHit } from '@use-crux/core'
import { z } from 'zod'
import { createOpenAI, openaiProviderRuntime } from '../src'

interface OpenAIRuntimeRequest {
  readonly model: unknown
  readonly messages?: unknown
}

function retrievalHit(sourceId: string, chunkId: string, content: string, score: number): RetrieverHit {
  const documentSha256 = createHash('sha256').update(content).digest('hex')
  const producer = {
    kind: 'parser' as const,
    name: 'text' as const,
    version: 'test:text-parser:2',
    adapterVersion: 'test:text-adapter:2',
  }

  return {
    namespace: 'n',
    source: { id: sourceId },
    chunkId,
    content,
    metadata: {},
    score,
    evidence: createStoredEvidence({
      document: { documentSha256, producer, normalizationVersion: 'test:text-normalization:2' },
      origin: {
        coordinate: { kind: 'document', documentSha256 },
        producer,
        blockIds: [`block:${sourceId}`],
      },
      chunkId,
      normalizedContent: content,
      chunkerVersion: 'test:text-chunker:2',
    }),
  }
}

function chatResponse(content: string): ChatCompletion {
  return {
    id: 'chatcmpl_profile',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-4o-actual',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, refusal: null },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
  } as unknown as ChatCompletion
}

function parsedChatResponse(parsed: unknown): ChatCompletion {
  return {
    ...chatResponse(''),
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: null, refusal: null, parsed } as never,
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
  } as unknown as ChatCompletion
}

describe('OpenAI provider runtime', () => {
  it('exposes OpenAI as a single-turn provider runtime peer', async () => {
    const create = vi.fn(async (_request: OpenAIRuntimeRequest) => chatResponse('provider runtime response'))
    const client = {
      chat: { completions: { create, parse: vi.fn() } },
    } as unknown as OpenAI
    const adapter = openaiProviderRuntime.create(client)

    const result = await adapter.generate(makePrompt({ id: 'openai-provider-runtime' }), {
      model: 'gpt-4o',
    })

    expect(openaiProviderRuntime.id).toBe('openai')
    expect(adapter.providerId).toBe('openai')
    expect(result.text).toBe('provider runtime response')
    expect(create).toHaveBeenCalledOnce()
  })

  it('exposes retrieval model and judge-backed reranker on created adapters', async () => {
    const create = vi.fn(async (_request: OpenAIRuntimeRequest) => chatResponse('retrieval text'))
    const parse = vi
      .fn()
      .mockResolvedValueOnce(parsedChatResponse({ answer: 'retrieval object' }))
      .mockResolvedValueOnce(parsedChatResponse({ rankings: [{ index: 1, score: 0.88 }] }))
    const client = {
      chat: { completions: { create, parse } },
    } as unknown as OpenAI
    const adapter = createOpenAI(client)

    const retrieval = adapter.retrievalModel({ model: 'gpt-4o' })
    await expect(retrieval.generateText({ prompt: 'retrieve text' })).resolves.toEqual({ text: 'retrieval text' })
    await expect(
      retrieval.generateObject({
        prompt: 'retrieve object',
        schema: z.object({ answer: z.string() }),
      }),
    ).resolves.toEqual({ object: { answer: 'retrieval object' } })

    await expect(
      adapter.reranker({ model: 'gpt-4o' }).rerank({
        query: 'needle',
        hits: [
          retrievalHit('a', 'a1', 'first', 0.1),
          retrievalHit('b', 'b1', 'second', 0.2),
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ source: { id: 'b' }, score: 0.88, provenance: { rerankScore: 0.88 } }),
      expect.objectContaining({ source: { id: 'a' }, score: 0.1 }),
    ])
  })
})
