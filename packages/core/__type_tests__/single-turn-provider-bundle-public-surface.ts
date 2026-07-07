/**
 * Compile-time contract checks for single-turn provider bundles.
 */

import { expectTypeOf } from 'vitest'
import {
  defineSingleTurnProviderBundle,
  type CruxAdapter,
  type NativeProviderPort,
  type SingleTurnProviderBundleSpec,
} from '@use-crux/core/adapter'
import type { Message } from '../generation/messages'

interface BundleRequest {
  readonly model: string
  readonly tenant: string
}

interface BundleRawResponse {
  readonly text: string
}

interface BundleStream extends AsyncIterable<{ readonly delta: string }> {}

interface BundleExtra extends Record<string, unknown> {
  readonly feature?: boolean
}

interface BundleDeps extends Record<string, unknown> {
  readonly tenant: string
}

interface BundleClient {
  readonly id: string
}

interface BundleProviderMessage {
  readonly role: Message['role']
  readonly text: string
}

declare const bundleClient: BundleClient
declare const bundleStream: BundleStream

const bindBundle = (
  _client: BundleClient,
): NativeProviderPort<BundleRequest, BundleRawResponse, BundleStream> => ({
  call: async () => ({ text: 'ok' }),
  stream: async () => bundleStream,
})

const bundleProfile = {
  request(args, ctx) {
    expectTypeOf(args.extra).toEqualTypeOf<BundleExtra>()
    expectTypeOf(ctx.deps).toEqualTypeOf<BundleDeps>()
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
} satisfies SingleTurnProviderBundleSpec<
  BundleClient,
  BundleRequest,
  BundleRawResponse,
  BundleStream,
  BundleExtra,
  BundleDeps,
  BundleProviderMessage
>['profile']

const singleBundle = defineSingleTurnProviderBundle({
  id: 'typed-single-bundle',
  bind: bindBundle,
  profile: bundleProfile,
  deps: {
    create: (_client: BundleClient, tenant: string): BundleDeps => ({ tenant }),
    helpers: (tenant: string): BundleDeps => ({ tenant }),
  },
  extend: ({ runtime }) => ({
    describeProvider() {
      return runtime.providerId
    },
  }),
})

expectTypeOf(singleBundle.ownership).toEqualTypeOf<'single-turn'>()
expectTypeOf(singleBundle.runtime.ownership).toEqualTypeOf<'single-turn'>()

const bundledRuntime = singleBundle.create(bundleClient, 'acme')
expectTypeOf(bundledRuntime).toMatchTypeOf<
  CruxAdapter<BundleClient, BundleRawResponse, BundleStream, BundleExtra> & {
    describeProvider(): string
  }
>()
expectTypeOf(singleBundle.helpers('acme').createGenerateObjectFn).toBeFunction()
expectTypeOf(singleBundle.runtime.create(bundleClient, { tenant: 'acme' })).toMatchTypeOf<
  CruxAdapter<BundleClient, BundleRawResponse, BundleStream, BundleExtra>
>()

// @ts-expect-error - bundle create uses public mapped args, not the raw deps object.
singleBundle.create(bundleClient, { tenant: 'acme' })

// @ts-expect-error - bundle helper args preserve the mapped helper signature.
singleBundle.helpers({ tenant: 'acme' })

defineSingleTurnProviderBundle({
  id: 'typed-single-bundle-collision',
  bind: bindBundle,
  profile: bundleProfile,
  // @ts-expect-error - bundle extensions cannot replace generated runtime members.
  extend: () => ({
    generate() {
      return 'extension generate'
    },
  }),
})
