import { describe, expect, it } from 'vitest'
import type { Content, GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import { adapterSpecConformance, transcriptCodecConformance } from '@crux/core/adapter/testing'
import type {
  AdapterConformanceHarness,
  AdapterConformanceInspector,
  AdapterConformanceScript,
} from '@crux/core/adapter/testing'
import type { CallArgs, ToolResultEntry } from '@crux/core/adapter'
import type { Message, SystemBlock } from '@crux/core'
import { buildGoogleSpec, fromMessages, googleTranscript, toMessages } from '../index'
import type { GoogleExtra } from '../index'
import { GoogleCacheManager } from '../cache-manager'
import { CACHE_DEFAULTS } from '../cache-types'

interface GoogleFakeRequest {
  readonly model: unknown
  readonly contents?: unknown
  readonly config?: Record<string, unknown>
  readonly [key: string]: unknown
}

interface GoogleFakeClient {
  readonly calls: GoogleFakeRequest[]
  readonly script: AdapterConformanceScript
  readonly client: GoogleGenAI
  readonly cacheCreates: unknown[]
}

describe('Google AdapterSpec conformance', () => {
  it('conforms to the native adapter contract', async () => {
    const spec = buildGoogleSpec()
    const harness: AdapterConformanceHarness<
      GoogleGenAI,
      GenerateContentResponse,
      AsyncIterable<GenerateContentResponse>,
      GoogleExtra
    > = {
      capabilities: { actualModelId: 'required' },
      prepare: (script) => {
        const fake = createGoogleFake(script)
        return { client: fake.client, model: 'gemini-2.5-flash', inspect: inspectorFor(fake) }
      },
    }

    const violations = await adapterSpecConformance(spec, harness)

    expect(violations).toEqual([])
  })

  it('serializes functionCall and functionResponse parts in the second call payload', async () => {
    const spec = buildGoogleSpec()
    const fake = createGoogleFake({
      emissions: [
        { text: '', toolCalls: [{ id: 'ignored-by-google', name: 'weather', args: { city: 'Paris' } }] },
        { text: 'Weather recorded.' },
      ],
    })

    const first = await spec.call(fake.client, callArgs())
    const toolCallId = first.extracted.toolCalls?.[0]?.id ?? 'tc_0'
    const messages = spec.appendToolRound([...BASE_MESSAGES], first.extracted, [weatherResult(toolCallId)])

    await spec.call(fake.client, callArgs({ messages }))

    expect(fake.calls[1]?.contents).toEqual([
      { role: 'user', parts: [{ text: 'Weather in Paris?' }] },
      {
        role: 'model',
        parts: [{ functionCall: { id: 'tc_0', name: 'weather', args: { city: 'Paris' } } }],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'tc_0',
              name: 'weather',
              response: { output: '18 C and cloudy' },
            },
          },
        ],
      },
    ])
  })

  it('public fromMessages serializes assistant functionCall parts', () => {
    const contents = fromMessages([
      {
        role: 'assistant',
        content: '',
        metadata: { toolCalls: [{ id: 'tc_0', name: 'weather', args: { city: 'Paris' } }] },
      },
    ])

    expect(contents).toEqual([
      {
        role: 'model',
        parts: [{ functionCall: { id: 'tc_0', name: 'weather', args: { city: 'Paris' } } }],
      },
    ])
  })

  it('public toMessages reads model functionCall parts', () => {
    const messages = toMessages([
      {
        role: 'model',
        parts: [{ functionCall: { id: 'tc_0', name: 'weather', args: { city: 'Paris' } } }],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'tc_0',
              name: 'weather',
              response: { output: '18 C and cloudy' },
            },
          },
        ],
      },
    ])

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: '',
        metadata: { toolCalls: [{ id: 'tc_0', name: 'weather', args: { city: 'Paris' } }] },
      },
      {
        role: 'tool',
        content: '{"output":"18 C and cloudy"}',
        metadata: { toolCallId: 'tc_0', toolName: 'weather' },
      },
    ])
  })

  it('keeps Google transcript wrappers and assistant extraction behind one codec', () => {
    const canonicalMessages: Message[] = [
      { role: 'user', content: 'Weather in Paris?' },
      {
        role: 'assistant',
        content: '',
        metadata: { toolCalls: [{ id: 'tc_0', name: 'weather', args: { city: 'Paris' } }] },
      },
      {
        role: 'tool',
        content: '18 C and cloudy',
        metadata: { toolCallId: 'tc_0', toolName: 'weather' },
      },
    ]
    const providerMessages: Content[] = [
      { role: 'user', parts: [{ text: 'Weather in Paris?' }] },
      { role: 'model', parts: [{ functionCall: { id: 'tc_0', name: 'weather', args: { city: 'Paris' } } }] },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'tc_0',
              name: 'weather',
              response: { output: '18 C and cloudy' },
            },
          },
        ],
      },
    ]

    expect(
      transcriptCodecConformance({
        name: 'google transcript',
        transcript: googleTranscript,
        canonicalMessages,
        providerMessages,
        decodedMessages: [
          canonicalMessages[0]!,
          canonicalMessages[1]!,
          {
            role: 'tool',
            content: '{"output":"18 C and cloudy"}',
            metadata: { toolCallId: 'tc_0', toolName: 'weather' },
          },
        ],
        rawAssistant: googleResponse({
          text: 'I will check.',
          toolCalls: [{ name: 'weather', args: { city: 'Paris' } }],
        }),
        assistant: {
          text: 'I will check.',
          toolCalls: [{ id: 'tc_1', name: 'weather', args: { city: 'Paris' } }],
        },
        wrappers: {
          fromMessages: fromMessages(canonicalMessages),
          toMessages: toMessages(providerMessages),
        },
      }),
    ).toEqual([])
  })

  it('uses responseJsonSchema for structured output requests', async () => {
    const spec = buildGoogleSpec()
    const fake = createGoogleFake({ structuredTexts: ['{"ok":true}'] })
    const schema = z.object({ ok: z.boolean() })
    const schemaParams = spec.wrapOutputSchema?.(schema)

    await spec.call(fake.client, callArgs({ schema, schemaParams }))

    expect(fake.calls[0]?.config).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: expect.objectContaining({ type: 'object' }),
    })
  })

  it('splits cacheable system blocks into cachedContent and uncached systemInstruction', async () => {
    const fake = createGoogleFake({ emissions: [{ text: 'ok' }] })
    const cacheManager = new GoogleCacheManager(fake.client, CACHE_DEFAULTS)
    const spec = buildGoogleSpec(cacheManager)

    await spec.call(
      fake.client,
      callArgs({
        system: 'Cached rules\n\nPrompt rules',
        systemBlocks: [
          { source: 'context:rules', text: 'Cached rules', providerCache: true },
          { source: 'prompt', text: 'Prompt rules', providerCache: false },
        ] satisfies SystemBlock[],
      }),
    )

    expect(fake.cacheCreates[0]).toEqual({
      model: 'gemini-2.5-flash',
      config: { systemInstruction: 'Cached rules', ttl: '300s' },
    })
    expect(fake.calls[0]?.config).toMatchObject({
      cachedContent: 'cachedContents/conformance-cache',
      systemInstruction: 'Prompt rules',
    })
  })

  it('public fromMessages maps content tool outputs to Google inline media parts', () => {
    const contents = fromMessages([
      {
        role: 'tool',
        content: 'fallback',
        metadata: {
          toolCallId: 'tc_0',
          toolName: 'render',
          modelOutput: {
            type: 'content',
            value: [
              { type: 'text', text: 'Rendered image' },
              { type: 'image-data', data: 'base64-image', mediaType: 'image/png' },
            ],
          },
        },
      },
    ])

    expect(contents).toEqual([
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'tc_0',
              name: 'render',
              response: { output: 'Rendered image\n[image:image/png] data:base64-image' },
              parts: [{ inlineData: { data: 'base64-image', mimeType: 'image/png' } }],
            },
          },
        ],
      },
    ])
  })
})

