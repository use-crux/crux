import type { LanguageModel } from 'ai'
import type { ProviderRuntimeConformanceHarness } from '@crux/core/adapter'
import { describeCruxAdapterConformance } from '@crux/core/adapter/testing/vitest'
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
  },
})

function aiSdkConformanceHarness(): ProviderRuntimeConformanceHarness<SdkGateway, LanguageModel> {
  return {
    prepare(script) {
      return {
        client: liveSdkGateway(),
        model: script.structuredTexts
          ? structuredModel(script.structuredTexts)
          : script.streamChunks
            ? streamingModel(script.streamChunks)
            : emissionModel(script.emissions ?? []),
      }
    },
  }
}
