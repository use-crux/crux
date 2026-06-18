/**
 * AI SDK provider runtime.
 *
 * @module
 */

import { defineProviderRuntime } from '@crux/core/adapter'
import { aiSdkExecutor } from './executor'
import { createAiSdkRuntimeExtensions } from './extensions'
import { extractModelInfo } from './provider-profile'

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
    runLoop: aiSdkExecutor.runLoop,
    attemptStructured: aiSdkExecutor.attemptStructured,
    runStream: aiSdkExecutor.runStream,
    replayStream: aiSdkExecutor.replayStream,
  },
  extend: ({ client }) => createAiSdkRuntimeExtensions(client),
})
