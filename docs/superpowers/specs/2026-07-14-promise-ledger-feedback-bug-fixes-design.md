# Promise Ledger feedback bug fixes

Status: **approved**

## Goal

Close the approved Promise Ledger feedback batch as independent, public-behavior
TDD slices. Each slice starts with one failing test, makes the smallest production
change that passes it, and preserves provider-neutral core boundaries. Tests must
exercise public entry points or persisted contracts, not mocks of internal helpers.

## Fixes

### CRUX-LOCAL-002 — packaged Static Index frontend

The default Project Index workflow must schedule the packaged
`crux-static-index-worker` when it is discoverable. Worker availability is a
runtime capability; users must not need `experimental.indexer.nativeAst` merely
to use the frontend shipped beside `crux`. An explicit `nativeAst: false` remains
an opt-out, while explicit frontend configuration retains its current validation
and diagnostics.

Config inspection must preserve three states instead of collapsing absence into
`false`:

- absent `nativeAst`: enable Static Index when the sibling worker is discoverable;
- explicit `nativeAst: false`: keep Static Index disabled;
- explicit `true` or `{ frontend: 'oxc' }`: require that frontend and retain the
  existing validation path.

If the option is absent and no packaged or environment-configured worker is
discoverable, indexing must fail nonzero with the existing actionable missing
Static Index compiler diagnostic. It must not publish an apparently healthy,
empty Project Index. This preserves explicit opt-out while making the packaged
default truthful.

Start with a packaged-install/default-config integration test that indexes a
small public fixture and proves Static Index facts are produced through the
discovered sibling worker. Keep existing explicit-enable, explicit-disable,
missing-worker, extension, and TypeScript semantic-backend parity coverage.

This changes which producer runs for unchanged source. Review both Project Index
identity layers before implementation. The static parser output contract should
remain identical, so `STATIC_PARSE_CACHE_EPOCH` changes only if the emitted AST
facts change. Conservatively bump `ProjectIndexSnapshotCacheEpoch` if an existing
Go snapshot could hide the newly scheduled default workflow after restart. Verify
with `make build`, a restarted local server, and `crux index reindex`.

### CRUX-DOC-001 and CRUX-DX-001 — documentation truth

Remove `alpha: public packages pending` and equivalent getting-started notices;
public package installation is available. Search the docs application for
semantically equivalent copy rather than editing only the known homepage string.

In pipeline/cache documentation, state explicitly that pipeline caching covers
generation-stage results and does not cache embedding calls. Link to the existing
embedding and semantic-cache guidance where useful. Actual embedding-stage
caching is outside this batch.

Use docs build/content checks plus a focused text search proving the stale notices
are gone. These docs-site-only edits need no package changeset.

### CRUX-DX-002 — grounded prompt tuple parity

The `@use-crux/ai` grounded/agent prompt entry point must accept the same readonly
`ContextEntry` tuple contract as core `Prompt`, including heterogeneous context,
conditional, match, contributor, and false/null entries. Preserve core's merged
input inference: required tuple inputs remain required, optional contributors do
not become required, and invalid inputs still fail compilation.

Begin with public compile-time tests using representative tuples accepted by
`prompt()` and passed to the AI adapter. Add negative `@ts-expect-error` cases and
runtime resolution coverage only where the type correction exposes a real
lowering path. Reuse core's exported types; do not duplicate the union or make
core depend on the AI SDK.

### CRUX-QUALITY-001 — deterministic thrown outcomes

Cassette recording must treat a model throw as a first-class replayable outcome.
Persist it as `{ status: 'thrown', error: { name, message } }`. For an `Error`,
`name` is its non-empty string name (falling back to `Error`) and `message` is its
message. For a non-`Error` throw, use `name: 'NonErrorThrow'` and the bounded
`String(value)` as `message`. Never persist raw provider errors, codes, causes,
stacks, credentials, or arbitrary enumerable properties. Apply the same
redaction boundary used for successful results.

