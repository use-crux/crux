/**
 * RFC #61 provider-runtime contract tests.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineProviderRuntime } from '../../adapter'
import type { ExecutorRequest, StructuredRequest } from '../../adapter'
import { prompt as makePrompt } from '../../prompt/prompt'
import type { Message } from '../../generation/messages'
import type { GenerationSettings } from '../../generation/types'

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

interface BoundLoopClient {
  readonly requests: ExecutorRequest<string>[]
}

function textPrompt() {
  return makePrompt({
    id: 'provider-runtime-rfc-text',
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

describe('provider runtime RFC contract', () => {
  it('creates a single-turn provider runtime through the grouped turn contract', async () => {
    const provider = defineProviderRuntime({
      id: 'runtime-turn',
      turn: {
        bind: (client: RuntimeClient) => ({
          async call(request, mode) {
            client.calls.push({ ...request, mode })
            return {
              id: 'resp_turn',
              model: 'runtime-turn-actual',
              text: 'turn text',
              usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
            }
          },
          async runStream() {
            return streamFrom(['turn'])
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
          readAssistant: (raw: RuntimeRawResponse) => ({ text: raw.text }),
        },
      },
    })
    const client: RuntimeClient = { calls: [] }

    const result = await provider.create(client).generate(textPrompt(), {
      model: 'runtime-model',
      input: { instruction: 'Write through the grouped turn contract' },
      settings: { temperature: 0.4 },
    })

    expect(provider.id).toBe('runtime-turn')
    expect(provider.ownership).toBe('single-turn')
    expect(result.text).toBe('turn text')
    expect(result._meta.actualModelId).toBe('runtime-turn-actual')
    expect(client.calls).toEqual([
      {
        model: 'runtime-model',
        mode: 'text',
        messages: [{ role: 'user', text: 'Write through the grouped turn contract' }],
        settings: { temperature: 0.4 },
      },
    ])
  })

  it('creates a loop-owned provider runtime through a bound loop contract', async () => {
    const provider = defineProviderRuntime({
      id: 'runtime-bound-loop',
      loop: {
        describeModel: (model: string) => ({ provider: 'bound', modelId: model }),
        settings: (settings: GenerationSettings) => ({
          ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
        }),
        bind: (client: BoundLoopClient) => ({
          async runTextLoop(request: ExecutorRequest<string>) {
            client.requests.push(request)
            return {
              status: 'complete' as const,
              raw: { text: 'bound raw' },
              response: {
                text: 'bound loop text',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
              },
              messages: [{ role: 'assistant' as const, content: 'bound loop text' }],
              steps: 1,
              meta: { finishReason: 'stop' },
            }
          },
          async runStructuredAttempt(_request: StructuredRequest<string>) {
            return {
              status: 'ok' as const,
              raw: { text: 'structured raw' },
              response: {
                text: '{"ok":true}',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
              },
              object: { ok: true },
            }
          },
          async runStream() {
            return {
              raw: { stream: true },
              completion: async () => ({ finishReason: 'stop' as const, text: 'streamed' }),
            }
          },
        }),
      },
    })
    const client: BoundLoopClient = { requests: [] }

    const result = await provider.create(client).generate(textPrompt(), {
      model: 'runtime-model',
      input: { instruction: 'Write through the bound loop contract' },
      settings: { temperature: 0.7 },
    })

    expect(provider.id).toBe('runtime-bound-loop')
    expect(provider.ownership).toBe('loop-owned')
    expect(result.text).toBe('bound loop text')
    expect(client.requests[0]?.modelInfo).toEqual({ provider: 'bound', modelId: 'runtime-model' })
    expect(client.requests[0]?.settings).toEqual({ temperature: 0.7 })
  })
})
