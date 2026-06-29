/**
 * `createAiSdkLoopRuntime()` — the `LoopRuntimePort` implementation for the
 * Vercel AI SDK.
 *
 * Core owns policy: prompt resolution, routing, validation retry, tool
 * approval tokens, safety policy, timeouts, and observability. This runtime
 * owns only the gateway invocation. The internal SDK codec plans AI SDK calls
 * and projects raw SDK results back into core contracts; the runtime closes
 * over the {@link SdkGateway} so each port method takes only a request.
 *
 * @module
 */

import type { LanguageModel } from 'ai'
import type { LoopRuntimePort } from '@use-crux/core/adapter'
import type { SdkGateway } from './gateway'
import { createAiSdkCodec } from './sdk-codec'
import type { SdkLoopResultLike, SdkStreamResultLike } from './sdk-codec'

export type { SdkLoopResultLike, SdkStreamResultLike } from './sdk-codec'

/** The AI SDK loop runtime port, bound to one {@link SdkGateway}. */
export type AiSdkLoopRuntime = LoopRuntimePort<LanguageModel, SdkLoopResultLike, SdkStreamResultLike>

/**
 * Build the AI SDK {@link LoopRuntimePort} over a concrete {@link SdkGateway}.
 *
 * The gateway is the package's external seam: production binds
 * `liveSdkGateway()`, tests bind a scripted gateway. The returned port is what
 * `aiSdkProviderRuntime` and `createCruxAi({ gateway })` drive.
 *
 * @param gateway - The AI SDK gateway to invoke (`generateText`/`generateObject`/
 *   `streamText`/`streamObject`).
 * @returns A loop runtime port bound to the gateway.
 */
export function createAiSdkLoopRuntime(gateway: SdkGateway): AiSdkLoopRuntime {
  const codec = createAiSdkCodec()

  return {
    id: codec.executorId,

    describeModel: codec.describeModel,

    mapSettings: codec.mapSettings,

    async runTextLoop(request) {
      const call = codec.loop(request)
      const raw = await gateway[call.method](call.args)
      return call.decode(raw)
    },

    async runStructuredAttempt(request) {
      const call = await codec.structured(request)
      try {
        return call.decode(await gateway.generateObject(call.args))
      } catch (error) {
        const invalid = await call.decodeError(error)
        if (invalid) return invalid
        throw error
      }
    },

    async runStream(request) {
      const call = await codec.stream(request)
      if (call.method === 'streamText') {
        return call.attach(gateway.streamText(call.args))
      }
      return call.attach(gateway.streamObject(call.args))
    },

    replayStream: codec.replayStream,
  }
}
