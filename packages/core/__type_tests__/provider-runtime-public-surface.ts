/**
 * Compile-time contract checks for provider runtimes.
 */

import { expectTypeOf } from 'vitest'
import type { z } from 'zod'
import { defineProviderRuntime } from '@crux/core/adapter'
import type {
  CruxAdapter,
  CruxExecutor,
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorStreamHandle,
  NativeProviderPort,
  LoopOwnedRuntimeContract,
  SingleTurnRuntimeContract,
  StructuredAttempt,
} from '@crux/core/adapter'
import type { Message } from '../messages'
import type { AnyPrompt, ModelInfo } from '../types'

interface SingleRequest {
  readonly model: string
  readonly tenant: string
}

interface SingleRawResponse {
  readonly text: string
}

interface SingleStream extends AsyncIterable<{ readonly delta: string }> {}

interface SingleExtra extends Record<string, unknown> {
  readonly feature?: boolean
}

interface SingleDeps extends Record<string, unknown> {
  readonly tenant: string
}

interface SingleClient {
  readonly id: string
}

interface SingleProviderMessage {
  readonly role: Message['role']
  readonly text: string
}

declare const prompt: AnyPrompt
declare const singleClient: SingleClient
declare const singleStream: SingleStream

const turnContract = {
  bind: (_client: SingleClient): NativeProviderPort<SingleRequest, SingleRawResponse, SingleStream> => ({
    call: async () => ({ text: 'ok' }),
    stream: async () => singleStream,
  }),
  request(args, ctx) {
    expectTypeOf(args.extra).toEqualTypeOf<SingleExtra>()
    expectTypeOf(ctx.deps).toEqualTypeOf<SingleDeps>()
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
} satisfies SingleTurnRuntimeContract<
  SingleClient,
  SingleRequest,
  SingleRawResponse,
  SingleStream,
  SingleExtra,
  SingleDeps,
  SingleProviderMessage
>

const singleProvider = defineProviderRuntime({
  id: 'typed-single',
  turn: turnContract,
  extend: ({ client, runtime }) => ({
    embedding(input: string) {
      return `${client.id}:${runtime.providerId}:${input}`
    },
  }),
})

const singleRuntime = singleProvider.create(singleClient, { tenant: 'acme' })
expectTypeOf(singleRuntime).toMatchTypeOf<
  CruxAdapter<SingleClient, SingleRawResponse, SingleStream, SingleExtra> & {
    embedding(input: string): string
  }
>()
expectTypeOf(singleProvider.helpers({ tenant: 'acme' }).createGenerateTextFn).toBeFunction()

void singleRuntime.generate(prompt, {
  model: 'single-model',
  extra: { feature: true },
})

// @ts-expect-error - single-turn provider dependencies are required when TDeps is not empty.
singleProvider.create(singleClient)

// @ts-expect-error - single-turn extra options preserve their declared shape.
void singleRuntime.generate(prompt, { model: 'single-model', extra: { feature: 'yes' } })

interface LoopClient {
  readonly gateway: true
}

interface LoopModel {
  readonly provider: string
  readonly modelId: string
}

interface LoopRawResponse {
  readonly text: string
}

interface LoopRawStream {
  readonly stream: true
}

declare const loopClient: LoopClient
declare const loopModel: LoopModel
declare const loopOutcome: ExecutorOutcome<LoopRawResponse>
declare const loopStructured: StructuredAttempt<LoopRawResponse>
declare const loopStream: ExecutorStreamHandle<LoopRawStream>

const loopContract = {
  describeModel(model: LoopModel): ModelInfo {
    return { provider: model.provider, modelId: model.modelId }
  },
  settings: () => ({}),
  bind(client: LoopClient) {
    expectTypeOf(client).toEqualTypeOf<LoopClient>()
    return {
      run: async (request: ExecutorRequest<LoopModel>) => {
        expectTypeOf(request.model).toEqualTypeOf<LoopModel>()
        return loopOutcome
      },
      attemptStructured: async () => loopStructured,
      stream: async () => loopStream,
    }
  },
} satisfies LoopOwnedRuntimeContract<LoopClient, LoopModel, LoopRawResponse, LoopRawStream>

const loopProvider = defineProviderRuntime({
  id: 'typed-loop',
  loop: loopContract,
})

defineProviderRuntime({
  id: 'typed-loop-collision',
  loop: {
    describeModel(model: LoopModel): ModelInfo {
      return { provider: model.provider, modelId: model.modelId }
    },
    settings: () => ({}),
    bind: () => ({
      run: async () => loopOutcome,
      attemptStructured: async () => loopStructured,
      stream: async () => loopStream,
    }),
  },
  // @ts-expect-error - provider runtime extensions cannot replace generated runtime members.
  extend: () => ({
    generate() {
      return 'extension generate'
    },
  }),
})

const loopRuntime = loopProvider.create(loopClient)
expectTypeOf(loopRuntime).toMatchTypeOf<CruxExecutor<LoopClient, LoopModel, LoopRawResponse, LoopRawStream>>()

void loopRuntime.generate(prompt, {
  model: loopModel,
  input: {},
})

// @ts-expect-error - loop-owned model inference rejects unrelated model shapes.
void loopRuntime.generate(prompt, { model: 'loop-model' })

// Keep the imported Zod namespace type visible for stream schema compatibility.
expectTypeOf<z.ZodType>().not.toEqualTypeOf<never>()
