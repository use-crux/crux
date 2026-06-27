import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { prompt as makePrompt } from '@use-crux/core'
import { anthropicProviderRuntime } from '../index'

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
})
