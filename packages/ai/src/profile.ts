/**
 * AI SDK adapter profile.
 *
 * @module
 */

import { defineAdapterProfile, sdkLoop } from '@crux/core/adapter/profile'
import { aiSdkExecutor } from './executor'
import { extractModelInfo } from './provider-profile'

/**
 * Public profile for the Vercel AI SDK runtime.
 *
 * The AI SDK owns the multi-step language-model loop; Crux owns policy
 * around it through the SDK-loop driver.
 */
export const aiSdkProfile = defineAdapterProfile({
  id: 'ai-sdk',
  describeModel: extractModelInfo,
  driver: sdkLoop({
    settings: aiSdkExecutor.mapSettings,
    runLoop: aiSdkExecutor.runLoop,
    attemptStructured: aiSdkExecutor.attemptStructured,
    runStream: aiSdkExecutor.runStream,
    replayStream: aiSdkExecutor.replayStream,
  }),
})
