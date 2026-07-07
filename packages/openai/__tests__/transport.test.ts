import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt, tool } from '@use-crux/core'
import { createOpenAI } from '../index'

describe('OpenAI transport', () => {
  it('runs generate through user-supplied provider params and responses', async () => {
    const p = prompt({
      id: 'openai-transport-tool',
      prompt: 'Use the echo tool.',
      tools: {
        echo: tool({
          description: 'Echo text.',
          input: z.object({ value: z.string() }),
          execute: ({ value }) => `echo:${value}`,
        }),
      },
    })
    const calls: Array<{ params: unknown; stepIndex: number; modelId: string; signal: AbortSignal | undefined }> = []
    const responses = [
      openAICompletion(
        {
          text: '',
          toolCalls: [{ id: 'call_echo', name: 'echo', args: { value: 'hello' } }],
        },
        1,
      ),
      openAICompletion({ text: 'done' }, 2),
    ]

    const result = await createOpenAI(noNetworkClient()).generate(p, {
      model: 'gpt-transport',
      maxSteps: 3,
      transport: async (params, info) => {
        calls.push({ params, ...info })
        return responses.shift()!
      },
    })

    expect(result.text).toBe('done')
    expect(result.steps).toBe(2)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      stepIndex: 0,
      modelId: 'gpt-transport',
    })
    expect(JSON.stringify(calls[0]!.params)).toContain('"echo"')
    expect(JSON.stringify(calls[1]!.params)).toContain('echo:hello')
    expect(calls.every((call) => call.signal instanceof AbortSignal)).toBe(true)
  })
})

function noNetworkClient(): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error('transport tests must not call the OpenAI client')
        },
        parse: async () => {
          throw new Error('transport tests must not call the OpenAI client')
        },
      },
    },
  } as unknown as OpenAI
}

function openAICompletion(
  emission: {
    readonly text: string
    readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly args: unknown }[]
  },
  sequence: number,
): ChatCompletion {
  const toolCalls = emission.toolCalls?.map((toolCall) => ({
    id: toolCall.id,
    type: 'function' as const,
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.args),
    },
  }))

  return {
    id: `chatcmpl_transport_${sequence}`,
    object: 'chat.completion',
    created: 0,
    model: 'gpt-transport-actual',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: emission.text || null,
          refusal: null,
          ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls && toolCalls.length > 0 ? 'tool_calls' : 'stop',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  } as unknown as ChatCompletion
}
