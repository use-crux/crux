/**
 * Public profile compiler tests for adapter authoring.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineAdapterProfile, nativeChat, sdkLoop } from '../../adapter/profile'
import { fakeExecutor } from '../../adapter/testing'
import { prompt as makePrompt } from '../../define'
import type { Message } from '../../messages'
import type { GenerationSettings } from '../../types'

interface ProfileProviderMessage {
  readonly role: Message['role']
  readonly text: string
}

interface ProfileRequest {
  readonly model: string
  readonly mode: 'text' | 'structured'
  readonly messages: readonly ProfileProviderMessage[]
  readonly settings: Record<string, unknown>
}

interface ProfileRawResponse {
  readonly id: string
  readonly model: string
  readonly text: string
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
  }
}

interface ProfileStream extends AsyncIterable<{ readonly delta: string }> {
  readonly chunks: readonly string[]
}

interface ProfileClient {
  readonly calls: ProfileRequest[]
}

function textPrompt() {
  return makePrompt({
    id: 'profile-text',
    prompt: ({ input }) => (input as { instruction: string }).instruction,
    input: z.object({ instruction: z.string() }),
  })
}

function streamFrom(chunks: readonly string[]): ProfileStream {
  return {
    chunks,
    async *[Symbol.asyncIterator]() {
      for (const delta of chunks) {
        yield { delta }
      }
    },
  }
}

describe('adapter profiles', () => {
  it('creates a native-chat runtime through the public profile compiler', async () => {
    const driver = nativeChat<
      ProfileClient,
      ProfileRequest,
      ProfileRawResponse,
      ProfileStream,
      Record<string, never>,
      Record<string, never>,
      ProfileProviderMessage
    >({
      bind: (client) => ({
        async call(request, mode) {
          client.calls.push({ ...request, mode })
          return {
            id: 'resp_1',
            model: 'profile-actual',
            text: 'profile text',
            usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
          }
        },
        async stream() {
          return streamFrom(['profile', ' stream'])
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
                    role: (message as ProfileProviderMessage).role,
                    content: (message as ProfileProviderMessage).text,
                  },
                ]
              : [],
          ),
        readAssistant: (raw) => ({ text: raw.text }),
      },
    })
    const profile = defineAdapterProfile({
      id: 'profile-native',
      driver,
    })
    const client: ProfileClient = { calls: [] }

    const result = await profile.create(client).generate(textPrompt(), {
      model: 'profile-model',
      input: { instruction: 'Write with the profile' },
      settings: { temperature: 0.2 },
    })

    expect(profile.id).toBe('profile-native')
    expect(result.text).toBe('profile text')
    expect(result._meta.actualModelId).toBe('profile-actual')
    expect(client.calls).toEqual([
      {
        model: 'profile-model',
        mode: 'text',
        messages: [{ role: 'user', text: 'Write with the profile' }],
        settings: { temperature: 0.2 },
      },
    ])

    const helperClient: ProfileClient = { calls: [] }
    const generateText = driver.helpers('profile-native').createGenerateTextFn(helperClient, 'helper-model')
    await expect(generateText({ model: 'ignored-by-helper', prompt: 'Helper prompt' })).resolves.toEqual({
      text: 'profile text',
    })
    expect(helperClient.calls).toEqual([
      {
        model: 'helper-model',
        mode: 'text',
        messages: [{ role: 'user', text: 'Helper prompt' }],
        settings: {},
      },
    ])
  })

  it('creates an SDK-loop runtime through the public profile compiler', async () => {
    const fake = fakeExecutor({ loops: [[{ text: 'sdk profile text' }]] })
    const profile = defineAdapterProfile({
      id: 'profile-sdk',
      describeModel: fake.spec.describeModel,
      driver: sdkLoop({
        settings: fake.spec.mapSettings,
        runLoop: fake.spec.runLoop,
        attemptStructured: fake.spec.attemptStructured,
        runStream: fake.spec.runStream,
        replayStream: fake.spec.replayStream,
      }),
    })

    const runtime = profile.create(fake.client)
    const result = await runtime.generate(textPrompt(), {
      model: 'fake:m-1',
      input: { instruction: 'Write with the SDK loop profile' },
      settings: { temperature: 0.1 },
    })

    expect(runtime.executorId).toBe('profile-sdk')
    expect(result.text).toBe('sdk profile text')
    expect(fake.calls.runLoop[0]?.modelInfo).toEqual({ provider: 'fake', modelId: 'm-1' })
    expect(fake.calls.runLoop[0]?.settings).toEqual({ temperature: 0.1 })
  })
})
