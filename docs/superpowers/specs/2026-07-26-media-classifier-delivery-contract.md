# Media classifier delivery contract

Status: **approved companion to the
[media classifier design](./2026-07-26-media-classifier-guardrail-design.md)**

## Module boundaries

The strategy is a dedicated deep module:

```text
packages/core/src/safety/guardrail/strategies/media-classifier/
  index.ts       public factory and exports
  types.ts       public and normalized internal types
  config.ts      validation and frozen normalized config
  prompt.ts      prompt version, system prompt, and rubric
  schema.ts      strict category-keyed score schema
  classify.ts    canonical messages and generation call
  evaluate.ts    thresholds, findings, reasons, and actions
```

Shared finding collection lives separately:

```text
packages/core/src/safety/guardrail/findings.ts
```

`guardrail/types.ts` is already close to 300 lines. Its runtime result
validators and private helpers move to `guardrail/result-validation.ts` before
adding public fields. `guardrail/observability.ts` delegates finding projection
rather than absorbing another concern.

The existing 400-plus-line `guardrail.test.ts` receives no new classifier
cases. Focused test files cover the new behavior. Provider packages extend
their existing structured-generation helpers and media codecs; they do not
gain Safety implementations.

## TDD sequence

Implementation follows vertical red-green-refactor slices:

1. **Shared port and inference**
   - Add failing type tests for exclusive prompt/messages input.
   - Add failing tests for non-empty categories, inferred threshold keys,
     action vocabularies, and media-boundary compatibility.
   - Widen `GenerateObjectFn` and add public types with complete JSDoc.
2. **Provider conformance**
   - Add failing structured-media request tests for OpenAI, Anthropic, Google
     GenAI, and AI SDK.
   - Add failing native-helper tests proving `options.model` is honored and an
     unusable model is rejected before provider I/O.
   - Remove native constructor model binding and update internal retrieval
     extensions to construct unbound helpers.
   - Map canonical messages through existing codecs.
   - Prove known unsupported combinations fail before provider I/O and native
     provider errors retain identity.
3. **Classifier tracer bullet**
   - Attach one input-image classifier guardrail.
   - Produce one valid score object.
   - Block on a match and allow below threshold.
4. **Configuration and evaluation**
   - Cover validation, frozen metadata, defaults, overrides, multiple matches,
     ordering, deterministic reasons, safe category-id grammar, and hostile
     object-key cases.
5. **Capability and errors**
   - Cover omitted unsupported policy and explicit allow/warn/block/strip.
   - Prove provider, schema, timeout, and abort failures propagate unchanged.
6. **Finding plumbing**
   - Start with a regression test proving context findings are lost.
   - Replace no-op collectors and project findings into audit, decisions,
     artifacts, and Devtools.
   - Cover unsupported fail-open evidence.
7. **Lifecycle parity**
   - Cover input/output image, audio, video, and file/document parts.
   - Cover multiple parts, modality narrowing, report mode, disabled tuning,
     strip invariants, and escalation.
   - Prove one classifier call per included part and no hidden materialization.
   - Prove original `providerOptions` are not forwarded to the classifier.
8. **Project Index**
   - Add helper-kind extraction and safe literal projection.
   - Update Rust/Oxc and semantic-backend parity fixtures.
   - Apply the required cache-identity decision.
9. **Documentation and migration**
   - Add Safety guide/reference examples for every first-party adapter.
   - Document third-party port migration and bridge recursion risk.

Each slice begins with one failing behavior or type test, adds only enough code
to pass, and refactors while green. Provider tests use fake clients and make no
network calls.

## JSDoc

Public types and helpers require:

- a one-sentence semantic summary;
- `@default` for every optional default;
- `@throws` for configuration and execution failures;
- `@param` and `@returns` on the strategy factory;
- input-media and output-media/report examples;
- file/document terminology guidance;
- explicit unsupported versus excluded-modality behavior;
- cross-references to `UnsupportedCapabilityError` and both media boundaries;
  and
- a bridge warning about full lifecycle execution and recursive Safety.

Examples present OpenAI, Anthropic, Google GenAI, and AI SDK as equal
implementations of the Crux port. AI SDK and Next.js inform the explicit,
discoverable option and documentation style; neither defines Core.

## Release

Before adding a changeset, inspect every pending `.changeset/*.md` and extend
an existing release-theme entry when appropriate.

The `GenerateObjectFn` widening is source-breaking for third-party
implementers and therefore receives the repository's breaking-change
classification for `@use-crux/core`. The release note also calls out removal
of the native helpers' constructor model argument and shows the per-call
replacement. First-party adapters gain public multimodal structured-generation
behavior and are included according to their direct impact and the
fixed-package Changesets configuration.

No changeset is required for these design documents alone.

## Verification

Focused verification runs after every slice. Final verification includes:

- Core classifier, finding, lifecycle, and compaction bridge tests;
- OpenAI, Anthropic, Google GenAI, and AI SDK helper tests;
- all five affected package typechecks and tests;
- TypeScript 5.5 and TypeScript 6 compatibility checks;
- Indexer Rust/Oxc and semantic-native parity tests;
- Devtools guardrail-report projection tests;
- repository `make typecheck` and `make test`;
- documentation build; and
- `make build` when Indexer/static-worker output changes.
