import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { prompt as makePrompt } from '@crux/core'
import { anthropicProfile } from '../index'

interface AnthropicProfileRequest {
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

describe('Anthropic adapter profile', () => {
  it('creates the public adapter runtime from the profile', async () => {
    const create = vi.fn(async (_request: AnthropicProfileRequest) => anthropicMessage('profile response'))
    const client = { messages: { create, parse: vi.fn(), stream: vi.fn() } } as unknown as Anthropic
    const adapter = anthropicProfile.create(client)

    const result = await adapter.generate(makePrompt({ id: 'anthropic-profile' }), {
      model: 'claude-sonnet-4-5-20250929',
    })

    expect(anthropicProfile.id).toBe('anthropic')
    expect(adapter.providerId).toBe('anthropic')
    expect(result.text).toBe('profile response')
    expect(create).toHaveBeenCalledOnce()
  })
})
