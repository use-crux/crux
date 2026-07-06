import type { LanguageModel } from 'ai'
import type { ProviderConformanceScript, ProviderRuntimeConformanceHarness } from '@use-crux/core/adapter'
import { describeCruxAdapterConformance } from '@use-crux/core/adapter/testing/vitest'
import { aiSdkProviderRuntime } from '../index'
import { liveSdkGateway, type SdkGateway } from '../src/gateway'
import { emissionModel, streamingModel, structuredModel } from './mock-model'

describeCruxAdapterConformance({
  name: 'ai-sdk',
  runtime: aiSdkProviderRuntime,
  harness: aiSdkConformanceHarness(),
  capabilities: {
    ownership: 'loop-owned',
    structuredOutput: true,
    streaming: true,
    toolCalls: true,
    approvalSuspension: true,
    observerDirectives: true,
    providerCache: true,
  },
})

function aiSdkConformanceHarness(): ProviderRuntimeConformanceHarness<SdkGateway, LanguageModel> {
  return {
    providerCache: {
      assertRequest: assertAiSdkAnthropicCacheBoundary,
    },
    prepare(script) {
      const captured = capturingGateway(liveSdkGateway())
      return {
        client: captured.gateway,
        model: modelForScript(script),
        inspect: {
          calls: () => captured.calls,
          messagesForCall: (index) => readRecord(captured.calls[index])?.messages,
          bodyForCall: (index) => captured.calls[index],
        },
      }
    },
  }
}

function modelForScript(script: ProviderConformanceScript): LanguageModel {
  const model = script.structuredTexts
    ? structuredModel(script.structuredTexts)
    : script.streamChunks
      ? streamingModel(script.streamChunks)
      : emissionModel(script.emissions ?? [])

  return script.providerCache ? asAnthropicModel(model) : model
}

function capturingGateway(gateway: SdkGateway): {
  readonly gateway: SdkGateway
  readonly calls: readonly unknown[]
} {
  const calls: unknown[] = []
  return {
    calls,
    gateway: {
      generateText: (args) => {
        calls.push(args)
        return gateway.generateText(args)
      },
      generateObject: (args) => {
        calls.push(args)
        return gateway.generateObject(args)
      },
      streamText: (args) => {
        calls.push(args)
        return gateway.streamText(args)
      },
      streamObject: (args) => {
        calls.push(args)
        return gateway.streamObject(args)
      },
      embedMany: (args) => gateway.embedMany(args),
      rerank: (args) => gateway.rerank(args),
    },
  }
}

function asAnthropicModel(model: LanguageModel): LanguageModel {
  if (typeof model !== 'object' || model === null) return model
  return Object.assign(Object.create(model), {
    provider: 'anthropic.messages',
    modelId: 'claude-conformance',
  }) as LanguageModel
}

function assertAiSdkAnthropicCacheBoundary(body: unknown): string | undefined {
  const system = readRecord(body)?.system
  if (!Array.isArray(system)) return `expected AI SDK Anthropic system messages, got ${JSON.stringify(system)}`

  const markerMessages = system.filter(
    (message) => readRecord(readRecord(message)?.providerOptions)?.anthropic !== undefined,
  )
  if (markerMessages.length !== 1) {
    return `expected one AI SDK Anthropic cacheControl marker, got ${markerMessages.length}`
  }

  const marked = readRecord(markerMessages[0])
  if (marked?.content !== 'Cached rule B.') {
    return `expected cacheControl on "Cached rule B.", got ${JSON.stringify(marked)}`
  }
  const anthropicOptions = readRecord(readRecord(marked.providerOptions)?.anthropic)
  const cacheControl = readRecord(anthropicOptions?.cacheControl)
  if (cacheControl?.type !== 'ephemeral') {
    return `expected ephemeral cacheControl on "Cached rule B.", got ${JSON.stringify(marked.providerOptions)}`
  }

  const serialized = JSON.stringify(system)
  for (const expected of [
    'Stable identity.',
    'Cached rule A.',
    'Cached rule B.',
    'Dynamic tail: Run the conformance scenario.',
  ]) {
    if (!serialized.includes(expected)) return `AI SDK request omitted ${expected}`
  }
  return undefined
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}
