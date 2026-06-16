/**
 * Compile-time contract checks for `@crux/core/adapter/native-chat`.
 *
 * These run under `tsc --noEmit` so package export and generic inference drift
 * fails the core typecheck, not just the runtime Vitest suite.
 */

import { expectTypeOf } from 'vitest'
import { defineNativeChatProvider } from '@crux/core/adapter/native-chat'
import type {
  NativeCallMode,
  NativeChatHelpers,
  NativeChatProfile,
  NativeChatProvider,
  NativeChatRequestContext,
  NativeMessageCodec,
  NativeProviderDepsArg,
  NativeProviderPort,
} from '@crux/core/adapter/native-chat'
import type { AdapterResponse, AdapterSpec, CallArgs } from '@crux/core/adapter'

interface SurfaceRequest {
  readonly model: string
  readonly cacheKey: string
}

interface SurfaceRawResponse {
  readonly text: string
}

interface SurfaceStream extends AsyncIterable<{ readonly delta: string }> {}

interface SurfaceExtra extends Record<string, unknown> {
  readonly feature?: boolean
}

interface SurfaceDeps extends Record<string, unknown> {
  readonly cacheKey: string
}

interface SurfaceClient {
  readonly call: (request: SurfaceRequest) => Promise<SurfaceRawResponse>
}

interface SurfaceProviderMessage {
  readonly role: 'user'
  readonly text: string
}

const typedSurfaceMessages = {
  fromCrux: () => [{ role: 'user', text: 'hello' }],
  toCrux: () => [],
} satisfies NativeMessageCodec<SurfaceProviderMessage>
void typedSurfaceMessages

const surfaceMessages = {
  fromCrux: () => [],
  toCrux: () => [],
} satisfies NativeMessageCodec

const surfaceProfile = {
  providerId: 'surface',
  request(args, ctx) {
    expectTypeOf(args).toMatchTypeOf<CallArgs<SurfaceExtra>>()
    expectTypeOf(ctx).toMatchTypeOf<NativeChatRequestContext<SurfaceDeps>>()

    return {
      model: args.model,
      cacheKey: ctx.deps.cacheKey,
    }
  },
  response(raw): AdapterResponse {
    return {
      text: raw.text,
      toolCalls: undefined,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      finishReason: 'stop',
      responseId: undefined,
      actualModelId: undefined,
    }
  },
  stream: {
    textDelta(chunk) {
      return typeof chunk === 'object' && chunk !== null && 'delta' in chunk
        ? String((chunk as { readonly delta: unknown }).delta)
        : undefined
    },
  },
  settings: () => ({}),
  messages: surfaceMessages,
} satisfies NativeChatProfile<SurfaceRequest, SurfaceRawResponse, SurfaceStream, SurfaceExtra, SurfaceDeps>

function bindSurfaceClient(
  client: SurfaceClient,
): NativeProviderPort<SurfaceRequest, SurfaceRawResponse, SurfaceStream> {
  return {
    call: (request) => client.call(request),
    stream: async () => emptySurfaceStream(),
  }
}

function emptySurfaceStream(): SurfaceStream {
  return {
    async *[Symbol.asyncIterator]() {
      return
    },
  }
}

expectTypeOf<NativeCallMode>().toEqualTypeOf<'text' | 'structured'>()

const provider = defineNativeChatProvider<SurfaceRequest, SurfaceRawResponse, SurfaceStream, SurfaceExtra, SurfaceDeps>(
  surfaceProfile,
)
const typedProvider: NativeChatProvider<SurfaceRequest, SurfaceRawResponse, SurfaceStream, SurfaceExtra, SurfaceDeps> =
  provider
void typedProvider

const deps: NativeProviderDepsArg<SurfaceDeps> = [{ cacheKey: 'cached-prefix' }]
void deps

const spec: AdapterSpec<SurfaceClient, SurfaceRawResponse, SurfaceStream, SurfaceExtra> = provider.specFor(
  bindSurfaceClient,
  { cacheKey: 'cached-prefix' },
)
void spec

const helpers: NativeChatHelpers<SurfaceClient> = provider.helpers(bindSurfaceClient, { cacheKey: 'cached-prefix' })
void helpers

// @ts-expect-error - profile dependencies are required once TDeps is not empty.
provider.specFor(bindSurfaceClient)

// @ts-expect-error - helper dependencies are required once TDeps is not empty.
provider.helpers(bindSurfaceClient)
