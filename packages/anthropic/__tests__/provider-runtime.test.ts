import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { prompt as makePrompt } from '@use-crux/core'
import { z } from 'zod'
import { anthropicProviderRuntime, createAnthropic } from '../src'

interface AnthropicRuntimeRequest {
  readonly model: unknown
  readonly messages?: unknown
}

function anthropicMessage(text: string): Anthropic.Message {
  return {
    id: 'msg_profile',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-actual',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 4, output_tokens: 3 },
  } as unknown as Anthropic.Message
}

describe('Anthropic provider runtime', () => {
  it('exposes Anthropic as a single-turn provider runtime peer', async () => {
    const create = vi.fn(async (_request: AnthropicRuntimeRequest) =>
      anthropicMessage('provider runtime response'),
    )
    const client = { messages: { create, parse: vi.fn(), stream: vi.fn() } } as unknown as Anthropic
    const adapter = anthropicProviderRuntime.create(client)

    const result = await adapter.generate(makePrompt({ id: 'anthropic-provider-runtime' }), {
      model: 'claude-sonnet-4-5-20250929',
    })

    expect(anthropicProviderRuntime.id).toBe('anthropic')
    expect(adapter.providerId).toBe('anthropic')
    expect(result.text).toBe('provider runtime response')
    expect(create).toHaveBeenCalledOnce()
  })

  it('exposes retrieval model and judge-backed reranker on created adapters', async () => {
    const create = vi.fn(async (_request: AnthropicRuntimeRequest) => anthropicMessage('retrieval text'))
    const parse = vi
      .fn()
      .mockResolvedValueOnce({ ...anthropicMessage(''), parsed_output: { answer: 'retrieval object' } })
      .mockResolvedValueOnce({ ...anthropicMessage(''), parsed_output: { rankings: [{ index: 1, score: 0.88 }] } })
    const client = { messages: { create, parse, stream: vi.fn() } } as unknown as Anthropic
    const adapter = createAnthropic(client)

    const retrieval = adapter.retrievalModel({ model: 'claude-sonnet-4-5-20250929' })
    await expect(retrieval.generateText({ prompt: 'retrieve text' })).resolves.toEqual({ text: 'retrieval text' })
    await expect(
      retrieval.generateObject({
        prompt: 'retrieve object',
        schema: z.object({ answer: z.string() }),
      }),
    ).resolves.toEqual({ object: { answer: 'retrieval object' } })

    await expect(
      adapter.reranker({ model: 'claude-sonnet-4-5-20250929' }).rerank({
        query: 'needle',
        hits: [
          { namespace: 'n', source: { id: 'a' }, chunkId: 'a1', content: 'first', metadata: {}, score: 0.1 },
          { namespace: 'n', source: { id: 'b' }, chunkId: 'b1', content: 'second', metadata: {}, score: 0.2 },
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ source: { id: 'b' }, score: 0.88, provenance: { rerankScore: 0.88 } }),
      expect.objectContaining({ source: { id: 'a' }, score: 0.1 }),
    ])
  })
})
