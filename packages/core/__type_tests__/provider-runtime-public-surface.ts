/**
 * Compile-time contract checks for provider runtimes.
 */

import { expectTypeOf } from 'vitest'
import type { z } from 'zod'
import { defineProviderRuntime } from '@use-crux/core/adapter'
import { providerRuntimeConformance } from '@use-crux/core/adapter/testing'
import type {
  ConformanceViolation,
  ProviderRuntimeConformanceHarness,
} from '@use-crux/core/adapter/testing'
import type {
  CruxAdapter,
  CruxExecutor,
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorProviderStreamHandle,
  NativeProviderPort,
  LoopOwnedRuntimeContract,
  ProviderOwnership,
  SingleTurnRuntimeContract,
  StructuredAttempt,
} from '@use-crux/core/adapter'
// @ts-expect-error - capability reports are intentionally not a public adapter contract.
import type { CapabilityReport } from '@use-crux/core/adapter'
import type { Message } from '../src/generation/messages'
import type { ModelInfo } from '../src/types'
import type { AnyPrompt } from '../src/prompt/prompt-types'

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
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, inputTokenDetails: {}, outputTokenDetails: {} },
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
  ownership: 'single-turn',
  turn: turnContract,
  extend: ({ client, runtime }) => ({
    embedding(input: string) {
      return `${client.id}:${runtime.providerId}:${input}`
    },
  }),
})

expectTypeOf(singleProvider.ownership).toEqualTypeOf<'single-turn'>()
expectTypeOf(singleProvider.ownership).toMatchTypeOf<ProviderOwnership>()

const singleRuntime = singleProvider.create(singleClient, { tenant: 'acme' })
expectTypeOf(singleRuntime).toMatchTypeOf<
  CruxAdapter<SingleClient, SingleRawResponse, SingleStream, SingleExtra> & {
    embedding(input: string): string
  }
>()
expectTypeOf(singleProvider.helpers({ tenant: 'acme' }).createGenerateTextFn).toBeFunction()
// @ts-expect-error - private provider media hooks never appear on public runtime records.
singleRuntime.media
// @ts-expect-error - capability discovery is intentionally not a public runtime API.
singleRuntime.capabilities()

void singleRuntime.generate(prompt, {
  model: 'single-model',
  extra: { feature: true },
})

const singleConformanceHarness = {
  capabilities: { ownership: 'single-turn' },
  prepare: () => ({
    client: singleClient,
    model: 'single-model',
    deps: { tenant: 'acme' },
  }),
} satisfies ProviderRuntimeConformanceHarness<SingleClient, string, SingleDeps>

expectTypeOf(providerRuntimeConformance(singleProvider, singleConformanceHarness)).toEqualTypeOf<
  Promise<ConformanceViolation[]>
>()

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
declare const loopStream: ExecutorProviderStreamHandle<LoopRawStream>

const loopContract = {
  describeModel(model: LoopModel): ModelInfo {
    return { provider: model.provider, modelId: model.modelId }
  },
  settings: () => ({}),
  media: {
    validate: () => [],
    estimateTokens: () => undefined,
  },
  bind(client: LoopClient) {
    expectTypeOf(client).toEqualTypeOf<LoopClient>()
    return {
      runTextLoop: async (request: ExecutorRequest<LoopModel>) => {
        expectTypeOf(request.model).toEqualTypeOf<LoopModel>()
        return loopOutcome
      },
      runStructuredAttempt: async () => loopStructured,
      runStream: async () => loopStream,
    }
  },
} satisfies LoopOwnedRuntimeContract<LoopClient, LoopModel, LoopRawResponse, LoopRawStream>

const loopProvider = defineProviderRuntime({
  id: 'typed-loop',
  ownership: 'loop-owned',
  loop: loopContract,
})

expectTypeOf(loopProvider.ownership).toEqualTypeOf<'loop-owned'>()
expectTypeOf(loopProvider.ownership).toMatchTypeOf<ProviderOwnership>()

const loopConformanceHarness = {
  capabilities: { ownership: 'loop-owned' },
  prepare: () => ({ client: loopClient, model: loopModel }),
} satisfies ProviderRuntimeConformanceHarness<LoopClient, LoopModel>

expectTypeOf(providerRuntimeConformance(loopProvider, loopConformanceHarness)).toEqualTypeOf<
  Promise<ConformanceViolation[]>
>()

// Negative cases pass the invalid spec as a pre-built identifier so the
// "no overload matches" diagnostic lands on the single call-argument line that
// `@ts-expect-error` covers. Inline object literals attach the overload error to
// nested property lines (and report against the last overload), which differs
// between tsc and tsgo and leaves the directive on the wrong line.
const singleOwnershipMismatch = {
  id: 'typed-single-ownership-mismatch',
  ownership: 'single-turn' as const,
  loop: loopContract,
}
// @ts-expect-error - single-turn ownership requires turn mechanics, not loop mechanics.
defineProviderRuntime(singleOwnershipMismatch)

const loopOwnershipMismatch = {
  id: 'typed-loop-ownership-mismatch',
  ownership: 'loop-owned' as const,
  turn: turnContract,
}
// @ts-expect-error - loop-owned ownership requires loop mechanics, not turn mechanics.
defineProviderRuntime(loopOwnershipMismatch)

const singleMutualExclusion = {
  id: 'typed-single-mutual-exclusion',
  ownership: 'single-turn' as const,
  turn: turnContract,
  loop: loopContract,
}
// @ts-expect-error - single-turn ownership still forbids loop mechanics.
defineProviderRuntime(singleMutualExclusion)

const loopMutualExclusion = {
  id: 'typed-loop-mutual-exclusion',
  ownership: 'loop-owned' as const,
  turn: turnContract,
  loop: loopContract,
}
// @ts-expect-error - loop-owned ownership still forbids turn mechanics.
defineProviderRuntime(loopMutualExclusion)

const loopRuntimeCollision = {
  id: 'typed-loop-collision',
  loop: {
    describeModel(model: LoopModel): ModelInfo {
      return { provider: model.provider, modelId: model.modelId }
    },
    settings: () => ({}),
    bind: () => ({
      runTextLoop: async () => loopOutcome,
      runStructuredAttempt: async () => loopStructured,
      runStream: async () => loopStream,
    }),
  },
  extend: () => ({
    generate() {
      return 'extension generate'
    },
  }),
}
// @ts-expect-error - provider runtime extensions cannot replace generated runtime members.
defineProviderRuntime(loopRuntimeCollision)

const loopRuntime = loopProvider.create(loopClient)
expectTypeOf(loopRuntime).toMatchTypeOf<CruxExecutor<LoopModel, LoopRawResponse, LoopRawStream>>()
// @ts-expect-error - private provider media hooks never appear on public loop runtimes.
loopRuntime.media
// @ts-expect-error - capability discovery is intentionally not a public loop API.
loopRuntime.capabilities()

void (undefined as unknown as CapabilityReport)

void loopRuntime.generate(prompt, {
  model: loopModel,
  input: {},
})

// @ts-expect-error - loop-owned model inference rejects unrelated model shapes.
void loopRuntime.generate(prompt, { model: 'loop-model' })

// Keep the imported Zod namespace type visible for stream schema compatibility.
expectTypeOf<z.ZodType>().not.toEqualTypeOf<never>()
