import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { prompt, tool } from '@use-crux/core'
import { createGoogle } from '../src'

describe('Google managed/headless/transport equivalence', () => {
  it('matches managed generate for plain text', async () => {
    const p = prompt({
      id: 'google-equivalence-plain',
      prompt: ({ input }) => `Say ${input.word}.`,
      input: z.object({ word: z.string() }),
    })
    const responses = [googleResponse({ text: 'hello' }, 1)]
    const options = { model: 'gemini-equivalence', input: { word: 'hello' } } as const

    const managed = await createGoogle(scriptedClient(responses)).generate(p, options)
    const headless = await runHandle(p, responses, options)
    const transported = await runTransport(p, responses, options)

    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
  })

  it('matches managed generate for tool loops', async () => {
    const p = prompt({
      id: 'google-equivalence-tools',
      prompt: 'Use the echo tool.',
      tools: {
        echo: tool({
          description: 'Echo a value.',
          input: z.object({ value: z.string() }),
          execute: ({ value }) => `echo:${value}`,
        }),
      },
    })
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
    const options = { model: 'gemini-equivalence', maxSteps: 3 } as const

    const managed = await createGoogle(scriptedClient(responses)).generate(p, options)
    const headless = await runHandle(p, responses, options)
    const transported = await runTransport(p, responses, options)

    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
  })

  it('matches managed generate for structured validation retry', async () => {
    const p = prompt({
      id: 'google-equivalence-validation',
      prompt: 'Return JSON.',
      output: z.object({ ok: z.boolean() }),
    })
    const responses = [
      googleResponse({ text: '{"ok":"no"}' }, 1),
      googleResponse({ text: '{"ok":true}' }, 2),
    ]
    const options = {
      model: 'gemini-equivalence',
      validationRetry: { maxRetries: 1 },
    } as const

    const managed = await createGoogle(scriptedClient(responses)).generate(p, options)
    const headless = await runHandle(p, responses, options)
    const transported = await runTransport(p, responses, options)

    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
    expect(headless.object).toEqual({ ok: true })
    expect(transported.object).toEqual({ ok: true })
  })

  it('matches managed generate for approval suspension', async () => {
    const p = prompt({
      id: 'google-equivalence-approval',
      prompt: 'Use the guarded tool.',
      tools: {
        guarded: tool({
          description: 'Guarded tool.',
          input: z.object({ value: z.string().optional() }),
          execute: () => 'should-not-run',
        }),
      },
    })
    const responses = [
      googleResponse(
        {
          text: 'approval needed',
          toolCalls: [{ id: 'call_guarded', name: 'guarded', args: {} }],
        },
        1,
      ),
    ]
    const options = {
      model: 'gemini-equivalence',
      toolApproval: { guarded: 'always' },
    } as const

    const managed = await createGoogle(scriptedClient(responses)).generate(p, options)
    const headless = await runHandle(p, responses, options)
    const transported = await runTransport(p, responses, options)

    expect(headless.pendingApprovals?.length).toBe(1)
    expect(transported.pendingApprovals?.length).toBe(1)
    expect(expectComparable(headless)).toEqual(expectComparable(managed))
    expect(expectComparable(transported)).toEqual(expectComparable(managed))
  })
})

async function runHandle(
  p: Parameters<ReturnType<typeof createGoogle>['generate']>[0],
  responses: readonly GenerateContentResponse[],
  options: Parameters<ReturnType<typeof createGoogle>['generate']>[1],
) {
  let handle = await createGoogle(noNetworkClient()).prepare!(p, options)
  for (let index = 0; index < responses.length; index++) {
    const outcome = await handle.step(responses[index]!)
    if (outcome.done) return outcome.result
    handle = outcome.next
  }
  throw new Error('handle did not complete after scripted responses')
}

async function runTransport(
  p: Parameters<ReturnType<typeof createGoogle>['generate']>[0],
  responses: readonly GenerateContentResponse[],
  options: Parameters<ReturnType<typeof createGoogle>['generate']>[1],
) {
  const queue = [...responses]
  return createGoogle(noNetworkClient()).generate(p, {
    ...options,
    transport: async () => next(queue),
  })
}

function expectComparable(result: {
  readonly text: string
  readonly object?: unknown
  readonly usage?: unknown
  readonly steps: readonly unknown[]
  readonly finalStep: unknown
  readonly messages: readonly { readonly role: string }[]
  readonly pendingApprovals?: readonly unknown[]
}) {
  return {
    text: result.text,
    object: result.object,
    usage: result.usage,
    steps: result.steps,
    finalStep: result.finalStep,
    roles: result.messages.map((message) => message.role),
    pendingApprovals: result.pendingApprovals?.length ?? 0,
  }
}

function scriptedClient(responses: readonly GenerateContentResponse[]): GoogleGenAI {
  const queue = [...responses]
  return {
    models: {
      generateContent: async () => next(queue),
      generateContentStream: async () => {
        throw new Error('streaming is not used in handle equivalence tests')
      },
    },
  } as unknown as GoogleGenAI
}

function noNetworkClient(): GoogleGenAI {
  return scriptedClient([])
}

function next(queue: GenerateContentResponse[]): GenerateContentResponse {
  const response = queue.shift()
  if (!response) throw new Error('script exhausted')
  return response
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
    modelVersion: 'gemini-equivalence-actual',
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
