/**
 * AI SDK provider runtime.
 *
 * @module
 */

import { defineProviderRuntime } from '@crux/core/adapter'
import { aiSdkExecutor } from './executor'
import { createAiSdkRuntimeExtensions } from './extensions'
import { extractModelInfo } from './provider-profile'

type AiSdkGateway = Parameters<typeof aiSdkExecutor.runLoop>[0]
type AiSdkRunRequest = Parameters<typeof aiSdkExecutor.runLoop>[1]
type AiSdkStructuredRequest = Parameters<typeof aiSdkExecutor.attemptStructured>[1]
type AiSdkStreamRequest = Parameters<typeof aiSdkExecutor.runStream>[1]

/**
 * Public provider runtime for the Vercel AI SDK.
 *
 * The AI SDK owns the multi-step language-model loop; Crux owns policy around
 * it through the loop-owned provider runtime boundary. This keeps AI SDK model
 * objects as first-class Crux provider models without importing the SDK into
 * `@crux/core`.
 */
export const aiSdkProviderRuntime = defineProviderRuntime({
  id: 'ai-sdk',
  loop: {
    describeModel: extractModelInfo,
    settings: aiSdkExecutor.mapSettings,
    bind: (gateway: AiSdkGateway) => {
      const runtime = {
        run: (request: AiSdkRunRequest) => aiSdkExecutor.runLoop(gateway, request),
        attemptStructured: (request: AiSdkStructuredRequest) => aiSdkExecutor.attemptStructured(gateway, request),
        stream: (request: AiSdkStreamRequest) => aiSdkExecutor.runStream(gateway, request),
      }

      return aiSdkExecutor.replayStream ? { ...runtime, replayStream: aiSdkExecutor.replayStream } : runtime
    },
  },
  extend: ({ client }) => createAiSdkRuntimeExtensions(client),
})
