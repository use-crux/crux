# Content primitive Safety parity design

Status: **approved**

Related: [#209](https://github.com/use-crux/crux/issues/209),
[#228](https://github.com/use-crux/crux/issues/228),
[#207](https://github.com/use-crux/crux/issues/207), canonical multimodal
content, completed media operations, Safety, observability, and Project Index.

## Summary

Crux Safety is currently a language-generation lifecycle rather than a
content-generation invariant. `generate()` and `stream()` create a per-call
Safety session, but the shared completed-operation lifecycle used by
`generateImage()`, `generateSpeech()`, and `transcribe()` does not. Generated
images and audio therefore bypass Crux output guardrails, transcription input
audio bypasses input-media policies, and transcript text bypasses output-text
guardrails and constraints.

This design makes Safety mandatory across every public content-producing
primitive: text generation, streaming, structured generation, image
generation, speech generation, and transcription. Each primitive projects its
canonical inputs and outputs into the same boundary vocabulary. Core executes
the policies and writes permitted changes back into the primitive's canonical
result without delegating Safety behavior to providers.

Issue #228 is the implementation RFC. Issue #209 describes the same capability
but assumes live non-text stream events that Crux does not expose; it should be
closed as superseded when #228 is updated with this design.

## Goals

- Make Safety a lifecycle invariant for every public content-producing
  primitive.
- Add a provider-neutral `boundary.output.media()` authoring surface.
- Run every applicable global, prompt, and call policy on canonical inputs and
  outputs before provider I/O or canonical result exposure.
- Guard every publicly returned language-model step, not only the terminal
  step.
- Keep constraints terminal-output policies and define honest behavior for
  primitives without corrective regeneration.
- Preserve specialized image, speech, transcription, and language result
  contracts after guardrail write-back.
- Keep provider adapters mechanical and incapable of opting out of or
  mis-projecting first-party Safety coverage.
- Preserve privacy-safe audit, observability, Turn Decision Report, and Project
  Index parity.
- Deliver the behavior through vertical TDD slices and focused modules rather
  than enlarging existing orchestration files.

## Non-goals

- A public `describe()` primitive. Applications and Ingest use ordinary
  safety-enabled multimodal `generate()` for descriptions.
- Embedding or reranking Safety.
- Media constraints or corrective regeneration over generated media.
- Image-, audio-, video-, or stream-specific authoring helpers. Those can be
  layered over the canonical media boundary later.
- Live media stream events. Crux exposes live canonical text only; rich media
  arrives through completion content.
- Sanitizing provider-native `.raw` values or raw stream handles.
- Applying Safety to provider metadata or provider warnings.
- Provider-specific moderation APIs as a substitute for Crux policies.

Any internal operation vocabulary that reserves `describe` remains unused by
the public API. It receives no applicability row and cannot opt into this
Safety lifecycle without a separate public API design.

## Current-state findings

- `createSafety()` is constructed in core-step and SDK-loop language
  generation and streaming, but nowhere in the completed-operation runner.
- Completed operations currently perform validation, capability preflight,
  routing, timeouts, provider invocation, safe observability, and reporting.
  They do not build a Safety registry or emit a guardrail/constraint audit.
- Image, speech, and transcription call contracts expose no `guardrails`,
  `constraints`, or `safety` fields.
- Typed image prompts explicitly reject resolved guardrails and constraints.
- `SafetyOutput` contains only `text` and `parsed`; canonical assistant media
  in `GenerateResult.content` is not an output-safety subject.
- Language output guardrails are terminal-output oriented even though the
  public result retains content from every provider step.
- The AI SDK safety transform sees live text deltas. Non-text content is
  buffered into completion metadata, so the live media/text reordering problem
  described by #209 is not present on the canonical public stream.
- Transcription repeats content in `text`, `segments[].text`, and
  `words[].text`; changing only the top-level text would leave an unsafe copy.
- Provider-native `.raw`, provider metadata, and warnings may contain content
  outside canonical Safety. They are explicit escape surfaces, not guarded
  fields.

## Chosen approach: core-owned canonical projections

Three approaches were considered:

1. Add Safety independently to each provider's image, speech, and
   transcription implementation. This is initially quick but duplicates
   ordering, tuning, audit, and write-back semantics and makes provider parity
   fragile.
2. Force completed media operations through language `generate()`. This reuses
   the current session but misrepresents distinct provider endpoints, routing,
   timeout, and result contracts.
3. Add core-owned canonical projections to the shared completed-operation
   lifecycle. Specialized provider endpoints and results remain intact; Core
   alone enumerates canonical inputs and outputs, runs policy, and performs
   validated write-back.

Option 3 is selected. Provider definitions do not receive projection or policy
hooks. Core already owns the canonical first-party operation names, call
contracts, and validated result shapes, so it can guarantee coverage through a
closed internal operation table. A provider cannot silently omit a field from
Safety.

## Public API

### Output media boundary

`SafetyTargetId` gains `model.output.media`, authored through
`boundary.output.media()`:

```ts
const generatedMediaPolicy = guardrail({
  id: 'safe-generated-media',
  on: boundary.output.media(),
  run: (subject, context) => {
    if (subject.part.type === 'image') {
      // subject.part is a canonical image part.
    }

    return { action: 'allow' }
  },
})
```

The boundary is guardrail-only. It accepts `allow`, `warn`, `block`, and
`strip`. It rejects `rewrite`, `hold`, constraints, and stream configuration in
TypeScript and at runtime.

`guardrail.media()` becomes boundary-neutral. The same strategy callback works
with input media, output media, or a tuple containing both:

```ts
const portableMediaPolicy = guardrail({
  id: 'portable-media-policy',
  on: [boundary.input.media(), boundary.output.media()] as const,
  run: guardrail.media({
    mediaTypes: { allow: ['image/png', 'audio/mpeg'] },
    size: { maxBytes: 10_000_000 },
    action: 'block',
  }),
})
```

Media-only tuples are valid. Media/text boundary mixtures remain invalid.

### Unified media subject

Input and output boundaries use one subject. The boundary identifies policy
direction; the subject identifies the canonical location:

```ts
export interface MediaPartSubject {
  /** Canonical image, audio, video, or file part. */
  readonly part: MediaPart
  /** Stable location in the canonical surface being guarded. */
  readonly origin: MediaPartOrigin
}

export type MediaPartOrigin =
  | {
      readonly kind: 'message'
      readonly messageIndex: number
      readonly partIndex: number
    }
  | {
      readonly kind: 'step'
      readonly stepIndex: number
      readonly partIndex: number
    }
  | {
      readonly kind: 'operation'
      readonly operation: 'generateImage'
      readonly phase: 'input'
      readonly field: 'images'
      readonly partIndex: number
    }
  | {
      readonly kind: 'operation'
      readonly operation: 'generateImage'
      readonly phase: 'input'
      readonly field: 'mask'
      readonly partIndex: 0
    }
  | {
      readonly kind: 'operation'
      readonly operation: 'generateImage'
      readonly phase: 'output'
      readonly field: 'images'
      readonly partIndex: number
    }
  | {
      readonly kind: 'operation'
      readonly operation: 'generateSpeech'
      readonly phase: 'output'
      readonly field: 'audio'
      readonly partIndex: 0
    }
  | {
      readonly kind: 'operation'
      readonly operation: 'transcribe'
      readonly phase: 'input'
      readonly field: 'audio'
      readonly partIndex: 0
    }
```

`MediaPartLocation` in audit and decision records carries the same `origin`
plus the safe canonical part discriminant. This intentionally replaces the
recently added top-level `messageIndex` and `partIndex` subject fields before
the asymmetric input-only contract becomes established.

### Completed-operation options

Completed operations use the same call-site vocabulary as language generation:

```ts
await generateImage({
  model,
  prompt,
  guardrails: [portableMediaPolicy],
  safety: { tune: { 'portable-media-policy': { mode: 'enforce' } } },
})

await generateSpeech({
  model,
  text,
  guardrails: [portableMediaPolicy],
  safety: { tune: { 'portable-media-policy': { mode: 'enforce' } } },
})

await transcribe({
  model,
  audio,
  guardrails: [portableMediaPolicy],
  constraints: [transcriptQuality],
  safety: { tune: { 'portable-media-policy': { mode: 'enforce' } } },
})
```

`guardrails` and `safety` belong in `GenerateImageCommonOptions` and directly
in the existing `GenerateSpeechOptions` shape so both operations' model-
selection overloads inherit identical inference without inventing another
speech base type. Transcription also accepts `constraints`. Image and speech do
not accept constraints because no media-constraint boundary exists.
Transcription does not accept `constraintMaxRetries`; its constraints evaluate
exactly once.

Typed image prompts may contribute applicable guardrails. Their current
blanket guardrail rejection is removed. A typed image prompt's constraints
remain invalid because image output has no compatible constraint boundary.

All new public types, fields, and helpers require complete JSDoc with examples,
parameter/return semantics, narrowing guidance, escalation rules, and raw
surface caveats, following the style of `define-adapter.ts` and the AI SDK.

## Boundary applicability

| Primitive             |   User text | Model instructions |         Input media |    Output text |   Output object |    Output media |
| --------------------- | ----------: | -----------------: | ------------------: | -------------: | --------------: | --------------: |
| `generate()`          |         yes |                yes |                 yes |            yes | when structured |   when returned |
| `stream()`            |         yes |                yes |                 yes | live and final | when structured | completion only |
| Structured generation |         yes |                yes |                 yes |     projection |             yes |   when returned |
| `generateImage()`     |      prompt |      system prompt | references and mask |             no |              no |          images |
| `generateSpeech()`    |        text |       instructions |                  no |             no |              no |           audio |
| `transcribe()`        | prompt hint |                 no |               audio |     transcript |              no |              no |

Descriptions remain ordinary multimodal `generate()` calls and inherit that
row.

The registry applies an intentional scope asymmetry:

- An inapplicable prompt- or call-scoped policy is a configuration error before
  provider I/O. Explicit local configuration must never silently do nothing.
- An inapplicable global policy is dormant for that primitive. A global policy
  may intentionally cover a different content primitive.
- Dormant bindings are visible in the audit so policy applicability is
  explainable.
- Duplicate policy IDs remain invalid across all scopes, including dormant
  bindings.

`boundary.input.text()` remains an authoring alias for `boundary.input.user()`;
both retain the serialized target ID `user.input`. Exact dispatch changes which
canonical content each existing target receives, not the public target ID
vocabulary. `boundary.input.model()` continues to serialize as `model.input`.

The applicability table is compiler/Core-owned and shared by registry
validation, completed operations, adapter execution, tests, Project Index, and
documentation.

## Runtime lifecycle

The canonical order for a content-producing call is:

```text
public call
  -> I/O-free preparation and prompt resolution
  -> local policy applicability validation
  -> canonical input media guardrails
  -> canonical user/model text guardrails
  -> provider normalization, materialization, support, and routed attempts
  -> routing-selected provider-neutral result
  -> canonical output guardrails
  -> applicable terminal constraints
  -> invariant-preserving write-back
  -> Safety audit and successful observability
  -> public canonical result
```

Preparation must not download remote media or invoke a provider. Transcription
audio is guarded before source normalization or download. Image reference
assets and masks are guarded before provider normalization. Resolved image
prompt policies join global and call policy before input guarding.

Input media guards run before text projection so stripped input is absent from
the text seen by later policies. `boundary.input.text()` evaluates user-authored
content. `boundary.input.model()` evaluates actual system/model instructions.
The current behavior that mixes those bindings into one user projection is
replaced with exact dispatch. Migration tests must prove that every previously
reachable input remains reachable through one of the exact boundaries.

Language guardrails run on every successful provider step before tool-loop
continuation and result accumulation. This prevents intermediate text or media
retained in public `content`, `steps`, `finalStep`, or messages from bypassing
Safety. Constraints remain terminal-output policies and do not evaluate every
tool-loop step.

Live stream text retains the existing gated stage cascade. Canonical non-text
content is guarded from buffered completion metadata before `completion`
resolves. There is no synthetic live media event and no media `stream` option.

Completed-operation output is guarded after the provider result has been
validated into its canonical Crux contract but before success observability or
return. Provider definitions retain their existing mechanical normalize,
support, invoke, validate, and report hooks; they receive no Safety hook.

For routed completed operations, normalization, invocation, and validation may
run per candidate inside the routing attempt loop. Output Safety does not. It
runs exactly once on the routing-selected validated result, outside fallback,
cascade, and router retry classification. Consequently:

- a guardrail block or strip-to-block escalation is terminal and never selects
  another model;
- fallback result predicates and cascade acceptance predicates inspect the
  validated pre-Safety result;
- one Safety session, duplicate-ID check, and audit span the whole routed
  public call; and
- output policy context and audit identify the concrete selected model that
  produced the guarded result.

Input Safety runs once per public call before routed provider normalization or
external media materialization. Candidate-specific provider mechanics may not
alter the canonical input already approved by Safety.

Language output guardrails also run exactly once per provider-produced step,
including the terminal step. Terminal finalization consumes an already guarded
candidate and runs constraints plus invariant-preserving write-back; it does
not re-run step guardrails. Every constraint-driven regeneration produces a
new provider step, and that new step is guarded once before constraints inspect
it. Non-idempotent rewrites therefore cannot be double-applied and audit entries
remain one per policy evaluation.

## Result semantics

### Generated images

- `allow` and `warn` preserve the provider-ordered image.
- Enforced `strip` removes only the current image.
- `image` is reset to the first remaining member of `images`.
- Stripping the final image escalates to `block`, preserving the public
  `[Asset, ...Asset[]]` invariant.
- Report-mode strip records intent without changing `images` or `image`.
- Write-back constructs a new result object and preserves the original `raw`
  reference; it never mutates frozen execution facts or provider results.

### Generated speech

- The canonical result contains one required `audio` asset.
- Enforced `strip` therefore always escalates to `block`.
- Report-mode strip records intent without removing audio.
- Write-back constructs a new result object and preserves the original `raw`
  reference rather than mutating frozen result fragments.

### Transcription

- Input audio participates in `boundary.input.media()` before normalization or
  download.
- Top-level transcript text participates in `boundary.output.text()`.
- Constraints evaluate once. An `assert` failure throws
  `ConstraintViolationError`; a `suggest` failure remains audit-only. The audit
  records that the primitive evaluated the constraint once without a
  regeneration capability.
- Crux never retranscribes unchanged audio as a fake corrective retry.
- If an enforcing output-text guard rewrites `text`, the rewritten text becomes
  authoritative and `segments` and `words` are cleared because their text and
  timing no longer reliably correspond. Language and duration facts remain.
  The audit records the loss of timed detail.

### Assistant output

- Media strip removes the selected canonical part from its model step.
- A language step may validly become media-empty; no required-media escalation
  applies.
- Step-local changes are reflected consistently in aggregate `content`,
  `text`, `steps`, `finalStep`, and canonical assistant messages.
- Structured output text/object synchronization retains the existing
  fail-closed behavior.

### Unguarded escape surfaces

Safety is authoritative over canonical Crux fields only. Provider-native
`.raw`, raw stream handles, `providerMetadata`, and provider warnings are
explicitly unguarded and must be documented as such on every affected result.
Safe observability previews never retain raw bytes, locators, or provider raw
objects under any capture mode.

## Errors, audit, and observability

- `SafetyConfigError` reports inapplicable prompt/call policies, invalid media
  boundary families, media stream tuning, and invalid completed-operation
  options before provider I/O.
- `SafetyResultError` reports malformed policy results or write-back that cannot
  preserve a canonical operation invariant.
- `GuardrailBlockedError` reports enforced blocks and strip-to-block
  escalation with safe origin metadata.
- `ConstraintViolationError` reports one-shot transcription assertion failure
  with the ordinary constraint audit.
- Provider failures before a canonical output exists propagate unchanged.
- A completed media operation is observed as successful only after output
  Safety and validated write-back succeed.
- Media audit and decision records use the discriminated origin and safe part
  type; they never retain a source, filename, URL, payload, or provider object.
- Dormant globals and disabled/tuned policies remain distinguishable from
  evaluated policies.
- Turn Decision Reports and Devtools render operation, phase, field, and stable
  indexes without exposing media.

## Module boundaries

The change must not grow the existing large Safety session or generation
executor. The intended concern boundaries are:

```text
packages/core/src/safety/media/
  types.ts        public subject, origin, result, and location contracts
  visit.ts        shared traversal, validation, audit, observation, escalation
  input.ts        message/input enumeration and write-back
  output.ts       step/result enumeration and write-back

packages/core/src/safety/output/
  finalize.ts     terminal guardrail and constraint orchestration

packages/core/src/adapter/completed-operation/safety/
  execute.ts          preparation -> Safety -> invocation orchestration
  applicability.ts   supported boundaries and dormant-global behavior
  image.ts           core-owned image projection and write-back
  speech.ts          core-owned speech projection and write-back
  transcription.ts   core-owned transcript projection and write-back
```

`session.ts`, completed-operation `runner.ts`, and adapter execution modules
remain thin orchestration facades. The input and output media paths share one
visitor rather than duplicating the existing roughly 230-line per-part policy
loop. A file that becomes only a shallow pass-through should be folded into its
nearest cohesive module.

## TDD implementation sequence

Implementation follows vertical red-green-refactor slices. Tests use public
interfaces and verify behavior rather than internal call order.

1. Tracer bullet: a public bound `generateImage()` operation with
   `boundary.output.media()` blocks an unsafe image before returning.
2. Multiple images support sibling strip, preserve the non-empty tuple, and
   reset the `image` alias.
3. Speech runs the same output boundary; strip escalates to block.
4. Transcription input audio is blocked before normalization, download, or
   provider I/O.
5. Transcription output runs text guardrails and one-shot constraints;
   rewriting clears timed detail.
6. Image prompt text, references, and mask run input Safety before provider
   I/O, including applicable typed-prompt guardrails.
7. Global, prompt, and call policy merging gains strict-local/dormant-global
   behavior with auditable dormancy.
8. Language adapters guard every step and synchronize `content`, `steps`,
   `finalStep`, `messages`, and aggregate text.
9. Stream completion guards buffered media before resolving while live text
   keeps its existing gating behavior.
10. Exact user/model input dispatch replaces merged dispatch with migration
    coverage proving no content becomes unreachable.
11. Observability, Turn Decision Reports, Project Index facts, native static
    parity, and cache identity are updated.
12. Provider conformance proves identical behavior across AI SDK, OpenAI, and
    Google entry points.

Each slice writes one failing behavior test, adds only enough production code
to pass, refactors while green, and then proceeds to the next behavior. Type
tests land with the slice that introduces their public contract, not as a
horizontal batch.

Type-level coverage includes:

- narrowing by `subject.part.type` and `subject.origin.kind`;
- input/output media tuples;
- rejection of media/text tuples;
- rejection of media constraints, rewrites, holds, and stream options;
- operation-specific option availability;
- absence of transcription retry options; and
- TypeScript 5.5 and TypeScript 6 compatibility.

## Documentation, indexing, and release

Documentation must include the complete primitive/boundary matrix, canonical
versus raw result fields, one-shot transcription constraints, transcript
rewrite detail loss, input/output media tuples, completion-only stream media,
strict-local/dormant-global applicability, and the migration from top-level
media indexes to `origin`.

The boundary vocabulary and extracted Safety facts change Project Index output.
The implementation must update both static frontends and parity fixtures and
bump `STATIC_PARSE_CACHE_EPOCH`. It must update the bundled static-index worker
manifest identity in
`packages/local/internal/projectindex/staticindex/cache/manifest.go` when the
frontend contract requires it. `ProjectIndexSnapshotCacheEpoch` in
`packages/local/internal/projectindex/cache/identity.go` changes only if the
Go-owned `IndexData` snapshot shape, cache loading semantics, or client-visible
metadata changes. No semantic cache identity bump is needed unless the
implementation changes semantic enrichment.

The existing
`.changeset/safety-multimodal-rewrite-fail-closed.md` owns this release theme
and should be extended rather than creating a duplicate changeset. Directly
affected packages must be added to its front matter as required by the final
implementation. `@use-crux/core` receives a minor change; adapter packages with
new public operation options and behavior must be represented according to the
repository's fixed-package release rules.

Final verification includes focused Core Safety and completed-operation tests,
type tests on both supported TypeScript versions, provider conformance,
Indexer/native parity and identity tests, Devtools projections, repository
typecheck and tests, documentation build, and `make build`.

## Success criteria

- Every public content-producing primitive constructs or participates in one
  core-owned per-call Safety lifecycle.
- Every canonical input and output field in the applicability matrix is
  reachable through its exact boundary.
- No provider implementation can omit first-party fields from Safety coverage.
- No canonical media or transcript duplicate survives an enforcing strip,
  rewrite, or block decision.
- Non-regenerative constraints never perform or imply a corrective retry.
- Canonical result invariants remain true after Safety write-back.
- Audit, observability, Project Index, and documentation describe the same
  boundary and location contracts.
- `.raw`, provider metadata, and warnings are clearly documented escape
  surfaces rather than accidentally implied guarded data.
