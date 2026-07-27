# Bounded media streaming — TDD implementation plan

Status: **ready to implement**

Specification:
[bounded media streaming design](../specs/2026-07-27-bounded-media-streaming-design.md).

Related: [#199](https://github.com/use-crux/crux/issues/199),
[#284](https://github.com/use-crux/crux/issues/284), and
[#285](https://github.com/use-crux/crux/issues/285).

## Operating protocol

Execute tasks in order. Every behavior follows red-green-refactor:

1. Add one smallest focused runtime or type test.
2. Run it and confirm the intended failure.
3. Add only enough production behavior to pass.
4. Re-run the focused test.
5. Refactor names, JSDoc, and boundaries while green.
6. Run the affected package typecheck before the next slice.

Do not write all tests before implementation. Do not weaken assertions to get
green. Provider tests use fake clients and perform no network I/O. New source
and test files stay below 300 lines. Extract a concern before extending an
existing file beyond that threshold.

## Task 0: baseline and release ownership

Read every pending `.changeset/*.md` except `README.md`. Record whether an
existing release theme owns bounded media streaming; update it later rather
than creating a duplicate.

Run focused baselines:

```sh
pnpm --filter @use-crux/core exec vitest run \
  __tests__/adapter/completed-operation-safety-image.test.ts \
  __tests__/adapter/completed-operation-safety-speech.test.ts \
  __tests__/adapter/stream-coordinator-native.test.ts
pnpm --filter @use-crux/core typecheck
pnpm --filter @use-crux/openai test
pnpm --filter @use-crux/google test
```

Stop and diagnose unrelated failures before changing behavior.

## Task 1: public contracts and definition inference

**Red**

- Add `packages/core/__type_tests__/streaming-media-contracts.ts`.
- Add
  `packages/core/__tests__/adapter/streaming-operation-definition.test.ts`.
- Prove model inference from the input, exact provider metadata/warning/raw
  completion generics, exhaustive event narrowing, readonly fields, routing
  model guards, and structural omission of unsupported operations.
- Prove one frozen in-memory definition can be reused concurrently without
  sharing mapper state.

**Green/refactor**

- Add domain event, result, options, and function types in
  `generation/image-stream-contracts.ts` and `speech/stream-contracts.ts`.
- Add `streaming-operation/definition.ts`, `bind.ts`, and `index.ts`.
- Keep provider-native event types inside the definition/source generic; do
  not add a public raw event union.
- Add complete behavior-first JSDoc and one example per operation.

Run the focused test and `@use-crux/core` typecheck.

## Task 2: eager result and replay lifecycle

**Red**

- Add `streaming-operation-result.test.ts`.
- Prove execution and `completion` settle without a reader.
- Prove simultaneous and late `fullStream` readers receive the same committed
  sequence from `start` through `finish`.
- Prove returning early detaches one reader while `cancel()` fails all readers
  and `completion` with one normalized error.

**Green/refactor**

- Add `streaming-operation/result.ts` on top of
  `adapter/logical-event-log.ts`.
- Add `lifecycle.ts` for terminal state and cancellation ownership.
- Retain event objects once. Reuse byte chunks when assembling final `Blob`
  values; do not base64-encode or concatenate a second replay copy.
- Keep text-specific stream projections unchanged.

## Task 3: input Safety parity

**Red**

- Add focused image and speech input Safety tests.
- Prove image prompt rewrites, blocked references, stripped references, edit
  mask dependencies, speech text rewrites, and blocked instructions all occur
  before provider normalization and fake-client I/O.
- Prove global policies, per-call tuning, findings, and audit behavior match
  completed operations.

**Green/refactor**

- Reuse completed-operation image and speech input Safety helpers through a
  shared operation dispatch rather than copying their logic.
- Compile the Safety session once per logical call before routing.
- Keep provider definitions unaware of guardrail objects and boundaries.

## Task 4: complete image-preview Safety

**Red**

- Add `streaming-operation-safety-image-preview.test.ts`.
- One behavior per test: allow publishes; warn publishes with audit; enforced
  strip suppresses; enforced block fails; report-mode strip publishes.
- Prove a suppressed preview does not commit routing, while the first
  published preview does.
- Prove callback context and safe audit location identify preview phase,
  output slot, and sequence without containing the asset source.

**Green/refactor**

- Add `streaming-operation/safety/image.ts` and `context.ts`.
- Extend media origins for `streamImage` preview/final occurrences.
- Reuse `visitMedia()` with minimum retained zero for one provisional preview.
- Add the optional `ctx.stream.media` provenance without changing existing
  text stream context fields.

## Task 5: incomplete deltas and final Safety

**Red**

- Add separate image-delta and speech-delta Safety tests.
- Prove deltas publish immediately with no enforcing output-media policy.
- Prove report mode leaves deltas live and records decisions on the final
  asset.
- Prove enforcing output-media policies hold deltas and publish only retained
  final events.
- Prove final image strip preserves a non-empty ordered result and required
  speech strip escalates to block.
- Prove final events share their asset objects with `completion`.

**Green/refactor**

- Add `streaming-operation/safety/speech.ts`.
- Reuse completed-operation final image/speech output Safety and immutable
  audit attachment.
- Add an attempt-local release coordinator that retains incomplete events only
  when the compiled Safety session requires terminal media commitment.
- Never pass incomplete bytes to a media guardrail.

## Task 6: routing, timeouts, and failure identity

**Red**

- Add `streaming-operation-routing.test.ts`.
- Prove support preflight happens across candidates before any provider I/O.
- Prove retry/fallback after open but before publication.
- Prove no retry/fallback after a published event.
- Prove Safety rejection is terminal even before publication.
- Prove `totalMs`, `stepMs`, caller abort, and `cancel()` reach the active fake
  source and preserve one error identity across every surface.

**Green/refactor**

- Add `routing.ts`, `runner.ts`, and `runner-types.ts`.
- Reuse completed-operation preflight, deadline, route-description, and
  receipt primitives where their contracts are already generic.
- Keep the publication commit marker in Core, not provider mappers.
- Add no idle timeout and no provider-capability registry.

## Task 7: safe observability and reporting

**Red**

- Add `streaming-operation-observability.test.ts`.
- Prove one logical span with physical attempt children and exact result
  correlation.
- Prove safe counts, media types, first-event timing, commitment, cancellation,
  timeout, and terminal status.
- Search serialized hooks, spans, Devtools events, decisions, and quality
  reports for byte arrays, base64, URLs, filenames, hashes, and native events.
- Prove quality/reporting runs once on the final guarded completion.

**Green/refactor**

- Add `observability.ts` and small safe-descriptor report types.
- Pass descriptors into observability by construction; never pass result or
  event objects into a redaction layer.
- Keep provider reports ID-free and media-free, mirroring
  `defineCompletedOperation()`.

## Task 8: OpenAI native mappings

**Red**

- Add focused OpenAI image and speech streaming tests with fake SDK streams.
- Prove complete image previews map to replacement events, terminal images
  preserve output order, speech chunks map to ordered audio deltas, provider
  completion facts remain exact, and abort reaches the SDK.
- Prove unsupported models or response modes fail before stream I/O.
- Prove completed-only responses are never sliced into fake events.

**Green/refactor**

- Add `packages/openai/src/image-streaming.ts` and
  `speech-streaming.ts`.
- Use the SDK's native image streaming event union and native speech body/event
  transport.
- Keep request normalization and terminal decoding focused and separately
  testable.
- Add the operations to the provider surface only when the client exposes the
  required native mechanism.

Run focused tests and `@use-crux/openai` typecheck.

## Task 9: Google native mappings

**Red**

- Add focused Google image and speech streaming tests with fake SDK streams.
- Prove image byte deltas and speech chunks map in native order, terminal
  assets validate, cancellation propagates, and model-specific unsupported
  requests fail before provider I/O.
- Prove parity of canonical final result keys and Safety behavior with OpenAI.

**Green/refactor**

- Add `packages/google/src/image-streaming.ts` and
  `speech-streaming.ts`.
- Bind only genuine streaming endpoints and supported models.
- Keep the older completed image and speech paths unchanged.
- Do not expose Google interaction/session objects through Core.

Run focused tests and `@use-crux/google` typecheck.

## Task 10: exports, docs, conformance, and release

**Red**

- Add export-shape tests for Core, OpenAI, Google, and the AI SDK adapter.
- Prove `@use-crux/ai` structurally omits unsupported streaming media.
- Add provider conformance cases for image and speech event ordering, final
  results, cancellation, and no fake streaming.
- Add documentation examples for preview replacement, byte assembly, final
  completion, Safety buffering, replay, routing commitment, and persistence.

**Green/refactor**

- Wire only intentional public exports.
- Keep examples short and use exhaustive event switches.
- Document that enforcing output-media policies may retain incomplete deltas,
  while complete image previews remain independently guardable.
- Link transcription RFC #284 and native-event RFC #285.
- Update an existing relevant changeset or add one minor changeset covering
  only `@use-crux/core`, `@use-crux/openai`, and `@use-crux/google`.

Run focused suites, package typechecks, formatting, and the repository's
proportional build target. Confirm every new source and test file remains below
300 lines.
