import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt, tool } from '@use-crux/core'
import { createOpenAI } from '../src'

describe('OpenAI call handle', () => {
  it('prepares params and finishes a plain text response', async () => {
    const openai = createOpenAI(noNetworkClient())
    const p = prompt({
      id: 'openai-handle-plain',
      system: 'Speak plainly.',
      prompt: ({ input }) => `Say ${input.word}.`,
      input: z.object({ word: z.string() }),
    })

    const call = await openai.prepare!(p, {
      model: 'gpt-handle',
      input: { word: 'hello' },
      settings: { maxTokens: 64 },
    })

    expect(call.params).toMatchObject({
      model: 'gpt-handle',
      messages: [
        { role: 'system', content: 'Speak plainly.' },
        { role: 'user', content: 'Say hello.' },
      ],
      max_tokens: 64,
    })

    const result = await call.finish(openAICompletion({ text: 'hello' }, 1))

    expect(result.text).toBe('hello')
    expect(result.steps).toBe(1)
    expect(result.finalStep).toMatchObject({
      text: 'hello',
      finishReason: 'stop',
      responseId: 'chatcmpl_handle_1',
    })
  })

  it('advances through a tool loop using the managed tool lifecycle', async () => {
    const openai = createOpenAI(noNetworkClient())
    const p = prompt({
      id: 'openai-handle-tool',
      prompt: 'Use the echo tool.',
      tools: {
        echo: tool({
          description: 'Echo text.',
          input: z.object({ value: z.string() }),
          execute: ({ value }) => `echo:${value}`,
        }),
      },
    })

    const call = await openai.prepare!(p, {
      model: 'gpt-handle',
      maxSteps: 3,
    })

    expect(JSON.stringify(call.params)).toContain('"echo"')

    const first = await call.step(
      openAICompletion(
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

    const result = await first.next.finish(openAICompletion({ text: 'done' }, 2))
    expect(result.text).toBe('done')
    expect(result.steps).toBe(2)
    expect(result.messages.some((message) => message.role === 'tool')).toBe(true)
  })
})

function noNetworkClient(): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => {
          throw new Error('prepare/step tests must not call the OpenAI client')
        },
        parse: async () => {
          throw new Error('prepare/step tests must not call the OpenAI client')
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
    id: `chatcmpl_handle_${sequence}`,
    object: 'chat.completion',
    created: 0,
    model: 'gpt-handle-actual',
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
