import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import { prompt as makePrompt } from '@crux/core'
import { openaiProfile } from '../index'

interface OpenAIProfileRequest {
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

describe('OpenAI adapter profile', () => {
  it('creates the public adapter runtime from the profile', async () => {
    const create = vi.fn(async (_request: OpenAIProfileRequest) => chatResponse('profile response'))
    const client = {
      chat: { completions: { create, parse: vi.fn() } },
    } as unknown as OpenAI
    const adapter = openaiProfile.create(client)

    const result = await adapter.generate(makePrompt({ id: 'openai-profile' }), {
      model: 'gpt-4o',
    })

    expect(openaiProfile.id).toBe('openai')
    expect(adapter.providerId).toBe('openai')
    expect(result.text).toBe('profile response')
    expect(create).toHaveBeenCalledOnce()
  })
})
