import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import { prompt as makePrompt } from '@crux/core'
import { openaiProviderRuntime } from '../index'

interface OpenAIRuntimeRequest {
  readonly model: unknown
  readonly messages?: unknown
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
})
