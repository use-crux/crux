/** Public lightweight helper behavior compiled by the native-chat profile. */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineNativeChatProvider } from '../../src/adapter/native-chat'
import { CruxUnsupportedStructuredOutputError } from '../../src/adapter/structured-output'
import {
  bindNativeTest,
  nativeTestProfile,
  streamFrom,
  type NativeTestClient,
} from './native-chat-fixtures'

describe('native-chat helpers', () => {
  it('creates lightweight helpers from the same profile request path', async () => {
    const helpers = nativeTestProfile.helpers(bindNativeTest)
    const textClient: NativeTestClient = {
      script: { emissions: [{ text: 'helper text' }] },
      calls: [],
      streams: [],
    }
    const generateText = helpers.createGenerateTextFn(textClient, 'native-test-model')

    await expect(
      generateText({ model: 'ignored-by-bound-helper', system: 'System', prompt: 'Write text' }),
    ).resolves.toEqual({ text: 'helper text' })
    expect(textClient.calls[0]).toMatchObject({
      mode: 'text',
      model: 'native-test-model',
      system: 'System',
      messages: [{ role: 'user', text: 'Write text' }],
    })
    await generateText({
      model: 'ignored-by-bound-helper',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', source: new Uint8Array([1]), mediaType: 'image/png' }],
        },
      ],
      maxOutputTokens: 1000,
    })
    expect(textClient.calls[1]).toMatchObject({
      mode: 'text',
      settings: { maxTokens: 1000 },
      messages: [{ role: 'user', text: [{ type: 'image' }] }],
    })

    const objectClient: NativeTestClient = {
      script: {
        structuredTexts: ['{"ok":true}', '{"ok":false}', '{"ok":true}'],
      },
      calls: [],
      streams: [],
    }
    const generateObject = helpers.createGenerateObjectFn(objectClient)

    await expect(
      generateObject({
        model: 'native-object-one',
        prompt: 'Write JSON',
        schema: z.object({ ok: z.boolean() }),
        temperature: 0,
        topP: 0.8,
      }),
    ).resolves.toEqual({ object: { ok: true } })
    await expect(
      generateObject({
        model: 'native-object-two',
        messages: [
          { role: 'system', content: 'Classify the next part.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this image.' },
              {
                type: 'image',
                source: new Uint8Array([1, 2, 3]),
                mediaType: 'image/png',
              },
            ],
          },
        ],
        schema: z.object({ ok: z.boolean() }),
      }),
    ).resolves.toEqual({ object: { ok: false } })
    await generateObject({
      model: '  native-object-three  ',
      prompt: 'Preserve the exact model string',
      schema: z.object({ ok: z.boolean() }),
    })
    expect(objectClient.calls[0]).toMatchObject({
      mode: 'structured',
      model: 'native-object-one',
      messages: [{ role: 'user', text: 'Write JSON' }],
      settings: { temperature: 0, top_p: 0.8 },
    })
    expect(objectClient.calls[1]).toMatchObject({
      mode: 'structured',
      model: 'native-object-two',
      messages: [
        { role: 'system', text: 'Classify the next part.' },
        {
          role: 'user',
          text: [
            { type: 'text', text: 'Inspect this image.' },
            { type: 'image', mediaType: 'image/png' },
          ],
        },
      ],
    })
    expect(objectClient.calls[2]?.model).toBe('  native-object-three  ')
    expect(objectClient.calls[0]?.outputSchema).toMatchObject({ type: 'object' })
  })

  it('lets helper provider errors surface unchanged', async () => {
    const providerError = new Error('provider unavailable')
    const helpers = nativeTestProfile.helpers<NativeTestClient>(() => ({
      call: async () => {
        throw providerError
      },
      stream: async () => streamFrom([]),
    }))
    const generateText = helpers.createGenerateTextFn(
      { script: {}, calls: [], streams: [] },
      'native-test-model',
    )

    await expect(generateText({ model: 'ignored', prompt: 'Write text' })).rejects.toBe(providerError)

    const generateObject = helpers.createGenerateObjectFn({
      script: {},
      calls: [],
      streams: [],
    })
    await expect(
      generateObject({
        model: 'native-object',
        prompt: 'Write JSON',
        schema: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toBe(providerError)
  })

  it('rejects unusable object models before binding a client or building a request', async () => {
    let bindCount = 0
    let requestCount = 0
    const observedProfile = defineNativeChatProvider({
      ...nativeTestProfile.profile,
      request(args, context) {
        requestCount += 1
        return nativeTestProfile.profile.request(args, context)
      },
    })
    const helpers = observedProfile.helpers((client: NativeTestClient) => {
      bindCount += 1
      return bindNativeTest(client)
    })
    const client: NativeTestClient = { script: {}, calls: [], streams: [] }
    const generateObject = helpers.createGenerateObjectFn(client)
    const invalidModels: readonly unknown[] = [undefined, {}, '', ' \t ']

    for (const model of invalidModels) {
      await expect(
        generateObject({
          model,
          prompt: 'Write JSON',
          schema: z.object({ ok: z.boolean() }),
        }),
      ).rejects.toThrow(
        new TypeError(
          'Native structured generation requires `options.model` to be a non-empty string.',
        ),
      )
    }

    expect(bindCount).toBe(0)
    expect(requestCount).toBe(0)
    expect(client.calls).toEqual([])
  })

  it('keeps structured-output capability failures distinct from provider calls', async () => {
    const unsupportedProfile = defineNativeChatProvider({
      ...nativeTestProfile.profile,
      structuredOutput: undefined,
    })
    let bindCount = 0
    const helpers = unsupportedProfile.helpers((client: NativeTestClient) => {
      bindCount += 1
      return bindNativeTest(client)
    })
    const client: NativeTestClient = { script: {}, calls: [], streams: [] }
    const generateObject = helpers.createGenerateObjectFn(client)

    await expect(
      generateObject({
        model: 'native-object',
        prompt: 'Write JSON',
        schema: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toBeInstanceOf(CruxUnsupportedStructuredOutputError)
    expect(bindCount).toBe(0)
    expect(client.calls).toEqual([])
  })

  it('lets object helpers consume provider-native parsed structured output', async () => {
    const helpers = nativeTestProfile.helpers<NativeTestClient>(() => ({
      call: async () => ({
        id: 'native_resp_structured',
        model: 'native-test-actual',
        text: 'not-json',
        structuredObject: { ok: true },
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          inputTokenDetails: {},
          outputTokenDetails: {},
        },
        finishReason: 'stop',
      }),
      stream: async () => streamFrom([]),
    }))
    const generateObject = helpers.createGenerateObjectFn({
      script: {},
      calls: [],
      streams: [],
    })

    await expect(
      generateObject({
        model: 'native-object',
        prompt: 'Write JSON',
        schema: z.object({ ok: z.boolean() }),
      }),
    ).resolves.toEqual({ object: { ok: true } })
  })
})
