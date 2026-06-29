/**
 * AI SDK provider runtime.
 *
 * @module
 */

import { defineProviderRuntime } from '@use-crux/core/adapter'
import { createAiSdkLoopRuntime } from './executor'
import { createAiSdkRuntimeExtensions } from './extensions'
import type { SdkGateway } from './gateway'
import { extractModelInfo } from './provider-profile'

/**
 * Public provider runtime for the Vercel AI SDK.
 *
 * The AI SDK owns the multi-step language-model loop; Crux owns policy around
 * it through the loop-owned provider runtime boundary. This keeps AI SDK model
 * objects as first-class Crux provider models without importing the SDK into
 * `@use-crux/core`. `bind` closes over the gateway and exposes the
 * client-dependent loop operations; core assembles them into a `LoopRuntimePort`.
 */
export const aiSdkProviderRuntime = defineProviderRuntime({
  id: 'ai-sdk',
  ownership: 'loop-owned',
  loop: {
    describeModel: extractModelInfo,
    settings: (settings) => ({ ...settings }),
    bind: (gateway: SdkGateway) => {
      const { runTextLoop, runStructuredAttempt, runStream, replayStream } = createAiSdkLoopRuntime(gateway)
      return { runTextLoop, runStructuredAttempt, runStream, replayStream }
    },
  },
  extend: ({ client }) => createAiSdkRuntimeExtensions(client),
})
