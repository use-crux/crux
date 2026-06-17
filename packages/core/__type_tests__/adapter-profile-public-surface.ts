/**
 * Compile-time contract checks for `@crux/core/adapter/profile`.
 */

import { expectTypeOf } from 'vitest'
import type { z } from 'zod'
import { defineAdapterProfile, nativeChat, sdkLoop } from '@crux/core/adapter/profile'
import type { NativeChatHelpers, NativeChatProfile } from '@crux/core/adapter/profile'
import type { CruxAdapter, CruxExecutor } from '@crux/core/adapter'
import type { ExecutorOutcome, ExecutorRequest, ExecutorStreamHandle, StructuredAttempt } from '@crux/core/adapter'
import type { Message } from '../messages'
import type { AnyPrompt, ModelInfo } from '../types'

interface NativeRequest {
  readonly model: string
  readonly tenant: string
}

interface NativeRawResponse {
  readonly text: string
}

interface NativeStream extends AsyncIterable<{ readonly delta: string }> {}

interface NativeExtra extends Record<string, unknown> {
  readonly feature?: boolean
}

interface NativeDeps extends Record<string, unknown> {
  readonly tenant: string
}

interface NativeClient {
  readonly id: string
}

interface NativeProviderMessage {
  readonly role: Message['role']
  readonly text: string
}

declare const prompt: AnyPrompt
declare const nativeClient: NativeClient
declare const nativeStream: NativeStream

const nativeHooks = {
  bind: (_client: NativeClient) => ({
    call: async () => ({ text: 'ok' }),
    stream: async () => nativeStream,
  }),
  request(args, ctx) {
    expectTypeOf(args.extra).toEqualTypeOf<NativeExtra>()
    expectTypeOf(ctx.deps).toEqualTypeOf<NativeDeps>()
    return { model: args.model, tenant: ctx.deps.tenant }
  },
  response: {
    meta: () => ({
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      finishReason: 'stop',
      responseId: undefined,
      actualModelId: undefined,
    }),
  },
  stream: {
    textDelta: () => undefined,
  },
  settings: () => ({}),
  transcript: {
    fromMessages: () => [],
    toMessages: () => [],
    readAssistant: (raw) => ({ text: raw.text, toolCalls: undefined }),
  },
} satisfies NativeChatProfile<
  NativeClient,
  NativeRequest,
  NativeRawResponse,
  NativeStream,
  NativeExtra,
  NativeDeps,
  NativeProviderMessage
>

const nativeDriver = nativeChat(nativeHooks)
const nativeProfile = defineAdapterProfile({
  id: 'typed-native',
  driver: nativeDriver,
})

const nativeRuntime = nativeProfile.create(nativeClient, { tenant: 'acme' })
expectTypeOf(nativeRuntime).toMatchTypeOf<CruxAdapter<NativeClient, NativeRawResponse, NativeStream, NativeExtra>>()
expectTypeOf(nativeDriver.helpers('typed-native', { tenant: 'acme' })).toEqualTypeOf<NativeChatHelpers<NativeClient>>()

void nativeRuntime.generate(prompt, {
  model: 'native-model',
  extra: { feature: true },
})

// @ts-expect-error - native profile dependencies are required when TDeps is not empty.
nativeProfile.create(nativeClient)

// @ts-expect-error - native profile helper dependencies are required when TDeps is not empty.
nativeDriver.helpers('typed-native')

// @ts-expect-error - native profile extra options preserve their declared shape.
void nativeRuntime.generate(prompt, { model: 'native-model', extra: { feature: 'yes' } })

interface SdkClient {
  readonly gateway: true
}

interface SdkModel {
  readonly provider: string
  readonly modelId: string
}

interface SdkRawResponse {
  readonly text: string
}

interface SdkRawStream {
  readonly stream: true
}

declare const sdkClient: SdkClient
declare const sdkModel: SdkModel
declare const sdkOutcome: ExecutorOutcome<SdkRawResponse>
declare const sdkStructured: StructuredAttempt<SdkRawResponse>
declare const sdkStream: ExecutorStreamHandle<SdkRawStream>

const sdkProfile = defineAdapterProfile({
  id: 'typed-sdk',
  describeModel(model: SdkModel): ModelInfo {
    return { provider: model.provider, modelId: model.modelId }
  },
  driver: sdkLoop({
    settings: () => ({}),
    runLoop: async (_client: SdkClient, request: ExecutorRequest<SdkModel>) => {
      expectTypeOf(request.model).toEqualTypeOf<SdkModel>()
      return sdkOutcome
    },
    attemptStructured: async () => sdkStructured,
    runStream: async () => sdkStream,
  }),
})

const sdkRuntime = sdkProfile.create(sdkClient)
expectTypeOf(sdkRuntime).toMatchTypeOf<CruxExecutor<SdkClient, SdkModel, SdkRawResponse, SdkRawStream>>()

void sdkRuntime.generate(prompt, {
  model: sdkModel,
  input: {},
})

// @ts-expect-error - SDK-loop model inference rejects unrelated model shapes.
void sdkRuntime.generate(prompt, { model: 'sdk-model' })

// Keep the imported Zod namespace type visible for stream schema compatibility.
expectTypeOf<z.ZodType>().not.toEqualTypeOf<never>()
