# Bounded media streaming design

Status: **approved**

Related: [#199](https://github.com/use-crux/crux/issues/199),
[#284](https://github.com/use-crux/crux/issues/284),
[#285](https://github.com/use-crux/crux/issues/285), generated images,
generated speech, completed-operation Safety, routing, and managed logical
streams.

Implementation:
[TDD work order](../plans/2026-07-27-bounded-media-streaming.md).

Safety:
[streaming media Safety contract](./2026-07-27-bounded-media-streaming-safety-contract.md).

## Summary

Crux adds explicit `streamImage()` and `streamSpeech()` operations for
providers that expose genuine bounded media streams. Completed
`generateImage()` and `generateSpeech()` remain the default and keep their
current inputs and results.

The streaming operations expose provider-neutral progressive events and a
completion with the exact existing completed result:

```ts
const result = await openai.streamImage({
  model: "gpt-image-model",
  prompt: "A quiet canal at sunrise",
});

for await (const event of result.fullStream) {
  if (event.type === "image-preview") render(event.image);
}

const final = await result.completion;
await assetStore.put(final.image);
```

Crux owns lifecycle, Safety, routing, correlation, observability, and final
validation. Provider packages own native invocation and typed translation.
Providers without genuine progressive output structurally omit the operation.

## Scope

The initial implementation includes:

- `streamImage()` in `@use-crux/core`, `@use-crux/openai`, and
  `@use-crux/google`;
- `streamSpeech()` in the same packages;
- canonical preview, byte-delta, final-asset, start, and finish events;
- eager execution with replayable public streams;
- full input and output Safety integration;
- retry and fallback before public commitment;
- existing cancellation and timeout semantics;
- safe observability, Devtools progress, and final quality reporting; and
- provider conformance tests proving OpenAI and Google use native streams.

The initial implementation excludes:

- transcription streaming;
- realtime or bidirectional audio sessions;
- turn detection, interruption, and barge-in;
- video streaming;
- public provider-native progressive events;
- implicit persistence, replay storage, or caching; and
- simulated streaming from completed results.

Transcription ([#284](https://github.com/use-crux/crux/issues/284)) and public
native-event access ([#285](https://github.com/use-crux/crux/issues/285)) are
separate follow-up RFCs.

## Public contracts

The result shape is shared but event vocabularies remain operation-specific:

```ts
export interface StreamingOperationResult<TEvent, TResult> {
  /** Identity of the logical operation. */
  readonly runId: CruxRunId;
  /** Correlation for the owning media-stream span. */
  readonly _meta: OperationResultMeta;
  /** Replayable canonical events for the logical operation. */
  readonly fullStream: AsyncIterableStream<TEvent>;
  /** Exact completed-operation result after validation and Safety. */
  readonly completion: Promise<TResult>;
  /** Abort the whole logical operation and its active physical attempt. */
  cancel(reason?: unknown): void;
}
```

```ts
export type ImageStreamEvent =
  | { readonly type: "start" }
  | {
      readonly type: "image-preview";
      readonly image: Asset;
      readonly outputIndex: number;
      readonly sequence: number;
    }
  | {
      readonly type: "image-delta";
      readonly data: Uint8Array;
      readonly mediaType: string;
      readonly outputIndex: number;
      readonly sequence: number;
    }
  | {
      readonly type: "image";
      readonly image: Asset;
      readonly outputIndex: number;
    }
  | { readonly type: "finish" };

export type SpeechStreamEvent =
  | { readonly type: "start" }
  | {
      readonly type: "audio-delta";
      readonly data: Uint8Array;
      readonly mediaType: string;
      readonly sequence: number;
    }
  | { readonly type: "audio"; readonly audio: DataAsset }
  | { readonly type: "finish" };
```

`sequence` is zero-based and monotonic within one output. `outputIndex` is the
stable provider output slot, so previews and final images can be associated
even when Safety strips another final image.

`ImageStreamEvent` and `SpeechStreamEvent` are closed provider-neutral unions.
A terminal error is thrown by `fullStream` and rejects `completion` with the
same normalized identity; it is not an event. `finish` exists only for a
successful logical operation.

The concrete result aliases retain provider completion types:

```ts
export type StreamImageResult<TRaw, TMetadata, TWarning> =
  StreamingOperationResult<
    ImageStreamEvent,
    GenerateImageResult<TRaw, TMetadata, TWarning>
  >;

export type StreamSpeechResult<TRaw, TMetadata, TWarning> =
  StreamingOperationResult<
    SpeechStreamEvent,
    GenerateSpeechResult<TRaw, TMetadata, TWarning>
  >;
```

## Execution and replay

Media streams follow the existing managed text-stream mental model:

- provider execution starts eagerly after preflight;
- one append-only logical log retains canonical committed events once;
- every `fullStream` reader owns an independent replay cursor;
- a late reader replays from `start` and then continues live;
- returning early detaches only that reader;
- `completion` settles without requiring a consumer; and
- only `cancel()` or `abortSignal` cancels the logical operation.

Consumer speed does not backpressure provider execution. This is deliberate:
bounded operations must retain their final media in `completion` already.
Implementations reuse chunk buffers when constructing a final `Blob` where
possible and must not create a second base64 or byte copy for replay.

## Progressive and final meaning

`image-preview` is a complete renderable but provisional asset. Each preview
replaces the preceding preview for the same `outputIndex`; it is not an
append-only fragment.

`image-delta` and `audio-delta` are append-only bytes and may not be
independently renderable. Consumers append them in `sequence` order.

`image` and `audio` are emitted only after the native stream finishes, the
provider result validates, and output Safety completes. The objects are shared
with `completion`, not copied. A post-publication provider failure leaves
already published provisional events observable, errors every stream surface,
and rejects `completion`; no provisional event becomes final retroactively.

## Safety

Safety is a binding part of the initial feature, not a later hardening phase.
Streaming operations reuse the existing Safety session, boundary vocabulary,
guardrail modes, findings, tuning, global policies, and immutable audit.
There is no media-stream-specific guardrail API.

The dedicated
[Safety contract](./2026-07-27-bounded-media-streaming-safety-contract.md)
defines input parity, complete-preview evaluation, incomplete-delta
commitment, final retention, routing interaction, provenance, observability,
and required tests.

## Routing, cancellation, and timeouts

All candidates complete normalization and support preflight before provider
I/O. Unsupported operations fail or fall through before opening a stream.

Retry and fallback remain possible until the first canonical public event.
Held or stripped events do not commit the route. Once an allowed preview or
delta publishes, later provider failure terminates the logical stream rather
than mixing media from another provider. Safety blocks and guardrail failures
are terminal policy outcomes and are never retried through another provider.

`totalMs` covers the logical operation across attempts. `stepMs` covers one
physical attempt through its terminal native result. No separate idle timeout
is added initially. `cancel()` and `abortSignal` share whole-operation
authority and reach the active provider signal.

## Native events

Provider-native progressive events remain strongly typed inside each
provider's streaming source and mapper. They do not enter the public event log.
Public raw streaming is deferred because an event may contain media before
Safety can authorize it and because global enforcing policies cannot be
represented reliably in a call-site-only type.

The final `completion.raw`, warnings, and provider metadata preserve the
existing completed-result contract and documentation.
[#285](https://github.com/use-crux/crux/issues/285) decides whether public
native events belong under an explicitly unsafe surface, how they interact
with Safety, and what retention guarantees they receive.

## Observability, quality, and persistence

One logical media-stream span owns the public correlation. Physical attempts
remain child spans. Safe progress includes provider/model identity, routing
commitment, time to first event, duration, event counts, byte counts, media
types, cancellation, timeouts, and terminal classification.

Media bytes, base64, URLs, filenames, hashes, prompts, and native event
payloads never enter spans, hooks, Devtools, decisions, or quality evidence.
Observability receives safe descriptors by construction rather than filtering
result objects after the fact.

Quality/reporting runs once against the final guarded completion. Progressive
events are not persisted, replayed across processes, cached, or scored
implicitly. Callers explicitly persist final assets through their chosen
`AssetStore`.

## Internal architecture

The shared deep module mirrors completed operations:

```text
packages/core/src/adapter/streaming-operation/
  definition.ts
  bind.ts
  result.ts
  runner.ts
  routing.ts
  lifecycle.ts
  observability.ts
  safety/
    image.ts
    speech.ts
    context.ts
  index.ts
```

Domain contracts live in `generation/image-stream-contracts.ts` and
`speech/stream-contracts.ts`. Provider implementations use dedicated
`image-streaming.ts` and `speech-streaming.ts` modules.

`defineStreamingOperation()` infers the model from `TInput["model"]`, while
the binder preserves the completed-operation selected-model routing guard.
The per-call source owns its typed native iterable, mapper state, and terminal
native result. Core owns eager driving, the logical event log, Safety,
commitment, deadlines, cancellation, reporting, and correlation.

The generic `logical-event-log.ts` is reused. Text-specific projections remain
outside the media result. New files stay below 300 lines; lifecycle, Safety,
and observability concerns split before a module crosses that threshold.

## JSDoc and type design

Public documentation leads with observable behavior, then calls out
provisional/final timing, replay ownership, cancellation, routing commitment,
and whether bytes are complete or append-only. Every function includes a
short copyable example. Type parameters are documented only when they affect
inference.

Named result aliases and readonly discriminated unions are preferred over
nested public conditional types. Conditional and mapped types remain local to
model inference, routing guards, and structural capability omission. Type
tests prove exhaustive narrowing and exact completed-result generics.

## Release

The implementation is additive and requires minor changesets for the directly
affected public packages. The design and GitHub RFC edits alone require no
changeset. No Project Index or Eval evidence cache identity changes are
implicated.
