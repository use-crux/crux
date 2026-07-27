# Media classifier guardrail — TDD implementation plan

Status: **ready to implement**

Specifications:

- [Design](../specs/2026-07-26-media-classifier-guardrail-design.md)
- [Type and adapter contract](../specs/2026-07-26-media-classifier-type-and-adapter-contract.md)
- [Evidence and indexing contract](../specs/2026-07-26-media-classifier-evidence-and-indexing-contract.md)
- [Delivery contract](../specs/2026-07-26-media-classifier-delivery-contract.md)
- [Lifecycle, indexing, and release work order](./2026-07-26-media-classifier-delivery-plan.md)

This plan implements #210 before the independent #196. Generated-media quality
constraints remain in #281.

## Operating protocol

Work in the order below. Every task uses red-green-refactor:

1. Add the smallest focused failing runtime or type test.
2. Run only that test and confirm it fails for the intended reason.
3. Add the minimum production behavior.
4. Run the focused test until green.
5. Refactor names, JSDoc, and module boundaries while green.
6. Run the affected package typecheck before moving on.

Do not weaken assertions to obtain green. Provider tests use fake clients and
perform no network I/O. Keep new source and test files below 300 lines. When an
existing large module must change, first extract the concern being edited.

## Task 0: establish the baseline

Read all pending `.changeset/*.md` files and record whether one already owns
this release theme. Run:

```sh
pnpm --filter @use-crux/core exec vitest run \
  __tests__/compaction/generate-object-bridge.test.ts \
  __tests__/safety/media-strategy-composition.test.ts
pnpm --filter @use-crux/openai exec vitest run __tests__/generate-object-fn.test.ts
pnpm --filter @use-crux/anthropic exec vitest run __tests__/generate-object-fn.test.ts
pnpm --filter @use-crux/google exec vitest run __tests__/generate-object-fn.test.ts
pnpm --filter @use-crux/ai exec vitest run __tests__/structured-generation.test.ts
```

Stop and diagnose unrelated baseline failures before changing behavior.

## Task 1: widen the shared structured-generation port

**Red**

- Add `packages/core/__type_tests__/generate-object-messages.ts`.
- Extend
  `packages/core/__tests__/compaction/generate-object-bridge.test.ts`.
- Assert exclusive `prompt`/`messages`, readonly canonical messages, rejection
  of both/neither inputs, and bridge preservation of media parts.

Run:

```sh
pnpm --filter @use-crux/core typecheck
pnpm --filter @use-crux/core exec vitest run \
  __tests__/compaction/generate-object-bridge.test.ts
```

**Green/refactor**

- Update `packages/core/src/compaction/types.ts` with documented common and
  exclusive input types for `GenerateObjectFn`.
- Update `packages/core/src/compaction/generate-object.ts` so the adapter-backed
  bridge builds the synthetic prompt from either canonical input form.
- Keep the bridge warning explicit: it invokes the full prompt lifecycle and
  must not recursively attach the same guardrail.
- Export only the public types users need from
  `packages/core/src/compaction/index.ts`.

## Task 2: make native model selection single-source

**Red**

- Extend `packages/core/__tests__/adapter/native-chat.test.ts`.
- Prove `createGenerateObjectFn(client)` uses each call's `options.model`.
- Prove a non-string, empty, or whitespace model throws an actionable
  `TypeError` before request construction and provider I/O.
- Prove provider, schema, and structured-output errors retain identity.

**Green/refactor**

- Add `packages/core/src/adapter/native-chat/helper-types.ts`; move helper
  contracts out of the already-large `native-chat/types.ts`.
- Add `packages/core/src/adapter/native-chat/helpers.ts`; move helper
  construction out of the already-large
  `define-native-chat-provider.ts`.
- Change only object generation to
  `createGenerateObjectFn(client): GenerateObjectFn`; text generation keeps
  its current bound signature.
- Resolve and validate `options.model` per object call.
- Pass exclusive prompt/messages through `helperCallArgs`.
- Re-export the extracted internals through
  `packages/core/src/adapter/native-chat/index.ts` only where public.

Run:

```sh
pnpm --filter @use-crux/core exec vitest run __tests__/adapter/native-chat.test.ts
pnpm --filter @use-crux/core typecheck
```

## Task 3: enforce adapter conformance

**Red**

Extend these focused tests:

- `packages/openai/__tests__/generate-object-fn.test.ts`
- `packages/anthropic/__tests__/generate-object-fn.test.ts`
- `packages/google/__tests__/generate-object-fn.test.ts`
- `packages/ai/__tests__/structured-generation.test.ts`

For every adapter, assert canonical image, audio, video, and file/document
message encoding through the existing codec. Assert model selection, stable
part order, source/MIME/filename preservation, and no `providerOptions`.
Assert known unsupported media fails before fake-client I/O.

**Green/refactor**

