import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt, tool } from '@use-crux/core'
import { createGoogle } from '../index'

describe('Google transport', () => {
  it('runs generate through user-supplied provider params and responses', async () => {
    const p = prompt({
      id: 'google-transport-tool',
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
      googleResponse(
        {
          text: '',
          toolCalls: [{ id: 'call_echo', name: 'echo', args: { value: 'hello' } }],
        },
        1,
      ),
      googleResponse({ text: 'done' }, 2),
    ]

    const result = await createGoogle(noNetworkClient()).generate(p, {
      model: 'gemini-transport',
      maxSteps: 3,
      transport: async (params, info) => {
        calls.push({ params, ...info })
        return responses.shift()!
      },
    })

    expect(result.text).toBe('done')
    expect(result.steps).toBe(2)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ stepIndex: 0, modelId: 'gemini-transport' })
    expect(JSON.stringify(calls[0]!.params)).toContain('"echo"')
    expect(JSON.stringify(calls[1]!.params)).toContain('echo:hello')
    expect(calls.every((call) => call.signal instanceof AbortSignal)).toBe(true)
  })
})

function noNetworkClient(): GoogleGenAI {
  return {
    models: {
      generateContent: async () => {
        throw new Error('transport tests must not call the Google client')
      },
      generateContentStream: async () => {
        throw new Error('transport tests must not call the Google client')
      },
    },
  } as unknown as GoogleGenAI
}

function googleResponse(
  emission: {
    readonly text: string
    readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly args: unknown }[]
  },
  _sequence: number,
): GenerateContentResponse {
  const functionParts =
    emission.toolCalls?.map((toolCall) => ({
      functionCall: {
        id: toolCall.id,
        name: toolCall.name,
        args: toolInput(toolCall.args),
      },
    })) ?? []

  return {
    text: emission.text,
    modelVersion: 'gemini-transport-actual',
    usageMetadata: {
      promptTokenCount: 2,
      candidatesTokenCount: 3,
      totalTokenCount: 5,
    },
    candidates: [
      {
        content: {
          role: 'model',
          parts: [...(emission.text ? [{ text: emission.text }] : []), ...functionParts],
        },
        finishReason: functionParts.length > 0 ? 'FUNCTION_CALL' : 'STOP',
      },
    ],
  } as GenerateContentResponse
}

function toolInput(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }
}
