import { describe, expect, it } from 'vitest'
import type { LanguageModel } from 'ai'
import { z } from 'zod'
import type { ExecutorRequest, StructuredRequest } from '@use-crux/core/adapter'
import { createAiSdkCodec } from '../src/sdk-codec'
import { objectGenerationError, scriptedGateway } from './scripted-gateway'

function model(id = 'gpt-4o', provider = 'openai'): LanguageModel {
  return { provider, modelId: id, specificationVersion: 'v3' } as unknown as LanguageModel
}

function loopRequest(overrides: Partial<ExecutorRequest<LanguageModel>> = {}): ExecutorRequest<LanguageModel> {
  return {
    model: model(),
    modelInfo: { provider: 'openai', modelId: 'gpt-4o' },
    system: 'You are terse.',
    systemBlocks: undefined,
    prompt: 'Say hi',
    messages: undefined,
    settings: { temperature: 0.2 },
    tools: undefined,
    activeTools: undefined,
    maxSteps: 10,
    observer: undefined,
    abortSignal: undefined,
    extra: undefined,
    ...overrides,
  }
}

function structuredRequest(
  schema: z.ZodType,
  overrides: Partial<StructuredRequest<LanguageModel>> = {},
): StructuredRequest<LanguageModel> {
  return {
    ...loopRequest({ maxSteps: 1 }),
    schema,
    ...overrides,
  }
}

describe('createAiSdkCodec.loop', () => {
  it('plans generateText args separately from decoding the executor outcome', async () => {
    const scripted = scriptedGateway({
      generateText: [
        {
          text: 'hi there',
          steps: 2,
          usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
          providerMetadata: { openrouter: { usage: { cost: 0.0012 } } },
          responseMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'hi there' }] }],
        },
      ],
    })
    const codec = createAiSdkCodec()

    const call = codec.loop(
      loopRequest({
        tools: { lookup: { description: 'lookup', execute: async () => 'found' } },
        activeTools: ['lookup'],
      }),
    )

    expect(call.method).toBe('generateText')
    expect(call.args).toMatchObject({
      system: 'You are terse.',
      prompt: 'Say hi',
      temperature: 0.2,
      activeTools: ['lookup'],
    })
    expect(call.args.tools).toHaveProperty('lookup')
    expect(call.args.tools).toHaveProperty('__crux_tool_error__')

    const raw = await scripted.gateway[call.method](call.args)
    const outcome = await call.decode(raw)

    expect(outcome).toMatchObject({
      status: 'complete',
      response: {
        text: 'hi there',
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      },
      steps: 2,
      meta: { costUsd: 0.0012 },
    })
    if (outcome.status !== 'complete') throw new Error(`Expected complete outcome, got ${outcome.status}`)
    expect(outcome.messages).toEqual([
      { role: 'user', content: 'Say hi' },
      { role: 'assistant', content: 'hi there' },
    ])
  })
})

describe('createAiSdkCodec.structured', () => {
  it('plans generateObject args and decodes structured validation errors as invalid attempts', async () => {
    const schema = z.object({ title: z.string(), count: z.number() })
    const codec = createAiSdkCodec()

    const call = await codec.structured(structuredRequest(schema))
    const args = call.args as Record<string, unknown>

    expect(call.method).toBe('generateObject')
    expect(args).toMatchObject({
      system: 'You are terse.',
      prompt: 'Say hi',
      temperature: 0.2,
    })
    expect(args.schema).toBe(schema)
    expect(args.experimental_repairText).toBeTypeOf('function')

    const invalid = await call.decodeError(objectGenerationError('{"title":1}'))

    expect(invalid).toMatchObject({
      status: 'invalid',
      rawText: '{"title":1}',
    })
    if (invalid?.status !== 'invalid') throw new Error('Expected invalid structured attempt')
    expect(invalid.error.issues[0]?.message).toContain('response did not match the expected schema')
  })
})

describe('createAiSdkCodec.stream', () => {
  it('plans streamText args and attaches completion metadata to the raw stream result', async () => {
    const scripted = scriptedGateway({
      streamText: [
        {
          chunks: ['hel', 'lo'],
          finish: {
            usage: { inputTokens: 2, outputTokens: 4, totalTokens: 6 },
            providerMetadata: { openrouter: { usage: { cost: 0.0008 } } },
          },
        },
      ],
    })
    const ticks = [100, 130, 160]
    const codec = createAiSdkCodec({ clock: () => ticks.shift() ?? 160 })

    const call = await codec.stream(loopRequest())

    expect(call.method).toBe('streamText')
    if (call.method !== 'streamText') throw new Error(`Expected streamText, got ${call.method}`)
    expect(call.args).toMatchObject({
      system: 'You are terse.',
      prompt: 'Say hi',
      temperature: 0.2,
    })
    expect(call.args.onChunk).toBeTypeOf('function')
    expect(call.args.onFinish).toBeTypeOf('function')

    const handle = call.attach(scripted.gateway.streamText(call.args))
    const meta = await handle.completion()

    expect(meta).toMatchObject({
      text: 'hello',
      usage: { inputTokens: 2, outputTokens: 4, totalTokens: 6 },
      cost: 0.0008,
      streaming: {
        ttftMs: 30,
        tokensPerSecond: 67,
        totalChunks: 2,
      },
    })
    await expect(
      (handle.raw._meta?._streamCompletion as Promise<unknown> | undefined) ?? Promise.reject(),
    ).resolves.toMatchObject({ text: 'hello' })
  })
})
