/**
 * End-to-end coverage for normalized-outcome mapping through the real
 * `createCruxAi()` surface, via `scriptedGateway` (no `vi.mock('ai')`):
 *
 * - generate() finish-reason mapping for varieties beyond "stop"
 * - generate() provider-error normalization (`runTextLoop` → `CruxAdapterError`)
 * - stream() completion finish-reason mapping
 * - stream() mid-stream failure normalization, from both textStream iteration
 *   and the completion promise
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { fallback, prompt as makePrompt } from '@use-crux/core'
import { CruxAdapterError, isCruxAdapterError } from '@use-crux/core/adapter'
import type { CruxFinishReason } from '@use-crux/core/adapter'
import {
  describeNormalizedOutcomeBehavior,
  type NormalizedErrorSnapshot,
  type NormalizedOutcomeBehavioralHarness,
  type NormalizedResultSnapshot,
  type NormalizedStreamErrorSnapshot,
} from '@use-crux/core/adapter/testing'
import type { LanguageModel } from 'ai'
import { createCruxAi } from '../src'
import { scriptedGateway } from './scripted-gateway'

function model(id = 'gpt-4o', provider = 'openai'): LanguageModel {
  return { provider, modelId: id, specificationVersion: 'v3' } as unknown as LanguageModel
}

const textPrompt = makePrompt({
  id: 'normalized-outcome-integration',
  prompt: ({ input }) => (input as { message: string }).message,
  input: z.object({ message: z.string() }),
})

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    throw new Error('expected the call to reject')
  } catch (error) {
    return error
  }
}

/** Project a rejecting promise into the provider-neutral normalized-error shape. */
async function errorSnapshot(promise: Promise<unknown>): Promise<NormalizedErrorSnapshot> {
  const error = await captureError(promise)
  if (!isCruxAdapterError(error)) throw error
  return { kind: error.providerError.kind, retryable: error.providerError.retryable }
}

/**
 * The AI SDK behavioral harness. The SDK exposes a content-filter finish reason
 * but no distinct refusal signal, so the harness supplies `contentFilter` and
 * omits `refusal`. Stream scenarios route through a single-tier `fallback()` so
 * `completion` awaits stream exhaustion (the routed-model pattern), which is
 * what makes a mid-stream failure surface on both iteration and completion.
 */
function aiBehavioralHarness(): NormalizedOutcomeBehavioralHarness {
  const generateFinish = async (finishReason: string): Promise<NormalizedResultSnapshot> => {
    const scripted = scriptedGateway({ generateText: [{ text: 'hi', finishReason }] })
    const ai = createCruxAi({ gateway: scripted.gateway })
    const result = await ai.generate(textPrompt, { model: model(), input: { message: 'go' } })
    return { finishReason: result.finalStep.finishReason as CruxFinishReason }
  }

  const generateError = (error: Error): Promise<NormalizedErrorSnapshot> => {
    const scripted = scriptedGateway({ generateText: [error] })
    const ai = createCruxAi({ gateway: scripted.gateway })
    return errorSnapshot(ai.generate(textPrompt, { model: model(), input: { message: 'go' } }))
  }

  return {
    generateSuccess: () => generateFinish('stop'),
    streamCompletedToolCall: async (): Promise<NormalizedResultSnapshot> => {
      const scripted = scriptedGateway({
        streamText: [
          {
            chunks: ['Looking'],
            finish: {
              finishReason: 'tool-calls',
              toolCalls: [{ toolCallId: 'call_1', toolName: 'lookup', input: { q: 'x' } }],
            },
          },
        ],
      })
      const ai = createCruxAi({ gateway: scripted.gateway })
      const result = await ai.stream(textPrompt, {
        model: fallback([model('primary'), model('backup')]),
        input: { message: 'go' },
      })
      for await (const _ of result.textStream) void _
      const completion = await result.completion
      return {
        finishReason: completion.finalStep.finishReason as CruxFinishReason,
        toolCalls: completion.finalStep.toolCalls,
      }
    },
    contentFilter: () => generateFinish('content-filter'),
    timeout: () => generateError(Object.assign(new Error('too slow'), { name: 'AI_TimeoutError' })),
    userAbort: () => generateError(Object.assign(new Error('user aborted'), { name: 'AI_AbortError' })),
    erroringStream: async (): Promise<NormalizedStreamErrorSnapshot> => {
      const scripted = scriptedGateway({
        streamText: [
          {
            chunks: ['partial'],
            errorAfterChunks: Object.assign(new Error('connection reset'), { statusCode: 503 }),
          },
        ],
      })
      const ai = createCruxAi({ gateway: scripted.gateway })
      const result = await ai.stream(textPrompt, {
        model: fallback([model('primary'), model('backup')]),
        input: { message: 'go' },
      })
      const iteration = await errorSnapshot(
        (async () => {
          for await (const _ of result.textStream) void _
        })(),
      )
      const completion = await errorSnapshot(result.completion)
      return { iteration, completion }
    },
  }
}

