/**
 * Public single-turn provider bundle tests.
 */

import { describe, expect, it } from 'vitest'
import { prompt as makePrompt } from '../../prompt/prompt'
import type { Message } from '../../generation/messages'
import {
  defineSingleTurnProviderBundle,
  type NativeResponseMetadata,
  type ProviderRuntimeExtender,
  type SingleTurnProviderRuntime,
} from '../../adapter'

interface BundleProviderMessage {
  readonly role: Message['role']
  readonly text: string
}

interface BundleRequest {
  readonly model: string
  readonly mode: 'text' | 'structured'
  readonly messages: readonly BundleProviderMessage[]
  readonly depsTag: string
}

interface BundleRawResponse {
  readonly id: string
  readonly model: string
  readonly text: string
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly totalTokens: number
  }
}

type BundleStream = AsyncIterable<never>
type BundleRuntime = SingleTurnProviderRuntime<
  BundleClient,
  BundleRawResponse,
  BundleStream,
  Record<string, never>
>

interface BundleClient {
  readonly calls: BundleRequest[]
}

interface BundleDeps extends Record<string, unknown> {
  readonly tag: string
}

describe('defineSingleTurnProviderBundle', () => {
  it('compiles provider hooks into runtime create and helper factories with provider-owned deps', async () => {
    const bundle = defineBundleTest()

    const client: BundleClient = { calls: [] }
    const runtime = bundle.create(client, 'runtime-deps')

    const result = await runtime.generate(
      makePrompt({ id: 'bundle-runtime' }),
      {
        model: 'bundle-model',
      },
    )
    const text = await bundle
      .helpers('helper-deps')
      .createGenerateTextFn(client, 'helper-model')({
      model: 'ignored',
      prompt: 'Write text',
    })

    expect(bundle.id).toBe('bundle-test')
    expect(bundle.ownership).toBe('single-turn')
    expect(bundle.runtime.id).toBe('bundle-test')
    expect(bundle.runtime.ownership).toBe('single-turn')
    expect(runtime.providerId).toBe('bundle-test')
    expect(result).toMatchObject({
      text: 'bundle text',
      _meta: { responseId: 'resp_1', actualModelId: 'bundle-actual' },
    })
    expect(text).toEqual({ text: 'bundle text' })
    expect(client.calls).toEqual([
      {
        model: 'bundle-model',
        mode: 'text',
        messages: [],
        depsTag: 'runtime-deps',
      },
      {
        model: 'helper-model',
        mode: 'text',
        messages: [{ role: 'user', text: 'Write text' }],
        depsTag: 'helper-deps',
      },
    ])
  })

  it('preserves generated runtime extension collision checks', () => {
    const replaceGeneratedKey = (() => ({
      generate() {
        return 'extension generate'
      },
    })) as ProviderRuntimeExtender<BundleClient, BundleRuntime, object>
    const bundle = defineBundleTest(replaceGeneratedKey)

    expect(() => bundle.create({ calls: [] }, 'runtime-deps')).toThrowError(
      'Provider runtime "bundle-test" extension cannot replace generated runtime key "generate".',
    )
  })
})

function defineBundleTest<TExtensions extends object = Record<string, never>>(
  extend?: ProviderRuntimeExtender<BundleClient, BundleRuntime, TExtensions>,
) {
  return defineSingleTurnProviderBundle<
    BundleClient,
    BundleRequest,
    BundleRawResponse,
    BundleStream,
    Record<string, never>,
    BundleDeps,
    BundleProviderMessage,
    readonly [tag: string],
    readonly [tag: string],
    TExtensions
  >({
    id: 'bundle-test',
    bind: (client: BundleClient) => ({
      async call(request, mode) {
        client.calls.push({ ...request, mode })
        return {
          id: `resp_${client.calls.length}`,
          model: 'bundle-actual',
          text: 'bundle text',
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        }
      },
      async stream() {
        return emptyStream()
      },
    }),
    profile: {
      request(args, { mode, deps }) {
        return {
          model: args.model,
          mode,
          messages: args.providerMessages,
          depsTag: deps.tag,
        }
      },
      response: {
        meta(raw): NativeResponseMetadata {
          return {
            usage: raw.usage,
            responseId: raw.id,
            actualModelId: raw.model,
            finishReason: 'stop',
          }
        },
      },
      stream: { textDelta: () => undefined },
      settings: () => ({}),
      transcript: {
        fromMessages: (messages) =>
          messages.map((message) => ({
            role: message.role,
            text: message.content,
          })),
        toMessages: (messages) =>
          messages.flatMap((message) =>
            isBundleProviderMessage(message)
              ? [{ role: message.role, content: message.text }]
              : [],
          ),
        readAssistant: (raw) => ({ text: raw.text }),
      },
    },
    deps: {
      create: (_client, tag: string): BundleDeps => ({ tag }),
      helpers: (tag: string): BundleDeps => ({ tag }),
    },
    extend,
  })
}

function emptyStream(): BundleStream {
  return {
    async *[Symbol.asyncIterator]() {},
  }
}

function isBundleProviderMessage(
  value: unknown,
): value is BundleProviderMessage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { readonly role?: unknown; readonly text?: unknown }
  return (
    (record.role === 'system' ||
      record.role === 'user' ||
      record.role === 'assistant' ||
      record.role === 'tool') &&
    typeof record.text === 'string'
  )
}
