# Structured-output normalization design

Status: **approved**

Related: [#224](https://github.com/use-crux/crux/issues/224),
[#173](https://github.com/use-crux/crux/issues/173), provider adapters, validation
retry, Safety, cassettes, semantic cache, and adapter conformance.

## Summary

Crux accepts one authored Zod schema and compiles it for the selected provider
route. Core converts that schema to canonical JSON Schema, lowers it according
to a provider-neutral capability profile, records every transport-only change,
and produces a private decoder. Adapters receive the prepared wire schema in
their normal request context. Provider values are decoded and then parsed once
by the original Zod schema before any typed result is exposed.

This fixes strict-provider failures for ordinary optional properties without
making users encode provider transport rules in domain schemas. It also creates
the canonical value and decode metadata required by #173 to guard completed
structured paths while they stream.

## Terms

- **Authored schema:** the immutable Zod schema supplied by the user.
- **Wire schema:** JSON Schema lowered for one provider route.
- **Input value:** decoded model-produced `z.input` data before Zod effects.
- **Input text:** guarded JSON text representing that input value.
- **Output value:** final `z.output` data returned as `result.object`.
- **Normalization plan:** wire schema, decode manifest, report, and identity.
- **Release plan:** #173's per-call account of policy gates and commit points.
- **Occurrence:** one subject emitted by a boundary; a text segment is one kind
  of occurrence.

## User mental model

Users author the schema their application wants:

```ts
const contact = z.object({
  name: z.string(),
  nickname: z.string().optional(),
})
```

Crux adapts that schema to the provider. The public result is always the value
parsed by `contact`; wire-only sentinels and stripped provider constraints never
become application data.

Users do not select provider dialects in `prompt({ output })`, write nullable
fields solely for OpenAI compatibility, or invoke normalization themselves.

## Invariants

1. The authored Zod schema is immutable and remains authoritative.
2. Wire lowering may broaden provider acceptance, never final acceptance.
3. Every lossy change is reported and identity-bearing.
4. Provider identity and SDK types do not enter `@use-crux/core`.
5. Optional-only null sentinels are removed only at compiler-recorded paths.
6. Genuine nullable values retain `null`.
7. Defaults, refinements, coercions, and transforms run once, in the final Zod
   parse.
8. Unsupported or ambiguous lowering fails before provider I/O.
9. No internal wire or partial value is exposed as a typed result.
10. Generate, stream completion, standalone object generation, replay, and
    cache hits use the same decode-and-validate order.

## Adapter authoring contract

The provider profile declares what its structured-output endpoint accepts:

```ts
defineSingleTurnProviderBundle({
  profile: {
    structuredOutput: {
      accepts: strictStructuredOutput,
    },
  },

  request(context) {
    return {
      // The adapter owns its provider envelope.
      response_format: context.outputSchema,
    }
  },
})
```

The accepted names are:

- `profile.structuredOutput.accepts`: static, declarative endpoint
  capabilities.
- `context.outputSchema`: the prepared per-call schema handed to the existing
  request builder.

There is no `placeSchema`, schema callback, provider branch in core, or second
request-construction path. Public profiles are a provider-authoring API from
the first release so custom and OpenAI-compatible adapters can describe their
actual route instead of relying on model-id guesses.

`accepts` deliberately reads as “what this endpoint accepts.” `outputSchema`
deliberately names the provider request concept at the adapter boundary, while
the compiler uses `wireSchema` for the same artifact internally. These names
avoid exposing compiler terminology in ordinary request assembly.

Capability profiles are public, inert records of orthogonal capabilities. A
custom adapter may compose its actual capability mix, while each field selects
only closed, versioned core rules. Profiles never contain executable lowering
or decode callbacks. The profile field belongs to the shared provider-runtime
contract; the single-turn bundle above is only its most common authoring view,
and structured tool compilers consume the same capabilities.

## Compiler outputs

The normalization kernel returns an internal plan with focused concerns:

```ts
interface StructuredOutputPlan {
  readonly wireSchema: JsonSchema
  readonly decodeManifest: StructuredOutputDecodeManifest
  readonly report: StructuredOutputNormalizationReport
  readonly fingerprint: string
}
```

The decoder is core-owned and interpreted from the manifest. The adapter sees
only the prepared request schema and safe plan metadata required by its request
contract. The full authored schema and generated data are not logged by
default.

Keep the implementation split by concern rather than growing one compiler
file beyond roughly 300 lines:

- canonical Zod-to-JSON-Schema conversion;
- schema graph traversal and analysis;
- capability validation;
- optional-null lowering;
- reference and union analysis;
- decode-manifest interpretation;
- reports, diagnostics, and fingerprints; and
- final decode/Zod validation orchestration.

## Optional-property lowering

For an endpoint requiring every object property on the wire:

```ts
z.object({ nickname: z.string().optional() })
```

is lowered to a required property whose wire schema also accepts `null`. The
manifest records that `null` is an omission sentinel at that exact runtime
path. A provider value of `{ nickname: null }` decodes to `{}` before the
original Zod schema parses it.

For this schema:

```ts
z.object({ nickname: z.string().nullable().optional() })
```

`null` is domain data and remains `null`.

The graph walk covers nested objects, arrays, tuples, definitions, recursion,
and supported union branches. Ambiguous branches with conflicting null meaning
are rejected during preflight rather than guessed during decoding. Duplicate
runtime object keys are rejected by incremental parsing so a later value cannot
supersede a guarded or decoded property.

## Constraint lowering

Formats and assertion keywords use closed profile policies:

- preserve;
- strip and validate locally;
- apply a named, versioned equivalent rewrite; or
- reject.

Unknown assertion keywords reject by default. Removed constraints remain in
the authored Zod schema, so a provider may generate more invalid candidates but
Crux never accepts a value the application schema rejects.

## Result semantics

The value lifecycle is:

```text
authored Zod schema
  -> canonical JSON Schema
  -> provider wire schema + decode manifest
  -> provider JSON value
  -> manifest decode
  -> structured Safety over canonical z.input values
  -> original Zod parse exactly once
  -> public z.output value
```

`result.object` is `z.output<TSchema>`. `result.text` and guarded structured
stream text are input text: the JSON representation of the decoded pre-Zod
input value. They may legitimately differ from `JSON.stringify(result.object)` when Zod applies defaults,
coercions, or transforms. “Synchronized” means sentinel decoding and Safety
rewrites are reflected consistently in input text and the value passed to Zod;
it does not mean input and output representations are byte- or value-equal.
JSDoc must state this distinction. Provider-native `raw` remains outside the
canonical guarantee and must be documented as an unsafe escape surface.

Validation is unconditional. `validationRetry` controls whether Crux makes a
corrective attempt, not whether it validates. Successful parsing returns
`safeParse.data`, preserving Zod defaults and transforms instead of returning
the unparsed JSON value.

Structured stream text is provisional until completion validates. When
`validationRetry` can discard the attempt, its release-plan gate keeps the
attempt uncommitted through repair and final Zod parsing; this intentionally
buffers the structured stream and is reported before provider I/O. Without a
retry budget, final parse failure terminates completion after any already safe
input occurrences; Crux cannot repair or replace bytes already released.

## Streaming handoff to #173

#224 does not expose partially typed objects. It must nevertheless provide an
internal, versioned contract that lets the streaming Safety parser:

- recognize stable JSON keys, scalar values, array items, and containers;
- apply completed-path sentinel decoding before a guard sees the value;
- preserve genuine nulls;
- reject duplicates and malformed terminal input; and
- build the same canonical pre-Zod root used by final validation.

The incremental parser never guesses or repairs unfinished JSON. Existing
`repairJsonText()` remains available after a provider attempt ends; validation
retry also remains unchanged in purpose.

## Diagnostics and identity

Stable diagnostics distinguish unsupported schemas, normalization notices,
stripped constraints, unknown profiles, and decode failures. Messages include
safe profile/model identifiers and schema locations, but omit property names,
descriptions, full schemas, and generated values by default.

Call, cassette, replay, and semantic-cache identity includes the normalization
engine version, profile version, authored-schema fingerprint, wire-schema
fingerprint, and decode-manifest version. Implementation must audit and bump
the relevant cache epochs when old artifacts could bypass new decoding or
validation semantics. Project Index epochs change only if indexed output
changes.

## Phased rollout

1. **Kernel:** land the pure compiler, reports, fingerprints, decoder, and
   exhaustive red-green tests with no provider behavior change.
2. **Native OpenAI:** replace SDK helpers that reject optional schemas or parse
   before decoding; cover generate, stream completion, codecs, and standalone
   object helpers.
3. **AI SDK routes:** reuse the core plan, select explicit known profiles, and
   fail safely for unknown strict routes.
4. **Anthropic and Google:** move distributed sanitation into declarative
   profiles and delete provider-specific schema compatibility logic from core.
5. **Tools and conformance:** opt structured tool schemas into the same engine,
   add provider request fixtures, cache migrations, observability, and docs.
6. **Streaming Safety handoff:** expose the private canonical event/decode seam
   consumed by the separately tested #173 rollout.

#173 phases 4–6 must not begin until phase 6 is merged and the event/decode seam
is versioned. Its boundary, text-engine, and bundled-policy phases may proceed
in parallel with #224 phases 1–5.

Each phase is a vertical TDD slice. Red tests first prove public type
inference, real request shape, decode order, failure behavior, and cache misses;
green implementation follows; refactoring then keeps compiler and adapter
modules focused.

## Acceptance criteria

- Optional-only fields work through every supported strict route without
  leaking `null`.
- Nullable optional fields preserve `null`.
- Unsupported ambiguity fails before provider I/O with actionable diagnostics.
- Zod transforms/defaults/refinements run once and their parsed data is
  returned.
- Generate, stream completion, standalone helpers, retries, cassettes, and
  cache hits expose identical canonical results.
- Adapter packages declare capabilities and assemble envelopes without
  duplicating normalization.
- Provider contract fixtures cover nested optional fields, formats, refs,
  arrays, unions, and refusals.
- #173 can consume stable decoded path events without exposing wire sentinels
  or provider-native partial-object types.
- Transform/default fixtures prove input text and output values are
  individually correct and document when they differ.
- Cache migration tests prove pre-decode artifacts cannot bypass the new
  decoder or authoritative validation.
