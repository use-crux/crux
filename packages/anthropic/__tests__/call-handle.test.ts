import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt, tool } from '@use-crux/core'
import { createAnthropic } from '../src'
import type { AnthropicParsedMessage } from '../src/response'

describe('Anthropic call handle', () => {
  it('prepares params and finishes a plain text response', async () => {
    const anthropic = createAnthropic(noNetworkClient())
    const p = prompt({
      id: 'anthropic-handle-plain',
      system: 'Speak plainly.',
      prompt: ({ input }) => `Say ${input.word}.`,
      input: z.object({ word: z.string() }),
    })

    const call = await anthropic.prepare!(p, {
      model: 'claude-handle',
      input: { word: 'hello' },
      settings: { maxTokens: 64 },
    })

    expect(call.params).toMatchObject({
      model: 'claude-handle',
      system: 'Speak plainly.',
      messages: [{ role: 'user', content: 'Say hello.' }],
      max_tokens: 64,
    })

    const result = await call.finish(anthropicMessage({ text: 'hello' }, 1))

    expect(result.text).toBe('hello')
    expect(result.steps).toBe(1)
    expect(result.finalStep).toMatchObject({
      text: 'hello',
      finishReason: 'end_turn',
      responseId: 'msg_1',
    })
  })

  it('advances through a tool loop using the managed tool lifecycle', async () => {
    const anthropic = createAnthropic(noNetworkClient())
    const p = prompt({
      id: 'anthropic-handle-tool',
      prompt: 'Use the echo tool.',
      tools: {
        echo: tool({
          description: 'Echo text.',
          input: z.object({ value: z.string() }),
          execute: ({ value }) => `echo:${value}`,
        }),
      },
    })

    const call = await anthropic.prepare!(p, {
      model: 'claude-handle',
      maxSteps: 3,
    })

    expect(JSON.stringify(call.params)).toContain('"echo"')

    const first = await call.step(
      anthropicMessage(
        {
          text: '',
          toolCalls: [{ id: 'call_echo', name: 'echo', args: { value: 'hello' } }],
        },
        1,
      ),
    )

    expect(first.done).toBe(false)
    if (first.done) throw new Error('expected another provider call')
    expect(JSON.stringify(first.next.params)).toContain('echo:hello')

    const result = await first.next.finish(anthropicMessage({ text: 'done' }, 2))
    expect(result.text).toBe('done')
    expect(result.steps).toBe(2)
    expect(result.messages.some((message) => message.role === 'tool')).toBe(true)
  })
})

function noNetworkClient(): Anthropic {
  return {
    messages: {
      create: async () => {
        throw new Error('prepare/step tests must not call the Anthropic client')
      },
      parse: async () => {
        throw new Error('prepare/step tests must not call the Anthropic client')
      },
      stream: () => {
        throw new Error('prepare/step tests must not call the Anthropic client')
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
    id: `msg_${sequence}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-handle-actual',
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