- Update `packages/{openai,anthropic,google}/src/helpers.ts` to expose unbound
  object helpers.
- Update the native helper uses in
  `packages/{openai,anthropic,google}/src/native.ts`; their retrieval
  extensions already pass `model` per call.
- Update `packages/ai/src/structured-generation.ts` to accept exclusive
  prompt/messages and pass canonical messages into its structured request.
- Reuse provider media codecs; do not add Safety logic or capability tables to
  provider packages.

Run each provider test, then its `typecheck` script.

## Task 4: land the classifier type surface and normalized config

**Red**

- Add `packages/core/__type_tests__/safety-media-classifier-contract.ts`.
- Add `packages/core/__tests__/safety/media-classifier-config.test.ts`.
- Cover non-empty const categories, inferred threshold keys, unknown keys,
  media-only boundary compatibility, action vocabularies, defaults, category
  ID grammar, duplicate IDs, trimmed descriptions, finite thresholds,
  modalities, hostile object keys, and deep freezing.

**Green/refactor**

Create:

```text
packages/core/src/safety/guardrail/strategies/media-classifier/
  types.ts
  config.ts
  index.ts
```

- Keep the const generic localized to the public factory.
- Normalize into immutable internal data once.
- Put only JSON-safe values in frozen strategy metadata.
- Exclude `generate`, `model`, descriptions, and media from metadata.
- Add complete JSDoc: semantic summary, defaults, throws, params, returns,
  input/output examples, document terminology, and relevant cross-links.
- Wire exports through `guardrail/strategies/index.ts`,
  `guardrail/define.ts`, `guardrail/index.ts`, and `safety/index.ts`.

## Task 5: implement one-part classification

**Red**

- Add `packages/core/__tests__/safety/media-classifier.test.ts`.
- Start with one input image: exact canonical message, exact category-keyed
  schema, allow below threshold, block at the inclusive threshold.
- Then cover overrides, ordered multiple matches, one finding per match,
  deterministic reason text, and malformed/missing/extra/non-finite scores.

**Green/refactor**

Add focused modules:

```text
packages/core/src/safety/guardrail/strategies/media-classifier/
  prompt.ts
  schema.ts
  classify.ts
  evaluate.ts
```

- Version the system prompt with `MEDIA_CLASSIFIER_PROMPT_VERSION`.
- Treat media, filename, document text, and rubric-adjacent content as
  untrusted evidence.
- Send rubric text followed by exactly one sanitized canonical media part.
- Build a strict score-only schema and validate the returned value again in
  Core.
- Never request, accept, retain, or synthesize a model explanation.

## Task 6: preserve capability and error semantics

**Red**

Add `packages/core/__tests__/safety/media-classifier-errors.test.ts` covering:

- omitted `unsupported` rethrows the same `UnsupportedCapabilityError`;
- explicit allow/warn/block/strip catches only media capability rejection;
- handled capability gaps emit `media_not_inspected` without category/score;
- structured-output unsupported, provider, auth, rate-limit, schema, timeout,
  and abort errors bubble by identity; and
- excluded modalities make no call and produce ordinary allow.

**Green**

- Narrow only with `isUnsupportedCapabilityError()`.
- Keep `unsupported` declarative; do not introduce `onError` or a wrapper error.
- Derive unsupported reasons only from privacy-safe capability fields.

## Task 7: repair and project findings

**Red**

- Add `packages/core/__tests__/safety/guardrail-findings.test.ts`.
- First prove existing `guardrail.classifier()` findings disappear.
- Then specify stable collector/result merge order, validation, freezing,
  audit projection, canonical decisions, report artifacts, Devtools output,
  and bounded OTel counts.
- Assert malformed findings fail closed with `SafetyResultError`.

**Green/refactor**

- Add `packages/core/src/safety/guardrail/findings.ts`.
- Add category/score/threshold to `SafetyFinding` in
  `packages/core/src/safety/decision.ts`.
- Add findings to `GuardrailAuditEntry`.
- Extract runtime validators from the near-300-line
  `guardrail/types.ts` into `guardrail/result-validation.ts`.
- Replace no-op collectors in `guardrail/run-guard.ts` and
  `safety/media/evaluation.ts` with one collector per invocation.
- Thread findings through block decisions, audit freezing, report artifacts,
  and `observability/turn-decision-report/safety.ts`.
- Extract finding projection from `guardrail/observability.ts` rather than
  growing that file.
- OTel receives `findingCount` and `matchedCategoryCount`, never category IDs,
  scores, descriptions, filenames, URLs, bytes, or provider identifiers.

Run the new regression test plus existing text classifier, media observability,
Devtools serializer, and decision-report tests.

Continue with the
[lifecycle, indexing, and release work order](./2026-07-26-media-classifier-delivery-plan.md)
only after Tasks 1–7 are green together.
