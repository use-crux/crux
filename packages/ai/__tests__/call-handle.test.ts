import type { LanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt } from '@use-crux/core'
import { createCruxAi } from '../src'
import type { SdkGateway } from '../src/gateway'
import { emissionModel } from './mock-model'

describe('AI SDK call handle', () => {
  it('prepares SDK params and finishes a plain text result', async () => {
    const ai = createCruxAi({ gateway: noNetworkGateway() })
    const model = emissionModel([])
    const p = prompt({
      id: 'ai-sdk-handle-plain',
      system: 'Speak plainly.',
      prompt: ({ input }) => `Say ${input.word}.`,
      input: z.object({ word: z.string() }),
    })

    const call = await ai.prepare!(p, {
      model,
      input: { word: 'hello' },
      maxTokens: 64,
    })

    expect(call.params).toMatchObject({
      model,
      system: 'Speak plainly.',
      prompt: 'Say hello.',
      maxOutputTokens: 64,
    })

    const result = await call.finish({
      text: 'hello',
      finishReason: 'stop',
      response: { id: 'ai_handle_1', modelId: 'mock-ai-sdk' },
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      steps: [
        {
          text: 'hello',
          finishReason: 'stop',
          response: { id: 'ai_handle_1', modelId: 'mock-ai-sdk' },
          usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        },
      ],
    })

    expect(result.text).toBe('hello')
    expect(result.steps).toHaveLength(1)
    expect(result.finalStep).toMatchObject({
      text: 'hello',
      finishReason: 'stop',
      responseId: 'ai_handle_1',
      modelId: 'mock-ai-sdk',
    })
  })
})

function noNetworkGateway(): SdkGateway {
  const fail = async () => {
    throw new Error('prepare/step tests must not call the AI SDK gateway')
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
