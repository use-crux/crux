/**
 * Public provider-runtime compiler tests.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineProviderRuntime } from '../../adapter'
import { fakeExecutor } from '../../adapter/testing'
import { prompt as makePrompt } from '../../prompt/prompt'
import type { Message } from '../../generation/messages'
import type { GenerationSettings } from '../../types'

interface RuntimeProviderMessage {
  readonly role: Message['role']
  readonly text: string
}

interface RuntimeRequest {
  readonly model: string
  readonly mode: 'text' | 'structured'
  readonly messages: readonly RuntimeProviderMessage[]
  readonly settings: Record<string, unknown>
}

interface RuntimeRawResponse {
  readonly id: string
  readonly model: string
  readonly text: string
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
  }
}

interface RuntimeStream extends AsyncIterable<{ readonly delta: string }> {
  readonly chunks: readonly string[]
}

interface RuntimeClient {
  readonly calls: RuntimeRequest[]
}

function textPrompt() {
  return makePrompt({
    id: 'provider-runtime-text',
    prompt: ({ input }) => input.instruction,
    input: z.object({ instruction: z.string() }),
  })
}

function streamFrom(chunks: readonly string[]): RuntimeStream {
  return {
    chunks,
    async *[Symbol.asyncIterator]() {
      for (const delta of chunks) {
        yield { delta }
      }
    },
  }
}

describe('provider runtime', () => {
  it('creates a single-turn provider runtime through one public compiler', async () => {
    const provider = defineProviderRuntime({
      id: 'runtime-single-turn',
      ownership: 'single-turn',
      turn: {
        bind: (client: RuntimeClient) => ({
          async call(request, mode) {
            client.calls.push({ ...request, mode })
            return {
              id: 'resp_1',
              model: 'runtime-actual',
              text: 'single-turn text',
              usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
            }
          },
          async stream() {
            return streamFrom(['single', ' turn'])
          },
        }),
        request(args, ctx) {
          return {
            model: args.model,
            mode: ctx.mode,
            messages: args.providerMessages,
            settings: args.settings,
          }
        },
        response: {
          meta: (raw) => ({
            usage: raw.usage,
            responseId: raw.id,
            actualModelId: raw.model,
            finishReason: 'stop',
          }),
        },
        stream: {
          textDelta: (chunk) =>
            typeof chunk === 'object' && chunk !== null && 'delta' in chunk
              ? String((chunk as { readonly delta: unknown }).delta)
              : undefined,
        },
        settings: (settings: GenerationSettings) => ({
          ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
        }),
        transcript: {
          fromMessages: (messages) => messages.map((message) => ({ role: message.role, text: message.content })),
          toMessages: (messages) =>
            messages.flatMap((message) =>
              typeof message === 'object' && message !== null && 'role' in message && 'text' in message
                ? [
                    {
                      role: (message as RuntimeProviderMessage).role,
                      content: (message as RuntimeProviderMessage).text,
                    },
                  ]
                : [],
            ),
          readAssistant: (raw) => ({ text: raw.text }),
        },
      },
    })
    const client: RuntimeClient = { calls: [] }

    const result = await provider.create(client).generate(textPrompt(), {
      model: 'runtime-model',
      input: { instruction: 'Write through the provider runtime' },
      settings: { temperature: 0.2 },
    })

    expect(provider.id).toBe('runtime-single-turn')
    expect(provider.ownership).toBe('single-turn')
    expect(result.text).toBe('single-turn text')
    expect(result._meta.actualModelId).toBe('runtime-actual')
    expect(client.calls).toEqual([
      {
        model: 'runtime-model',
        mode: 'text',
        messages: [{ role: 'user', text: 'Write through the provider runtime' }],
        settings: { temperature: 0.2 },
      },
    ])
  })

  it('creates a loop-owned provider runtime through the same public compiler', async () => {
    const fake = fakeExecutor({ loops: [[{ text: 'loop-owned text' }]] })
    const provider = defineProviderRuntime({
      id: 'runtime-loop-owned',
      ownership: 'loop-owned',
      loop: {
        describeModel: fake.spec.describeModel,
        settings: fake.spec.mapSettings,
        bind: (client) => ({
          run: (request) => fake.spec.runLoop(client, request),
          attemptStructured: (request) => fake.spec.attemptStructured(client, request),
          stream: (request) => fake.spec.runStream(client, request),
          ...(fake.spec.replayStream ? { replayStream: fake.spec.replayStream } : {}),
        }),
      },
    })

    const runtime = provider.create(fake.client)
    const result = await runtime.generate(textPrompt(), {
      model: 'fake:runtime-model',
      input: { instruction: 'Write through the loop-owned runtime' },
      settings: { temperature: 0.1 },
    })

    expect(provider.id).toBe('runtime-loop-owned')
    expect(provider.ownership).toBe('loop-owned')
    expect(runtime.executorId).toBe('runtime-loop-owned')
    expect(result.text).toBe('loop-owned text')
    expect(fake.calls.runLoop[0]?.modelInfo).toEqual({ provider: 'fake', modelId: 'runtime-model' })
    expect(fake.calls.runLoop[0]?.settings).toEqual({ temperature: 0.1 })
  })

  it('rejects provider runtime extensions that replace generated runtime members', () => {
    const fake = fakeExecutor({ loops: [[{ text: 'loop-owned text' }]] })
    const provider = defineProviderRuntime({
      id: 'runtime-collision',
      loop: {
        describeModel: fake.spec.describeModel,
        settings: fake.spec.mapSettings,
        bind: (client) => ({
          run: (request) => fake.spec.runLoop(client, request),
          attemptStructured: (request) => fake.spec.attemptStructured(client, request),
          stream: (request) => fake.spec.runStream(client, request),
          ...(fake.spec.replayStream ? { replayStream: fake.spec.replayStream } : {}),
        }),
      },
      extend: () => ({
        generate() {
          return 'extension generate'
        },
      }),
    })

    expect(() => provider.create(fake.client)).toThrowError(
      'Provider runtime "runtime-collision" extension cannot replace generated runtime key "generate".',
    )
  })

  it('rejects explicit ownership that disagrees with the provided mechanics', () => {
    const fake = fakeExecutor({ loops: [[{ text: 'loop-owned text' }]] })

    expect(() =>
      defineProviderRuntime({
        id: 'runtime-ownership-mismatch',
        ownership: 'single-turn',
        loop: {
          describeModel: fake.spec.describeModel,
          settings: fake.spec.mapSettings,
          bind: (client) => ({
            run: (request) => fake.spec.runLoop(client, request),
            attemptStructured: (request) => fake.spec.attemptStructured(client, request),
            stream: (request) => fake.spec.runStream(client, request),
          }),
        },
      } as never),
    ).toThrowError(
      'Provider runtime "runtime-ownership-mismatch" declares ownership "single-turn" but defines loop-owned mechanics.',
    )
  })
})