const BASE_MESSAGES: readonly Message[] = [{ role: 'user', content: 'Weather in Paris?' }]

function callArgs(overrides: Partial<CallArgs<GoogleExtra>> = {}): CallArgs<GoogleExtra> {
  return {
    model: 'gemini-2.5-flash',
    system: 'System.',
    systemBlocks: undefined,
    messages: [...BASE_MESSAGES],
    settings: {},
    schema: undefined,
    schemaParams: undefined,
    tools: undefined,
    extra: {},
    ...overrides,
  }
}

function weatherResult(toolCallId: string): ToolResultEntry {
  return {
    toolCallId,
    name: 'weather',
    output: { temperature: 18 },
    modelOutput: { type: 'text', value: '18 C and cloudy' },
    content: '18 C and cloudy',
    outputSize: 25,
    modelOutputSize: 15,
  }
}

function createGoogleFake(script: AdapterConformanceScript): GoogleFakeClient {
  const calls: GoogleFakeRequest[] = []
  const cacheCreates: unknown[] = []
  const fake = {
    calls,
    script,
    models: {
      generateContent: async (request: GoogleFakeRequest) => {
        calls.push(request)
        const text = request.config?.responseJsonSchema
          ? (script.structuredTexts?.[calls.length - 1] ?? '{"ok":true}')
          : undefined
        return googleResponse(text ? { text } : (script.emissions?.[calls.length - 1] ?? { text: 'ok' }))
      },
      generateContentStream: async (request: GoogleFakeRequest) => {
        calls.push(request)
        return googleStream(script.streamChunks ?? ['he', 'llo'])
      },
    },
    caches: {
      create: async (request: unknown) => {
        cacheCreates.push(request)
        return { name: 'cachedContents/conformance-cache' }
      },
      delete: async () => ({}),
      get: async () => ({ name: 'cachedContents/conformance-cache' }),
      update: async () => ({ name: 'cachedContents/conformance-cache' }),
    },
  }
  return { calls, script, cacheCreates, client: fake as unknown as GoogleGenAI }
}

function inspectorFor(fake: GoogleFakeClient): AdapterConformanceInspector {
  return {
    calls: () => fake.calls,
    messagesForCall: (index) => fake.calls[index]?.contents,
    bodyForCall: (index) => fake.calls[index],
  }
}

function googleResponse(emission: {
  readonly text?: string
  readonly toolCalls?: readonly { readonly name: string; readonly args: unknown }[]
}): GenerateContentResponse {
  const parts = [
    ...(emission.text ? [{ text: emission.text }] : []),
    ...(emission.toolCalls?.map((toolCall) => ({
      functionCall: { name: toolCall.name, args: toolCall.args as Record<string, unknown> },
    })) ?? []),
  ]

  return {
    candidates: [
      { content: { role: 'model', parts }, finishReason: emission.toolCalls?.length ? 'TOOL_CALLS' : 'STOP' },
    ],
    usageMetadata: { promptTokenCount: 13, candidatesTokenCount: 8, totalTokenCount: 21 },
    modelVersion: 'gemini-2.5-flash-actual',
    text: emission.text,
  } as unknown as GenerateContentResponse
}

async function* googleStream(chunks: readonly string[]): AsyncIterable<GenerateContentResponse> {
  for (const text of chunks) {
    yield { candidates: [{ content: { parts: [{ text }] } }] } as unknown as GenerateContentResponse
  }
}
