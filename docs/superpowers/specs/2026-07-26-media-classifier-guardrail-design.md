# Model-graded media classifier guardrail design

Status: **approved**

Related: [#210](https://github.com/use-crux/crux/issues/210),
[#281](https://github.com/use-crux/crux/issues/281),
[#233](https://github.com/use-crux/crux/issues/233), and
[#196](https://github.com/use-crux/crux/issues/196).

Companion contracts:

- [Type and adapter contract](./2026-07-26-media-classifier-type-and-adapter-contract.md)
- [Evidence and indexing contract](./2026-07-26-media-classifier-evidence-and-indexing-contract.md)
- [Delivery contract](./2026-07-26-media-classifier-delivery-contract.md)

## Summary

Crux has canonical image, audio, video, and file/document parts and can apply
declarative media guardrails to them. It cannot yet ask a multimodal model to
grade the actual media against an application-authored moderation rubric.

This design adds `guardrail.mediaClassifier()`, a provider-neutral strategy
body for model-graded media moderation. Applications attach it to input media,
output media, or a tuple containing both. The strategy evaluates each canonical
media part independently, produces one score for every authored category, and
maps threshold matches to the existing media actions.

The classifier works through the shared `GenerateObjectFn` port. OpenAI,
Anthropic, Google GenAI, and AI SDK implement the same canonical contract; no
provider SDK types or capability tables enter Core. Every implementation
honors the model supplied on each call; no helper keeps a second hidden model.

This is guardrail functionality only. Retryable quality constraints over
generated media are a different lifecycle and are tracked by #281.

## Decision and sequencing

Issue #210 should land before #196.

#196 is a large, independent Runtime/effects design involving receipts,
recovery, persistence, and rollback. #210 instead depends on multimodal
messages, input/output media boundaries, shared structured generation, and
provider media codecs. Those prerequisites have landed. Waiting for #196 would
not reduce implementation risk.

The intended sequence is:

1. Implement #210 as a provider-neutral media guardrail strategy.
2. Exercise it across real input and completed-output media use cases.
3. Design and implement #281 from experience with completed-media evaluation
   and retry ownership.
4. Allow #196 to proceed independently.

## Goals

- Classify canonical image, audio, video, and file/document parts.
- Use caller-defined, non-empty categories rather than a fixed taxonomy.
- Preserve existing guardrail authoring and media action semantics.
- Infer category-keyed threshold overrides without manual generics.
- Distinguish model-judged matches from media that was never inspected.
- Preserve provider, schema, cancellation, and capability error identity.
- Record privacy-safe category, score, and threshold evidence.
- Deliver focused modules through red-green-refactor and provider conformance.

## Non-goals

- Retryable media quality constraints; #281 owns that lifecycle.
- Provider-native moderation endpoints as privileged hooks.
- Random sampling, result caching, or implicit media downloads.
- A generic `onError` or transient-failure fallback policy.
- Per-call threshold/category tuning or batch classification.
- Live multimodal delta classification; #179 owns streaming media.
- Modality-specific authoring sugar; #233 owns that question.

## Current-state findings

- Input and output media boundaries share `MediaPartSubject` across all four
  canonical media kinds.
- `guardrail.media()` is a reusable strategy body, not an all-in-one factory.
- `guardrail.classifier()` is a text callback strategy whose subject, evidence,
  and errors do not fit multimodal model calls.
- Constraints are retryable output assertions and explicitly exclude media.
- `GenerateTextFn` accepts exclusive prompt/messages input;
  `GenerateObjectFn` remains prompt-only.
- All four first-party adapters expose lightweight `GenerateObjectFn` helpers.
- The native OpenAI, Anthropic, and Google helpers currently bind a model at
  construction while the shared port also requires `options.model`; their
  implementations silently ignore that per-call value. The AI SDK helper
  already resolves the per-call model.
- Provider media codecs already use the structurally tagged
  `UnsupportedCapabilityError`.
- `SafetyFinding` cannot represent classifier scores, and several guardrail
  paths currently discard `ctx.findings.add()` calls.

## Chosen API shape

Three shapes were considered:

1. An all-in-one `guardrail.mediaClassifier({ id, on, ... })` factory. This
   conflicts with the existing separation between policy and strategy.
2. A dedicated strategy body. This preserves composition, boundary inference,
   report mode, tuning, and Project Index conventions.
3. A multimodal overload of `guardrail.classifier()`. This hides incompatible
   subjects, options, evidence, and capability behavior behind one name.

Option 2 is selected:

```ts
const mediaModeration = guardrail({
  id: 'media-moderation',
  on: boundary.input.media(),
  run: guardrail.mediaClassifier({
    generate,
    model,
    categories: [
      {
        id: 'sexual-content',
        description: 'Sexual or explicit media or document content.',
      },
      {
        id: 'graphic-violence',
        description: 'Graphic depictions of physical injury or violence.',
      },
    ],
    threshold: 0.8,
    thresholds: {
      'graphic-violence': 0.9,
    },
    action: 'block',
    modalities: ['image', 'video'],
    unsupported: 'block',
  }),
})
```

The same body can target output media or a media-only input/output tuple. The
outer `guardrail()` continues to own `id`, `on`, `category`, and `mode`.

## Execution contract

The existing media visitor invokes a policy once per canonical part:

```text
canonical media part
  -> modality applicability
  -> canonical multimodal structured-generation call
  -> strict score validation
  -> category threshold evaluation
  -> findings and one media guardrail action
```

Rules:

- Omitted `modalities` selects image, audio, video, and file.
- An excluded modality is outside scope, causes no call, and returns `allow`.
- Every included part receives one independent call in stable traversal order.
- V1 does not batch parts.
- The response contains exactly one normalized score per category.
- A category matches when its score meets its override or global threshold.
- No matches returns `allow`.
- Matches return `action`, defaulting to `block`.
- Multiple matches create one part-level action and ordered findings.
- Existing strip and required-group escalation semantics remain unchanged.

The classifier does not cache. A content hash cannot safely identify a mutable
URL or provider-owned file without a broader cache identity. It does not
sample, because random omission creates uninspected holes in a Safety control.
Applications can narrow modalities, compose deterministic local prefilters,
disable the policy, or use report mode.

## Unsupported media and other errors

The option is `unsupported`, not `onUnsupported`: `on*` conventionally denotes
a callback, while this is a declarative policy.

Its values are the existing media actions:

```ts
'allow' | 'warn' | 'block' | 'strip'
```

Throwing is not an action. Omission rethrows the adapter's frozen
`UnsupportedCapabilityError` unchanged. The strategy catches only values
narrowed by `isUnsupportedCapabilityError()`.

Provider, authentication, rate-limit, network, structured-response, schema,
timeout, and abort errors propagate unchanged. There is no `onError` option
and no `MediaClassifierError` wrapper.

The policy handles canonical media capability rejection only. An adapter that
cannot provide structured output throws its existing structured-output error;
that failure is not converted into an unsupported-media action.

Explicit `allow` avoids pushing fail-open users toward a broad `try/catch` that
would also catch infrastructure failures and lose the Safety audit. A
policy-derived action never fabricates a category or score. It records
`media_not_inspected`; block/warn/strip reasons use only existing privacy-safe
capability fields.

Known unsupported combinations fail before provider I/O. An opaque/unknown
model may still reach the provider and produce an ordinary provider error,
which is not converted into the unsupported policy.

## Report mode and tuning

Report behavior stays on the outer guardrail:

```ts
guardrail({
  id: 'media-moderation',
  on: boundary.input.media(),
  mode: 'report',
  run: guardrail.mediaClassifier({
    generate,
    model,
    categories,
    threshold: 0.8,
    unsupported: 'block',
  }),
})
```

Report mode runs classification and records the authored action and findings,
but does not enforce block or strip. Errors still propagate. Shadow-testing
unsupported media therefore requires an explicit unsupported action plus
report mode.

Existing per-call `safety.tune` remains limited to `mode` and `enabled`.
`enabled: false` avoids classifier cost. Thresholds, categories, sampling, and
model selection remain authored policy rather than invisible call-site
overrides.

## Success criteria

- One strategy body works unchanged on input media, output media, or both.
- All canonical media kinds are in scope by default.
- Every included part receives exactly one provider-neutral classifier call.
- Category IDs infer threshold keys without explicit generics.
- Matches produce deterministic actions and privacy-safe findings.
- Excluded, unsupported, and failed generation remain distinct.
- All first-party adapters implement the same canonical contract.
- Provider errors and aborts retain their identity.
- Explicit fail-open remains visible in the audit.
- Report mode records intent without enforcement.
- Core contains no provider SDK types, hidden I/O, sampling, or cache.
- #210 lands independently before #196; #281 remains the constraint follow-up.
