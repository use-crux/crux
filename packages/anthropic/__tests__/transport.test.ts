import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt, tool } from '@use-crux/core'
import { createAnthropic } from '../index'
import type { AnthropicParsedMessage } from '../response'

describe('Anthropic transport', () => {
  it('runs generate through user-supplied provider params and responses', async () => {
    const p = prompt({
      id: 'anthropic-transport-tool',
      prompt: 'Use the echo tool.',
      tools: {
        echo: tool({
          description: 'Echo text.',
          input: z.object({ value: z.string() }),
          execute: ({ value }) => `echo:${value}`,
        }),
      },
    })
    const calls: Array<{ params: unknown; stepIndex: number; modelId: string; signal: AbortSignal }> = []
    const responses = [
      anthropicMessage(
        {
          text: '',
          toolCalls: [{ id: 'call_echo', name: 'echo', args: { value: 'hello' } }],
        },
        1,
      ),
      anthropicMessage({ text: 'done' }, 2),
    ]

    const result = await createAnthropic(noNetworkClient()).generate(p, {
      model: 'claude-transport',
      maxSteps: 3,
      transport: async (params, info) => {
        calls.push({ params, ...info })
        return responses.shift()!
      },
    })

    expect(result.text).toBe('done')
    expect(result.steps).toBe(2)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ stepIndex: 0, modelId: 'claude-transport' })
    expect(JSON.stringify(calls[0]!.params)).toContain('"echo"')
    expect(JSON.stringify(calls[1]!.params)).toContain('echo:hello')
    expect(calls.every((call) => call.signal instanceof AbortSignal)).toBe(true)
  })
})

function noNetworkClient(): Anthropic {
  return {
    messages: {
      create: async () => {
        throw new Error('transport tests must not call the Anthropic client')
      },
      parse: async () => {
        throw new Error('transport tests must not call the Anthropic client')
      },
      stream: () => {
        throw new Error('transport tests must not call the Anthropic client')
      },
    },
  } as unknown as Anthropic
}

function anthropicMessage(
  emission: {
    readonly text: string
    readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly args: unknown }[]
  },
  sequence: number,
): AnthropicParsedMessage {
  const toolBlocks =
    emission.toolCalls?.map((toolCall) => ({
      type: 'tool_use' as const,
      id: toolCall.id,
      name: toolCall.name,
      input: toolInput(toolCall.args),
    })) ?? []

  return {
    id: `msg_transport_${sequence}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-transport-actual',
    content: [...(emission.text ? [{ type: 'text' as const, text: emission.text }] : []), ...toolBlocks],
    stop_reason: toolBlocks.length > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 2, output_tokens: 3 },
  } as AnthropicParsedMessage
}

function toolInput(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }
}
