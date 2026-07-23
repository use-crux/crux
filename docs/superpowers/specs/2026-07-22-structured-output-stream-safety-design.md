# Structured-output streaming Safety design

Status: **approved**

Related: [#173](https://github.com/use-crux/crux/issues/173),
[#224](https://github.com/use-crux/crux/issues/224), guardrails, constraints,
stream results, validation retry, and bundled Safety strategies.

## Summary

Guardrails and constraints use one boundary vocabulary over text, decoded
structured values, tool calls, media, and memory. A boundary identifies the
subject and when one occurrence is available. Unrefined text follows natural
delivery; refinements pin a stable unit. Structured paths become available
only when their JSON value is syntactically complete and #224 has applied any
transport-only decoding.

Guardrails gate each occurrence before release. Constraints evaluate the same
occurrences as early as possible, but keep the attempt uncommitted while a
future constraint occurrence could still reject and retry it.

## User mental model

> Use a boundary as-is for natural delivery. Refine it when the policy needs a
> particular amount of context.

```ts
boundary.output.text()
boundary.output.text().deltas()
boundary.output.text().complete()
boundary.output.text().sentences()
boundary.output.text().lines()
boundary.output.text().segments(segmenter)

const output = boundary.output.object<Input>()
output
output.path('customer.email')
output.path('reviews').items()
output.path('report.body').sentences()
```

There is no guard-level `stream` setting or mandatory granularity call.

## Boundary defaults

`boundary.output.text()` is an adaptive delivery boundary:

- `generate()` invokes the policy once with complete text;
- `stream()` invokes the policy for every non-empty canonical text delta before
  release.

`.deltas()` explicitly selects the same low-latency behavior and overrides a
bundled strategy default. Under `generate()` it still produces one complete
invocation because no incremental deliveries exist.

Deltas are arbitrary delivery units and may split words, sentences, patterns,
or secrets. `.complete()`, `.sentences()`, `.lines()`, and custom segments
produce deterministic units under both transports. Provider-native event
shapes never become the public Safety contract.

Custom pattern or secret detectors must refine the boundary or deliberately
select `.deltas()` with an incremental-safe implementation. JSDoc states this
on the base builder, and development inspection emits a one-time notice for a
custom output-text guardrail using the unrefined adaptive boundary.

Structured boundaries are stable by construction:

- the root object occurs when the root closes;
- a path occurs when that value closes;
- `.items()` occurs once per closed array item; and
- string-path segmentation occurs as decoded segments close inside the string.

Optional-only null sentinels are removed before path policies run. Genuine
nullable values remain visible. Public policy subjects are canonical
`z.input` values; final `z.output` values exist only after authoritative Zod
parsing.

## Boundary builder and types

`boundary.output.object<Input>()` is both the complete-root boundary and a
typed refinement builder, removing the current `path<T>()('x')` currying:

```ts
const output = boundary.output.object<Input>()

guardrail({
  id: 'safe-email',
  on: output.path('customer.email'),
  run(email) {
    return inspectEmail(email)
  },
})
```

Conditional builder types expose `.items()` only for arrays and text
segmentation only for strings. Optional locations produce no occurrence when
absent; nullable values remain occurrences. Typed autocomplete covers four
nested object edges. Deeper runtime paths remain accepted but their subject
widens to `unknown`; they never trigger runaway inference or TS2589.

Every public builder and refinement has JSDoc stating its generate/stream
invocation count, partiality, buffering and release behavior, legal decisions,
and completion/limit behavior.

## Guardrail execution

Guardrails run before each occurrence is released:

```ts
allow | warn | rewrite | block | hold
```

`hold` is available only for growing text units. It means: coalesce the current
unit with the next unit and run the policy again without releasing either.
Generate replays the same deterministic segments so hold behavior remains
coherent. A hold that remains unresolved at completion or exceeds its bounded
size/time budget fails closed.

Closed JSON values, objects, items, media, tool calls, and memory writes cannot
return hold. A policy that needs sibling fields targets their containing object.

Rewrites replace canonical occurrences and are serialized from the canonical
tree. Crux never splices guessed bytes into JSON. The smallest safe serializable
member is held; an unresolved outer boundary also holds all nested output.

A structured rewrite is checked against the compiler's local schema for that
occurrence before release. Cross-field refinements and Zod effects still run
only in the final authoritative parse. If validation retry is enabled, that
attempt remains uncommitted through final parsing; otherwise a later final
validation error terminates completion without pretending released input text
can be repaired or replaced.

Evaluation readiness and text release are separate. A path can be evaluated as
soon as its value closes, while document-order serialization may retain the
entire prefix and following bytes until that gate clears.

## Constraint execution and commit

Constraints use the same boundaries and may also hold growing text, but their
decisions remain:

```ts
pass | fail with feedback | hold
```

A failed constraint rejects the provider attempt and enters its bounded retry
or fallback lifecycle. Because released bytes cannot be retracted, Crux holds
the attempt until all active retry-capable constraint boundaries are exhausted
or have passed permanently.

Examples:

- A single `path('currency')` constraint holds only through that immutable
  path. After it passes, the prefix can be released if no unresolved constraint
  remains.
- An `.items()` constraint checks each item early but holds through the array,
  because a later item can reject the attempt.
- A text-delta, sentence, line, or root constraint may fail again until end of
  output, so it holds the complete attempt while still aborting bad attempts
  early to save tokens.

The rule is:

> Guardrails release each passing occurrence unless an unresolved retry-capable
> constraint, hold, validation-retry gate, or serialization dependency retains
> it. The effective release point is the latest enclosing unresolved gate.

Constraints release only when the attempt can no longer be rejected. A
constraint gate therefore takes precedence over a guardrail that has already
allowed or rewritten the same occurrence.

`ConstraintConfig.onChunk` is removed. Retryable early checks use ordinary
constraint boundaries. Terminal early rejection uses a guardrail.

## Bundled policies

Deleting the current stream option must not silently change first-party
strategy correctness. Effective unit resolution is:

1. an explicit boundary refinement;
2. a bundled strategy's declared semantic default; then
3. the adaptive boundary default.

Bundled defaults are inspectable strategy metadata, not public stream options:

| Strategy | Default unit |
| --- | --- |
| `guardrail.pii()` | sentence |
| `guardrail.secrets()` | sentence |
| `guardrail.injection()` | sentence |
| `guardrail.classifier()` | complete text |
| `guardrail.media()` | atomic media part |
| `constraint.judge()` | complete text |
| `constraint.citations()` | complete composite output |

An explicit `.deltas()` refinement lets an author deliberately override a
bundled preference. Built-in JSDoc states the effective default and its cost.
The citation strategy targets the existing composite output boundary whose one
completed subject contains both input text and the decoded root object; it is
not two independently scheduled occurrences.

## Custom segmentation and continuous scanning

Custom `.segments({ maxCharacters, next })` is an advanced, named escape hatch
rather than a second place to return hold. `next(buffer, { final })` returns the
next segment's end offset or `undefined` while no complete segment exists.

Segmenters are synchronous, pure, deterministic, bounded, and run identically
over generated and streamed text. They decide where a unit ends; `run()` alone
returns the decision set for its policy kind: `allow | warn | rewrite | block |
hold` for guardrails and `pass | fail | hold` for constraints.

A later rollout may add continuous early-block scanning for checks that can
prove a violation from an unfinished prefix, such as a completed secret match.
Such a scanner can reject early but cannot declare the whole output safe. It is
a narrow guardrail capability, not a general stream mode.

## Release plans and diagnostics

Core compiles active policies into an inspectable release plan before provider
I/O. Devtools and one-time development notices name policies that delay output:

```text
Constraint "brand-voice" may reject future sentences and retry the attempt.
The output stream remains buffered until completion.
```

The plan reports each policy's evaluation readiness, invocation cadence, held
scope, text-release point, retry commit point, and outermost effective gate. It
attributes document-order and root-object buffering to the policy that caused
it. An adapter that cannot honor a requested incremental structured boundary
fails preflight; it never silently downgrades to complete-output buffering.

Canonical guarded streams are the safe surface. Provider-native raw streams
may repeat blocked or rewritten data and should move to an explicitly unsafe
name or namespace before launch.

## Parsing and readiness

The incremental JSON parser emits an occurrence only when syntax makes it
immutable:

- keys after their closing quote;
- strings after their closing quote;
- numbers, booleans, and null after a legal delimiter;
- items after the item closes; and
- containers after their matching delimiter.

It rejects duplicate keys, invalid terminal syntax, excessive nesting, and
configured size limits. It never appends imaginary delimiters or invokes
`repairJsonText()` on an unfinished prefix. Normal completed-attempt repair and
validation retry remain available after streaming ends.

## Phased rollout

1. **Boundary types:** add adaptive/refined boundary descriptors, conditional
   builders, JSDoc, type tests, and the compiled release-plan model.
2. **Text engine:** move segmentation from guard configuration to boundaries,
   implement deterministic generate/stream units, bounded hold, and remove
   stream tuning.
3. **Bundled policies:** migrate semantic defaults and prove PII, secrets, and
   injection behavior across every possible provider-delta split.
4. **Structured parser:** consume #224 decode metadata, add path/item/container
   readiness, duplicate-key rejection, and parser limits.
5. **Structured gating:** implement nested gates, canonical rewrites,
   serialization, aborts, and final text/object synchronization.
6. **Transactional constraints:** share boundary scheduling, add attempt commit
   gates and early retry, migrate judge/citations, and remove `onChunk`.
7. **Adapter parity:** cover core-step and SDK-loop streams, unknown capability
   preflight, raw escape surfaces, aborts, timeouts, and provider fixtures.
8. **Scanning follow-up:** add continuous early-block scanning only after its
   monotonic contract and concrete built-in use cases are accepted.

Phases 4–6 must not begin until #224 phase 6 has merged the versioned canonical
event/decode seam. Phases 1–3 may proceed alongside #224 phases 1–5.

Each phase follows red-green-refactor and keeps parser, segmentation, gate,
constraint commit, rewrite, and inspection concerns in focused files below
roughly 300 lines where practical.

## Acceptance criteria

- Unrefined custom text policies preserve low-latency natural delivery.
- Refined text units behave deterministically across generate and stream.
- Stable structured values are guarded at the earliest sound readiness point.
- No blocked or rewritten occurrence is released through the canonical stream.
- Retryable constraints never retry after committing an attempt prefix.
- An overlapping retry-capable constraint suppresses guardrail release until
  the constraint gate clears.
- Release plans make all effective full buffering attributable to named
  policies.
- Bundled strategies preserve their intended completeness and invocation cost.
- Provider delta splits cannot bypass bundled PII, secret, or injection checks.
- Rewrites keep input text and the value passed to Zod synchronized; Zod
  effects may intentionally make the final output value differ from input text.
- Final original-schema validation remains unconditional and returns Zod's
  parsed `z.output` value.
- Hold size/time exhaustion fails closed under generate and stream.
- Paths at and beyond the four-edge inference limit type-check without TS2589.