describeNormalizedOutcomeBehavior({ name: 'ai-sdk', harness: aiBehavioralHarness() })

describe('generate() finish-reason mapping', () => {
  const cases: Array<[string, string]> = [
    ['stop', 'stop'],
    ['length', 'length'],
    ['tool-calls', 'tool-calls'],
    ['content-filter', 'content-filter'],
    ['other', 'unknown'],
  ]
  for (const [raw, expected] of cases) {
    it(`maps a generateText finishReason of "${raw}" to "${expected}"`, async () => {
      const scripted = scriptedGateway({ generateText: [{ text: 'hi', finishReason: raw }] })
      const ai = createCruxAi({ gateway: scripted.gateway })

      const result = await ai.generate(textPrompt, { model: model(), input: { message: 'go' } })
      expect(result.finalStep.finishReason).toBe(expected)
    })
  }
})

describe('generate() provider-error normalization', () => {
  it('normalizes a rate-limited generateText failure into a CruxAdapterError', async () => {
    const scripted = scriptedGateway({
      generateText: [Object.assign(new Error('rate limited'), { statusCode: 429 })],
    })
    const ai = createCruxAi({ gateway: scripted.gateway })

    const error = await captureError(
      ai.generate(textPrompt, { model: model(), input: { message: 'go' } }),
    )
    expect(isCruxAdapterError(error)).toBe(true)
    expect((error as CruxAdapterError).providerError).toMatchObject({
      kind: 'rate-limit',
      code: 'ai-sdk.rate_limit',
      retryable: true,
    })
  })

  it('normalizes an aborted generateText failure into a non-retryable aborted error', async () => {
    const scripted = scriptedGateway({
      generateText: [Object.assign(new Error('user aborted'), { name: 'AI_AbortError' })],
    })
    const ai = createCruxAi({ gateway: scripted.gateway })

    const error = await captureError(
      ai.generate(textPrompt, { model: model(), input: { message: 'go' } }),
    )
    expect(isCruxAdapterError(error)).toBe(true)
    expect((error as CruxAdapterError).providerError).toMatchObject({
      kind: 'aborted',
      code: 'ai-sdk.aborted',
      retryable: false,
    })
  })
})

describe('stream() completion finish-reason mapping', () => {
  it('maps a streamed finishReason of "length" to "length"', async () => {
    const scripted = scriptedGateway({
      streamText: [{ chunks: ['hi'], finish: { finishReason: 'length' } }],
    })
    const ai = createCruxAi({ gateway: scripted.gateway })

    const result = await ai.stream(textPrompt, { model: model(), input: { message: 'go' } })
    for await (const _ of result.textStream) void _
    const completion = await result.completion

    expect(completion.finalStep.finishReason).toBe('length')
  })
})

describe('stream() mid-stream failure normalization', () => {
  it('surfaces a normalized CruxAdapterError from both iteration and completion', async () => {
    const scripted = scriptedGateway({
      streamText: [
        {
          chunks: ['partial'],
          errorAfterChunks: Object.assign(new Error('connection reset'), { statusCode: 503 }),
        },
      ],
    })
    const ai = createCruxAi({ gateway: scripted.gateway })

    // A single-tier `fallback()` gives the stream a routing receipt, which is
    // what makes `completion` await stream exhaustion instead of the raw SDK
    // `onFinish` callback (mirrors the routed-model pattern already used by
    // the mid-stream-failure tests in executor-mapping.test.ts).
    const result = await ai.stream(textPrompt, {
      model: fallback([model('primary'), model('backup')]),
      input: { message: 'go' },
    })

    const drain = (async () => {
      const chunks: string[] = []
      for await (const delta of result.textStream) chunks.push(delta)
      return chunks
    })()

    const iterationError = await captureError(drain)
    expect(isCruxAdapterError(iterationError)).toBe(true)
    expect((iterationError as CruxAdapterError).providerError).toMatchObject({
      kind: 'provider-error',
      code: 'ai-sdk.server_error',
      retryable: true,
    })

    const completionError = await captureError(result.completion)
    expect(isCruxAdapterError(completionError)).toBe(true)
    expect((completionError as CruxAdapterError).providerError).toMatchObject({
      kind: 'provider-error',
      code: 'ai-sdk.server_error',
      retryable: true,
    })
  })
})
