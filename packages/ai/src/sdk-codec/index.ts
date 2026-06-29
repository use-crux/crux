import type { GenerationSettings, ModelInfo } from '@use-crux/core'
import { extractModelInfo } from '../provider-profile'
import { createLoopCallPlan } from './loop'
import { replayStream } from './replay'
import { createStructuredCallPlan } from './structured'
import { createStreamCallPlan } from './stream'
import type { AiSdkCodec, AiSdkCodecDeps } from './types'

/**
 * Create the internal AI SDK codec used by `createAiSdkLoopRuntime()`.
 *
 * The returned object owns SDK-shaped request planning and raw-result
 * projection while the loop runtime remains responsible only for invoking the
 * selected gateway method.
 *
 * @internal
 */
export function createAiSdkCodec(deps: AiSdkCodecDeps = {}): AiSdkCodec {
  const clock = deps.clock ?? Date.now

  return {
    executorId: 'ai-sdk',

    describeModel: extractModelInfo,

    mapSettings(settings: GenerationSettings, _model: ModelInfo): Record<string, unknown> {
      // Resolved Crux settings flow into AI SDK args verbatim — prompts
      // author settings in AI SDK vocabulary when targeting this adapter.
      return { ...settings }
    },

    loop: createLoopCallPlan,

    structured: createStructuredCallPlan,

    stream: (request) => createStreamCallPlan(request, { clock }),

    replayStream,
  }
}
