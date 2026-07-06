import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import type { ProviderConformanceEmission, ProviderRuntimeConformanceHarness } from '@use-crux/core/adapter'
import { describeCruxAdapterConformance } from '@use-crux/core/adapter/testing/vitest'
import type { GoogleCacheName } from '../cached-content'
import type { GoogleCachedContentLifecycle } from '../cached-content'
import { googleProviderRuntime } from '../native'

interface GoogleConformanceDeps extends Record<string, unknown> {
  readonly cachedContentLifecycle: GoogleCachedContentLifecycle
}

interface CapturedGoogleClient {
  readonly client: GoogleGenAI
  readonly calls: unknown[]
}

describeCruxAdapterConformance({
  name: 'google',
  runtime: googleProviderRuntime,
  harness: googleConformanceHarness(),
  capabilities: {
    ownership: 'single-turn',
    structuredOutput: true,
    streaming: true,
    toolCalls: true,
    approvalSuspension: true,
    providerCache: true,
  },
})

function googleConformanceHarness(): ProviderRuntimeConformanceHarness<GoogleGenAI, string, GoogleConformanceDeps> {
  return {
    providerCache: {
      assertRequest: assertGoogleCachedContentBoundary,
    },
    prepare(script) {
      const captured = capturedGoogleClient({
        emissions: script.emissions,
        structuredTexts: script.structuredTexts,
        streamChunks: script.streamChunks,
      })

      return {
        client: captured.client,
        model: 'gemini-conformance',
        deps: { cachedContentLifecycle: conformanceCachedContentLifecycle() },
        inspect: {
          calls: () => captured.calls,
          messagesForCall: (index) => readRecord(captured.calls[index])?.contents,
          bodyForCall: (index) => captured.calls[index],
        },
      }
    },
  }
}

function conformanceCachedContentLifecycle(): GoogleCachedContentLifecycle {
  return {
    async prepare(args) {
      const blocks = args.systemBlocks ?? []
      let prefixLength = 0
      for (const block of blocks) {
        if (!block.providerCache) break
        prefixLength++
      }

      if (prefixLength === 0) {
        return {
          mode: 'inline',
          reason: 'no-cacheable-prefix',
          config: { systemInstruction: args.system },
        }
      }

      return {
        mode: 'cached',
        config: {
          cachedContent: 'cachedContents/crux-conformance' as GoogleCacheName,
          systemInstruction: joinSystemBlocks(blocks.slice(prefixLength)),
        },
      }
    },
  }
}

function assertGoogleCachedContentBoundary(body: unknown): string | undefined {
  const config = readRecord(readRecord(body)?.config)
  if (config?.cachedContent !== 'cachedContents/crux-conformance') {
    return `expected Google cachedContent reference, got ${JSON.stringify(config)}`
  }
  if (config.systemInstruction !== 'Dynamic tail: Run the conformance scenario.') {
    return `expected only uncached tail inline, got ${JSON.stringify(config.systemInstruction)}`
  }

  const serialized = JSON.stringify(body)
  for (const cachedText of ['Stable identity.', 'Cached rule A.', 'Cached rule B.']) {
    if (serialized.includes(cachedText)) {
      return `Google request included cached prefix text inline: ${cachedText}`
    }
  }
  return undefined
}

function joinSystemBlocks(blocks: readonly { readonly text: string }[]): string | undefined {
  if (blocks.length === 0) return undefined
  return blocks.map((block) => block.text).join('\n\n')
}

function capturedGoogleClient(script: {
  readonly emissions?: readonly ProviderConformanceEmission[]
  readonly structuredTexts?: readonly string[]
  readonly streamChunks?: readonly string[]
}): CapturedGoogleClient {
  const calls: unknown[] = []
  const emissions = [...(script.emissions ?? [])]
  const structuredTexts = [...(script.structuredTexts ?? [])]

  const client = {
    models: {
      generateContent: async (request: unknown) => {
        calls.push(request)
        if (structuredTexts.length > 0) return googleResponse({ text: structuredTexts.shift() }, calls.length)
        return googleResponse(emissions.shift() ?? { text: 'exhausted' }, calls.length)
      },
      generateContentStream: async (request: unknown) => {
        calls.push(request)
        return googleStream(script.streamChunks ?? [])
      },
    },
  } as unknown as GoogleGenAI

  return { client, calls }
}

function googleResponse(emission: ProviderConformanceEmission, sequence: number): GenerateContentResponse {
  const functionParts =
    emission.toolCalls?.map((toolCall, index) => ({
      functionCall: {
        id: toolCall.id ?? `call_${sequence}_${index}`,
        name: toolCall.name,
        args: toolCall.args,
      },
    })) ?? []

  return {
    text: emission.text ?? '',
    modelVersion: 'gemini-conformance-actual',
    usageMetadata:
      emission.usage !== undefined
        ? {
            promptTokenCount: emission.usage.inputTokens,
            candidatesTokenCount: emission.usage.outputTokens,
            totalTokenCount: emission.usage.totalTokens,
          }
        : {
            promptTokenCount: 13,
            candidatesTokenCount: 8,
            totalTokenCount: 21,
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

function googleStream(chunks: readonly string[]): AsyncIterable<GenerateContentResponse> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of chunks) {
        yield googleResponse({ text }, 0)
      }
    },
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}
