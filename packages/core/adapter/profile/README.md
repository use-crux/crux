# Adapter Profiles

`@crux/core/adapter/profile` is the public authoring layer for Crux generation runtimes. It gives adapter packages one small profile object while compiling back into Crux's execution IR:

- `nativeChat()` compiles provider-owned request, transcript, response, stream, settings, schema, and dependency hooks into the core-driven `AdapterSpec` path.
- `sdkLoop()` compiles SDK-owned loop hooks into the `ExecutorSpec` path for runtimes such as the Vercel AI SDK.
- `defineAdapterProfile()` binds a stable profile id to a driver and returns `{ id, create(client, deps?) }`.

Core still owns prompt resolution, routing, validation retry, constraints, guardrails, tool approvals, instrumentation, timeouts, memory capture, and stream safety. Profile drivers only adapt provider or SDK mechanics.

## Native Chat Providers

Use `nativeChat()` for SDKs that expose single-turn chat calls and leave tool execution to Crux.

```ts
import { defineAdapterProfile, nativeChat } from '@crux/core/adapter/profile'

export const myProviderProfile = defineAdapterProfile({
  id: 'my-provider',
  driver: nativeChat({
    bind: (client) => ({
      call: (request) => client.chat.create(request),
      stream: (request) => client.chat.stream(request),
    }),
    request: (args) => ({
      model: args.model,
      messages: args.providerMessages,
      ...args.settings,
    }),
    response: {
      meta: (raw) => ({
        usage: raw.usage,
        finishReason: raw.finish_reason,
        responseId: raw.id,
        actualModelId: raw.model,
      }),
    },
    stream: {
      textDelta: (chunk) => chunk.delta,
    },
    settings: (settings) => settings,
    transcript: myTranscript,
  }),
})

export const createMyProvider = myProviderProfile.create
```

Provider packages should export the profile and their `createX()` factory. Native-chat driver helpers can also create provider-native `GenerateTextFn` and `GenerateObjectFn` helpers for compaction/scoring APIs:

```ts
const myProviderDriver = nativeChat({ bind, request, response, stream, settings, transcript })

export const myProviderProfile = defineAdapterProfile({
  id: 'my-provider',
  driver: myProviderDriver,
})

export const myProviderHelpers = myProviderDriver.helpers('my-provider')
```

Those helpers are intentionally smaller than adapter `generate()`: no prompt resolution, policy sessions, memory, cassettes, or observability.

## SDK-Loop Runtimes

Use `sdkLoop()` for SDKs that own their own multi-step model/tool loop.

```ts
import { defineAdapterProfile, sdkLoop } from '@crux/core/adapter/profile'

export const mySdkProfile = defineAdapterProfile({
  id: 'my-sdk',
  describeModel: (model) => ({ provider: model.provider, modelId: model.modelId }),
  driver: sdkLoop({
    settings: mapSettings,
    runLoop,
    attemptStructured,
    runStream,
    replayStream,
  }),
})
```

`describeModel` should be cheap and side-effect free. It is used for routing labels, prompt adaptation, and provider-specific settings before the SDK loop receives a request.
