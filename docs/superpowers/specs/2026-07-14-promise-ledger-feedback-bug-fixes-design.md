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

### Eval evidence replacement

The former pre-launch record/replay items no longer describe implementation
work. Evals V1 has one automatic exact-evidence path instead of public
record/replay modes or a second persistence resource:

- a task failure produces an errored Eval cell and is not reusable task evidence;
- only complete, persistence-safe task results can be written as evidence;
- malformed, stale, incomplete, or wrong-key evidence is a miss and never a hit;
- persisted Eval diagnostics pass through the Eval redaction boundary; and
- evidence identity changes follow `TASK_EVIDENCE_CACHE_EPOCH` and
  `BASELINE_FINGERPRINT_EPOCH` as documented in `AGENTS.md`.

The Eval reuse, freshness, kernel-error, and persistence tests are the binding
coverage. Do not restore public record/replay modes, custom evidence matchers,
or a parallel normalized-call store.

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
4. Privacy warning arity (`DX-006`).
5. AI SDK trace model normalization (`DX-008`).

Each agent owns only its tests and production files, reports cache/package impact,
and does not create a changeset. The orchestrator reviews diffs centrally, runs
focused tests after every slice, then package typechecks/tests and the applicable
root build. It owns one combined changeset for directly affected npm packages
(expected: `@use-crux/core`, `@use-crux/ai`, and `@use-crux/local`, adjusted to
actual public impact). Docs-site-only edits are described in the same delivery
but do not add a package bump. The superseded record/replay items above are
excluded from this delivery sequence.

## Deferred RFCs

This batch does not design or implement embedding-stage caching, public result
`traceId`, deep/aggregate sanitization declarations, or strict provider-portable
structured output normalization. Those remain separate RFC candidates. Eval
authoring and execution were designed separately and now use the first-class
`*.eval.ts` contract.
