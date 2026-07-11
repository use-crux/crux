import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { convertToModelMessages, type LanguageModel, type ModelMessage, type UIMessage } from 'ai'
import { isUnsupportedCapabilityError, prompt } from '@use-crux/core'
import { mediaConformanceFixture } from '@use-crux/core/adapter/testing'
import { createCruxAi, createUIMessageStreamResponse } from '../src'
import { scriptedGateway } from './scripted-gateway'

function model(id = 'gpt-4o', provider = 'openai'): LanguageModel {
  return { provider, modelId: id, specificationVersion: 'v3' } as unknown as LanguageModel
}

const textPrompt = prompt({
  id: 'ai-native-model-messages',
  prompt: ({ input }) => input.message,
  input: z.object({ message: z.string() }),
})

describe('AI SDK native ModelMessage input', () => {
  it('preserves native image data instead of decoding it through Crux content', async () => {
    const scripted = scriptedGateway({ generateText: [{ text: 'ok' }] })

    await createCruxAi({ gateway: scripted.gateway }).generate(textPrompt, {
      model: model(),
      input: { message: 'ignored when messages are provided' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look.' },
            { type: 'image', image: 'AQID', mediaType: 'image/png' },
          ],
        },
      ] satisfies readonly ModelMessage[],
    })

    expect(scripted.calls.generateText[0]!.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Look.' },
          { type: 'image', image: 'AQID', mediaType: 'image/png' },
        ],
      },
    ])
  })

  it('keeps the standard useChat attachment and UI response path', async () => {
    const scripted = scriptedGateway({ streamText: [{ chunks: ['ok'] }] })
    const uiMessages = [
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'Describe this attachment.' },
          {
            type: 'file',
            url: 'data:application/pdf;base64,JVBERi0x',
            mediaType: 'application/pdf',
            filename: 'report.pdf',
            providerMetadata: { openai: { fileId: 'file_123' } },
          },
        ],
      },
    ] satisfies Array<Omit<UIMessage, 'id'>>
    const modelMessages = await convertToModelMessages(uiMessages)

    const result = await createCruxAi({ gateway: scripted.gateway }).stream(textPrompt, {
      model: model(),
      input: { message: 'ignored when messages are provided' },
      messages: modelMessages,
    })

    expect(scripted.calls.streamText[0]!.messages).toEqual(modelMessages)
    expect(createUIMessageStreamResponse(result).status).toBe(200)
  })

  it('preserves native file data and provider options during generate calls', async () => {
    const scripted = scriptedGateway({ generateText: [{ text: 'ok' }] })
    const modelMessages = [
      {
        role: 'user',
        content: [
          { type: 'file', data: new Uint8Array([1, 2, 3]), mediaType: 'application/pdf', filename: 'report.pdf' },
          {
            type: 'image',
            image: new URL('https://example.com/chart.png'),
            mediaType: 'image/png',
            providerOptions: { openai: { detail: 'low' } },
          },
        ],
        providerOptions: { openai: { store: false } },
      },
    ] satisfies readonly ModelMessage[]

    await createCruxAi({ gateway: scripted.gateway }).generate(textPrompt, {
      model: model(),
      input: { message: 'ignored when messages are provided' },
      messages: modelMessages,
    })

    expect(scripted.calls.generateText[0]!.messages).toEqual(modelMessages)
  })

  it('rejects known text-only models before gateway I/O but defers unknown custom models', async () => {
    const fixture = mediaConformanceFixture('ai-sdk')
    const scripted = scriptedGateway({ generateText: [{ text: 'ok' }] })
    const messages = [...fixture.knownUnsupported]
    const ai = createCruxAi({ gateway: scripted.gateway })

    await expect(
      ai.generate(textPrompt, {
        model: model('gpt-3.5-turbo'),
        input: { message: 'inspect' },
        messages,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isUnsupportedCapabilityError(error)).toBe(true)
      expect(error).toMatchObject({
        adapter: 'ai-sdk',
        model: 'gpt-3.5-turbo',
        capability: 'input.image',
        path: 'messages[0].content[0].source',
      })
      expect(String(error)).not.toContain('private.png')
      return true
    })
    expect(scripted.calls.generateText).toHaveLength(0)

    await ai.generate(textPrompt, {
      model: model(fixture.unknownModel, 'custom-provider'),
      input: { message: 'inspect' },
      messages,
    })
    expect(scripted.calls.generateText).toHaveLength(1)
  })
})