On replay, throw a core-owned `CassetteRecordedError extends Error`. Its public
`name` and `message` equal the recorded fields and it carries no provider object,
stack from the original call, cause, or arbitrary data. A recorded throw must not
become a returned value, and record-new single-flight/concurrent callers must
observe the same rejection. Start with a public Quality run that records both an
`Error` and a non-`Error` throw, proves the cassette shape is safe, then replays
without invoking the model and observes the exact restored `name` and `message`.

### CRUX-QUALITY-002 — fail-closed cassette loading

Every loaded entry must prove that its map key matches the canonical normalized
`call` stored in that entry under the current cassette identity. A mismatch is a
corrupt cassette, not a miss and never a replay hit. Reject the cassette before
executing or replaying any model call, with a diagnostic naming the cassette and
offending key but not leaking prompt content. Apply validation to all replay and
record modes that load existing entries so a later flush cannot legitimize bad
data.

Run the same validation again inside the file lock against the disk cassette
reloaded by `flush()`. If another process introduced a mismatched entry after the
session opened, abort the merge and leave the corrupt file untouched.

Start with a public cassette file whose entry is moved under a different key and
prove replay fails before provider execution. Add coverage for custom matchers:
validation must use the cassette session's effective match function rather than
assuming the default SHA key.

Thrown-outcome persistence changes cassette payload semantics, while key/call
validation strengthens loading semantics without changing normalized-call
construction. Review `CASSETTE_CACHE_EPOCH`; bump it if old entries cannot be
interpreted safely under the new outcome contract. No output-cache, baseline, or
judge identity changes are expected because their keys and comparability do not
change. Over-invalidate if implementation evidence contradicts that expectation.

### CRUX-DX-006 — privacy warning arity

When privacy redaction/drop supplies no detail, emit only the warning message;
do not pass an absent `undefined` second argument to `console.warn`. When detail
exists, retain it as the second argument. Start with observable console-call
tests for both cases and keep production/test warning suppression unchanged.

### CRUX-DX-008 — normalized AI SDK model ID

AI SDK model-object traces must use the `modelId` returned by the existing
adapter-profile extraction verbatim, with provider retained in the separate
`provider` field. For `{ provider: 'openrouter', modelId:
'openai/gpt-5.6-luna' }`, the trace is therefore `provider: 'openrouter'` and
`model: 'openai/gpt-5.6-luna'`; it must not become
`openrouter/openai/gpt-5.6-luna`. If `modelId` is empty, omit `model` rather than
substituting or stringifying the model object. Provider-reported response model
IDs remain separate actual-model metadata and must not overwrite the requested
model.

Start with public traced generate and stream calls using an AI SDK model object,
then assert the generation span/request attributes and execution-hook inputs
carry that verbatim `modelId`. Centralize extraction through the existing adapter
profile utility rather than adding a second object-shape parser.

## Delivery and verification

Delegate implementation as bounded, non-overlapping CLI-agent slices:

1. Local default Static Index scheduling and Project Index identity.
2. Docs truth fixes (`DOC-001` and documentation-only `DX-001`).
3. AI adapter tuple types and type tests (`DX-002`).
4. Quality thrown outcomes (`QUALITY-001`).
5. Quality cassette integrity (`QUALITY-002`), coordinated after the outcome
   slice because both touch cassette loading.
6. Privacy warning arity (`DX-006`).
7. AI SDK trace model normalization (`DX-008`).

Each agent owns only its tests and production files, reports cache/package impact,
and does not create a changeset. The orchestrator reviews diffs centrally, runs
focused tests after every slice, then package typechecks/tests and the applicable
root build. It owns one combined changeset for directly affected npm packages
(expected: `@use-crux/core`, `@use-crux/ai`, and `@use-crux/local`, adjusted to
actual public impact). Docs-site-only edits are described in the same delivery
but do not add a package bump.

## Deferred RFCs

This batch does not design or implement embedding-stage caching, public result
`traceId`, `.quality.ts` discovery/custom-target capability declarations,
deep/aggregate sanitization declarations, or strict provider-portable structured
output normalization. Those remain separate RFC candidates.
