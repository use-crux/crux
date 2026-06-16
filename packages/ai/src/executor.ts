/**
 * `AiSdkExecutor` - the `ExecutorSpec` implementation for the Vercel AI SDK.
 *
 * Core owns policy: prompt resolution, routing, validation retry, tool
 * approval tokens, safety policy, timeouts, and observability. This executor
 * owns only the gateway invocation. The internal SDK codec plans AI SDK calls
 * and projects raw SDK results back into core contracts.
 *
 * @module
 */

import type { LanguageModel } from 'ai'
import type { z } from 'zod'
import type {
  ExecutorRequest,
  ExecutorSpec,
  ExecutorStreamHandle,
  StructuredAttempt,
  StructuredRequest,
} from '@crux/core/adapter'
import type { SdkGateway } from './gateway'
import { createAiSdkCodec } from './sdk-codec'
import type { SdkLoopResultLike, SdkStreamResultLike } from './sdk-codec'

export type { SdkLoopResultLike, SdkStreamResultLike } from './sdk-codec'

const codec = createAiSdkCodec()

/**
 * The `ExecutorSpec` binding the Vercel AI SDK to `executorAdapter()`.
 *
 * Bind it with a gateway: `executorAdapter(aiSdkExecutor)(liveSdkGateway())`.
 * Tests bind a scripted gateway instead, or pass `MockLanguageModelV3`
 * models through the live gateway when real SDK loop semantics matter.
 */
export const aiSdkExecutor: ExecutorSpec<SdkGateway, LanguageModel, SdkLoopResultLike, SdkStreamResultLike> = {
  executorId: codec.executorId,

  describeModel: codec.describeModel,

  mapSettings: codec.mapSettings,

  async runLoop(gateway: SdkGateway, request: ExecutorRequest<LanguageModel>) {
    const call = codec.loop(request)
    const raw = await gateway[call.method](call.args)
    return call.decode(raw)
  },

  async attemptStructured(
    gateway: SdkGateway,
    request: StructuredRequest<LanguageModel>,
  ): Promise<StructuredAttempt<SdkLoopResultLike>> {
    const call = await codec.structured(request)
    try {
      return call.decode(await gateway.generateObject(call.args))
    } catch (error) {
      const invalid = await call.decodeError(error)
      if (invalid) return invalid
      throw error
    }
  },

  async runStream(
    gateway: SdkGateway,
    request: ExecutorRequest<LanguageModel> & { readonly schema?: z.ZodType },
  ): Promise<ExecutorStreamHandle<SdkStreamResultLike>> {
    const call = await codec.stream(request)
    if (call.method === 'streamText') {
      return call.attach(gateway.streamText(call.args))
    }
    return call.attach(gateway.streamObject(call.args))
  },

  replayStream: codec.replayStream,
}
