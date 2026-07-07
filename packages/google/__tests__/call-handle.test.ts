import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt, tool } from '@use-crux/core'
import { createGoogle } from '../index'

describe('Google call handle', () => {
  it('prepares params and finishes a plain text response', async () => {
    const google = createGoogle(noNetworkClient())
    const p = prompt({
      id: 'google-handle-plain',
      system: 'Speak plainly.',
      prompt: ({ input }) => `Say ${input.word}.`,
      input: z.object({ word: z.string() }),
    })

    const call = await google.prepare!(p, {
      model: 'gemini-handle',
      input: { word: 'hello' },
      settings: { maxTokens: 64 },
    })

    expect(call.params).toMatchObject({
      model: 'gemini-handle',
      contents: [{ role: 'user', parts: [{ text: 'Say hello.' }] }],
      config: {
        systemInstruction: 'Speak plainly.',
        maxOutputTokens: 64,
      },
    })

    const result = await call.finish(googleResponse({ text: 'hello' }, 1))

    expect(result.text).toBe('hello')
    expect(result.steps).toBe(1)
    expect(result.finalStep).toMatchObject({
      text: 'hello',
      finishReason: 'stop',
      modelId: 'gemini-handle-actual',
    })
  })

  it('advances through a tool loop using the managed tool lifecycle', async () => {
    const google = createGoogle(noNetworkClient())
    const p = prompt({
      id: 'google-handle-tool',
      prompt: 'Use the echo tool.',
      tools: {
        echo: tool({
          description: 'Echo text.',
          input: z.object({ value: z.string() }),
          execute: ({ value }) => `echo:${value}`,
        }),
      },
    })

    const call = await google.prepare!(p, {
      model: 'gemini-handle',
      maxSteps: 3,
    })

    expect(JSON.stringify(call.params)).toContain('"echo"')

    const first = await call.step(
      googleResponse(
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

    const result = await first.next.finish(googleResponse({ text: 'done' }, 2))
    expect(result.text).toBe('done')
    expect(result.steps).toBe(2)
    expect(result.messages.some((message) => message.role === 'tool')).toBe(true)
  })
})

function noNetworkClient(): GoogleGenAI {
  return {
    models: {
      generateContent: async () => {
        throw new Error('prepare/step tests must not call the Google client')
      },
      generateContentStream: async () => {
        throw new Error('prepare/step tests must not call the Google client')
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
    modelVersion: 'gemini-handle-actual',
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
