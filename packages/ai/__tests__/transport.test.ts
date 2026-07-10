import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt } from '@use-crux/core'
import { createCruxAi } from '../src'
import type { SdkGateway } from '../src/gateway'
import { emissionModel } from './mock-model'

describe('AI SDK transport', () => {
  it('runs generate through user-supplied SDK params and results', async () => {
    const model = emissionModel([])
    const p = prompt({
      id: 'ai-sdk-transport-plain',
      system: 'Speak plainly.',
      prompt: ({ input }) => `Say ${input.word}.`,
      input: z.object({ word: z.string() }),
    })
    const calls: Array<{ params: unknown; stepIndex: number; modelId: string; signal: AbortSignal }> = []

    const result = await createCruxAi({ gateway: noNetworkGateway() }).generate(p, {
      model,
      input: { word: 'hello' },
      maxTokens: 64,
      transport: async (params, info) => {
        calls.push({ params, ...info })
        return {
          text: 'hello',
          finishReason: 'stop',
          response: { id: 'ai_transport_1', modelId: 'mock-ai-sdk' },
          usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
          steps: [
            {
              text: 'hello',
              finishReason: 'stop',
              response: { id: 'ai_transport_1', modelId: 'mock-ai-sdk' },
              usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
            },
          ],
        }
      },
    })

    expect(result.text).toBe('hello')
    expect(result.finalStep).toMatchObject({
      text: 'hello',
      responseId: 'ai_transport_1',
      modelId: 'mock-ai-sdk',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      stepIndex: 0,
      params: {
        model,
        system: 'Speak plainly.',
        prompt: 'Say hello.',
        maxOutputTokens: 64,
      },
    })
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal)
  })
})

function noNetworkGateway(): SdkGateway {
  const fail = async () => {
    throw new Error('transport tests must not call the AI SDK gateway')
  }
  return {
    generateText: fail,
    generateObject: fail,
    streamText: fail,
    streamObject: fail,
    embedMany: fail,
    rerank: fail,
  } as unknown as SdkGateway
}
