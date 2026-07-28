# Observability redaction patterns design

Status: **approved**

Related: [#176](https://github.com/use-crux/crux/issues/176) and
[#289](https://github.com/use-crux/crux/issues/289).

## Summary

Crux will add deployment-wide `observability.redactPatterns` for
organization-specific identifiers its built-in capture policy cannot recognize.
Devtools, OpenTelemetry, subscribers, and custom transports receive the same
redacted record. Application, provider, model, and tool data is unchanged.

This is irreversible telemetry hygiene. Reversible protection from model
providers remains the separate model-boundary pseudonymization RFC in #289.

## User problem

An identifier such as `ACME-928471` may be sensitive to one organization but
have no generally recognizable format. It can appear in prompts, output, tools,
validation, Safety reports, memory, custom attributes, URIs, or errors. Today
users must drop the payload with `evidence`/`off` or recursively traverse it in
`redactRecord`. They should be able to retain useful telemetry declaratively.

## Public API

```ts
config({
  observability: {
    redactPatterns: [
      /\bACME-\d{6}\b/,
      {
        pattern: /\bCUSTOMER-\d+\b/,
        replacement: "[customer-id]",
      },
    ],
  },
});
```

```ts
/**
 * A deployment-wide pattern removed from captured observability payloads.
 *
 * A bare expression replaces every match with `[REDACTED]`. Use the object
 * form to provide a literal replacement. Pattern matching never changes the
 * value used by the application, model, or tool.
 */
export type CruxObservabilityRedactionPattern =
  | RegExp
  | {
      /** Expression matched against captured observability strings. */
      readonly pattern: RegExp;
      /**
       * Literal replacement inserted for every match.
       *
       * JavaScript replacement tokens such as `$&` and `$1` are not expanded.
       *
       * @default '[REDACTED]'
       */
      readonly replacement?: string;
    };
```

`CruxObservabilityConfig` is the only stable user-facing owner:

```ts
/**
 * Deployment-wide patterns removed from captured observability payloads.
 *
 * Rules run in declaration order at the shared observability privacy gate.
 * They do not modify application or provider data.
 *
 * @default []
 */
readonly redactPatterns?: readonly CruxObservabilityRedactionPattern[]
```

Config installation maps the frozen snapshot into Core's internal resolved
`CruxObservabilityCapturePolicy`; these are not two independently merged rule
sources. Advanced hook layers may supply the same resolved field, and normal
hook precedence replaces the complete field.

## Alternatives

- **Global `redactPatterns` configuration (selected):** discoverable,
  declarative, and shared by every producer.
- **A helper that produces `redactRecord` (rejected):** makes a common privacy
  requirement look like custom middleware and cannot naturally run before
  evidence hashing.
- **Per-policy or per-boundary rules (rejected):** miss non-Safety producers and
  couple the shared capture engine to Safety internals.

Existing artifact-kind and input/output capture overrides remain sufficient for
choosing `full`, `safe`, `evidence`, or `off`.

## Redaction surfaces

Patterns apply to:

- `artifact.preview`, recursively;
- `artifact.uri`;
- every string nested below any graph record's `attributes`; and
- `error.message` on run and span records.

All attribute values are included, not only the known payload attribute keys.
Custom attributes are precisely where organization-specific values are likely
to appear. Safety, validation, memory, raw errors, stacks, and cause evidence
are emitted as artifact previews or attributes; the typed error summary carries
only `message`, `name`, `category`, `retryable`, and `statusCode`.

Patterns do not rewrite top-level IDs, names, correlators, definition refs,
source locations, relation endpoints, deployment identity, timestamps, metrics,
artifact metadata other than `uri`, graph topology, or object keys.

Applications must not place raw personal data in structural identifiers.
Identifiers also belong in values, not object or attribute keys, because keys
are structural and never rewritten.
`redactRecord` remains available when an application deliberately needs to
replace or drop one of those fields.

## Matching semantics

- A bare expression or object without `replacement` uses `[REDACTED]`.
- Every occurrence is replaced even when the input expression omits `g`.
- Sticky matching becomes global matching; other meaningful flags remain.
- Zero-length matches are skipped rather than inserting replacement text.
- Rules run in declaration order; later rules see earlier replacements.
- Replacement strings are literal. `$&`, `$1`, `$<name>`, and `$$` have no
  interpolation semantics.
- Runtime uses private cloned expressions and never mutates caller `lastIndex`.
- Each replacement must be stable under the complete rule set; config rejects
  replacements that would be transformed again. Both passes are therefore
  idempotent.

Patterns are trusted application configuration. Core cannot bound the
complexity of a pathological JavaScript regular expression; documentation
must warn against expressions susceptible to catastrophic backtracking.

## Privacy pipeline

Redaction must precede evidence derivation. Hashing the original identifier and
then removing its preview would retain guessable evidence for low-entropy
values.

The record path is:

```text
canonical graph record
  -> media-safe preview normalization
  -> removal of payload fields disabled by capture policy
  -> declarative pattern redaction
  -> full / safe / evidence / off transformation
  -> custom redactRecord transform or drop
  -> JSON-safe sanitization
  -> declarative pattern redaction
  -> graph-record validation
  -> subscribers, diagnostics channel, transports, and OTel
```

The first pattern pass ensures Core-derived `hash` and `sizeBytes` evidence is
based on redacted content. If a pattern changes an artifact preview, stale
supplied preview evidence is replaced with evidence derived from the redacted
representation.

The second pass sees the sanitized hook result, so it catches values introduced
by `redactRecord` or by JSON-safe coercion. It applies the same stale-evidence
invalidation as the first pass. A `null` hook result drops the record first.

`off` removes payload and evidence as it does today. `evidence` derives
metadata from the redacted representation. `full` and `safe` retain the
redacted representation.

## Traversal and compilation

The first pass is structure-preserving: it recursively replaces string leaves
without coercing or truncating values, and uses the sanitizer's depth,
collection, and cycle limits only as traversal guards. Values outside those
bounds cannot survive final sanitization. The second pass operates on the
bounded JSON-safe record, catching strings created from functions, symbols,
dates, bigints, and non-finite numbers. `redactRecord` therefore receives the
same post-capture, pre-sanitization shape it receives today.

Configuration is cloned and frozen on installation, then normalized once per
snapshot identity. The cached form contains only private expressions and
literal replacements; caller mutation cannot stale the cache.

The transformer returns new selected surfaces and never mutates the canonical
record, caller attributes, previews, or configured expressions.

## Failure behavior

Malformed entries fail during `config()` installation: each must be a `RegExp`
or an object containing a `RegExp`, `replacement` must be a string, and every
replacement must remain unchanged when all configured rules are applied.

Unexpected traversal or matching failure uses the existing privacy path: drop
the record, increment redacted-record diagnostics, emit the bounded development
warning, and never throw into the application operation.

The error detail must not retain or print the record payload.

Configuration disposal restores the previous complete capture policy through
the existing hook-layer transaction. Pattern arrays do not leak across config
installations or tests.

## Module boundaries

The current `capture-policy.ts` is already close to 300 lines, and
`observability/privacy.test.ts` is already over 300 lines. This change must not
grow either into a larger mixed-concern module.

Use these boundaries:

- `capture-policy-contract.ts`: public types and JSDoc.
- `redaction-patterns.ts`: validation, compilation, and string matching.
- `redaction-record.ts`: bounded record traversal, surface selection, and
  evidence invalidation.
- `capture-levels.ts`: capture resolution and level transformations moved from
  `capture-policy.ts`.
- `capture-policy.ts`: small public orchestrator and exports.
- Runtime config modules: top-level config and immutable installation.
- `observability/redaction-patterns.test.ts`: new behavioral coverage.

## TDD delivery

Implementation proceeds as vertical red-green slices:

1. Configure one bare pattern through `config()`, emit one artifact, and prove
   the in-memory transport receives only the default replacement.
2. Add the object form and prove its replacement is literal.
3. Replace repeated matches without requiring `g`, preserving caller
   expressions and `lastIndex`.
4. Cover nested arrays, objects, bounded values, and circular values through
   the public emit path.
5. Cover attributes, artifact URI, and error message while proving structural
   IDs and definition refs remain unchanged.
6. Prove `full`, `safe`, `evidence`, and `off`, including evidence derived
   after redaction.
7. Prove the hook keeps its existing input shape and cannot reintroduce matching
   content or evidence.
8. Prove malformed config fails during installation and unexpected runtime
   failure drops rather than exports the record.
9. Prove zero-length matches are skipped, unstable replacements are rejected,
   and config disposal restores policy.
10. Add public type tests, then refactor capture-level concerns out of the
    near-limit orchestrator while all tests remain green.

Tests describe public privacy behavior. Focused pure tests are allowed only
where the public path cannot precisely demonstrate cloning or traversal bounds.

## Verification

Run:

```sh
pnpm --filter @use-crux/core test -- \
  __tests__/observability/redaction-patterns.test.ts \
  __tests__/observability/privacy.test.ts \
  __tests__/config-runtime.test.ts \
  __tests__/runtime-config-transaction.test.ts
pnpm --filter @use-crux/core typecheck
```

Then run repository test and typecheck targets. Project Index now carries
privacy-safe observability policy state, so the Go snapshot cache epoch is
bumped from 49 to 50 to invalidate snapshots without
`redactPatternsConfigured`.

The tracer test observes both a subscriber and transport to prove the shared
gate runs before fan-out; Devtools and OTel consume that same record path.

## Release

This adds public `@use-crux/core` configuration and changes observability
runtime behavior. Implementation requires a minor changeset unless an existing
pending changeset already describes the same release theme.

Documentation distinguishes `redactPatterns` (observability string rewriting),
`redactRecord` (advanced record transform/drop), `redactPaths` (persisted Eval,
feedback, and Review paths), and #289 (reversible model protection).

## Acceptance criteria

- The example configuration redacts every matching payload occurrence before
  any observability consumer receives it.
- Custom attribute values are covered without rewriting structural graph
  identity.
- Evidence hashes and sizes do not derive from matching originals.
- Existing capture presets and artifact overrides remain compatible.
- `redactRecord` remains backward compatible and cannot reintroduce matching
  content.
- Application, model, and tool values remain byte-for-byte unchanged.
- Runtime failures fail closed for telemetry without failing the application.
- No Safety-specific redaction engine, policy selector, or boundary selector is
  introduced.
