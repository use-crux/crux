import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import type { ProviderConformanceEmission, ProviderRuntimeConformanceHarness } from '@use-crux/core/adapter'
import { describeCruxAdapterConformance } from '@use-crux/core/adapter/testing/vitest'
import type { GoogleSystemCacheResolver } from '../system-cache-planner'
import { googleProviderRuntime } from '../native'

interface GoogleConformanceDeps extends Record<string, unknown> {
  readonly cacheResolver?: GoogleSystemCacheResolver
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
  },
})

function googleConformanceHarness(): ProviderRuntimeConformanceHarness<GoogleGenAI, string, GoogleConformanceDeps> {
  return {
    prepare(script) {
      const captured = capturedGoogleClient({
        emissions: script.emissions,
        structuredTexts: script.structuredTexts,
        streamChunks: script.streamChunks,
      })

      return {
        client: captured.client,
        model: 'gemini-conformance',
        deps: { cacheResolver: undefined },
        inspect: {
          calls: () => captured.calls,
          messagesForCall: (index) => readRecord(captured.calls[index])?.contents,
          bodyForCall: (index) => captured.calls[index],
        },
      }
    },
  }
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
    usageMetadata: {
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
