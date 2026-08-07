# Connected Knowledge Portability and Lifecycle Implementation Plan

> Binding design: `docs/superpowers/specs/2026-08-07-connected-knowledge-portability-and-lifecycle-design.md`

## Goal and invariants

Ship portable grouped assertion extraction, assertion-aware deterministic communities, and a terminal Eval-owned in-memory Knowledge Base lifecycle without changing the canonical typed assertion API or making `@use-crux/core` provider-aware.

Implementation invariants:

- Work red-green-refactor in every phase: add the focused failing test, run only that test with one worker, implement the smallest fix, then rerun it with one worker.
- Every Vitest/Jest example below uses `--maxWorkers=1`; use the repository's equivalent single-worker flag where a package script wraps the runner.
- Keep ECO flat schemas unchanged.
- Keep provider wire compromises internal; authored Zod schemas remain final validation authority.
- Do not add public community-weight tuning.
- Update the existing assertion and Connected Knowledge changesets; do not create duplicate changesets.
- If Project Index or Eval evidence output semantics are touched incidentally, apply the cache-identity rules in `AGENTS.md`; the work below should not require those epoch changes.

## Phase 0 — Pin the focused surface and existing release notes

Files:

- `packages/core/src/knowledge/derive/assertion-wire.ts` (new compiler/decoder boundary)
- `packages/core/src/knowledge/derive/assertion-runner.ts`, `prompt-bounds.ts`, `bounds.ts`, and `manifest.ts`
- `packages/core/src/knowledge/assertions/assertions.ts`
- `packages/core/src/knowledge/communities/assertion-policy.ts` (new internal policy), `types.ts`, `cluster-normalize.ts`, `graph-input.ts`, `cluster.ts`, `cluster-split.ts`, `cluster-parents.ts`, `reports.ts`, `report-schema.ts`, `records.ts`, `communities.ts`, and adjacent `communities/build.ts`
- `packages/core/src/eval/internal/evidence/cache-epochs.ts` only if evidence identity actually changes
- `packages/core/__tests__/knowledge/assertion-wire-schema.test.ts`, `assertions.test.ts`, `derive-diagnostics.test.ts`, `communities-cluster.test.ts`, `communities-build.test.ts`, and `community-retained-refresh.test.ts`
- `packages/core/__tests__/eval/node-run.test.ts`, `defer-capture.test.ts`, `identity.test.ts`, and `fixtures/node-run-project/evals/`
- `.changeset/assertion-provenance.md` and `.changeset/connected-knowledge-foundations.md`

Steps:

1. Locate only the current assertion wire-schema builder, extraction decoder/repair loop, community graph/membership/report/view/cache code, Eval task lifecycle code, and their nearest focused tests using targeted `rg` queries.
2. Record the exact discovered paths in this plan before implementation if they differ from the path families below; do not reorganize unrelated modules.
3. Read pending changesets and identify the existing assertion and Connected Knowledge entries that own release notes.
4. Establish the current focused test commands, always with one worker. Do not make production changes in this phase.

## Phase 1 — Grouped portable assertion wire compiler

### 1A. Red tests: stable grouped slots and portable profile

Target source files (use the existing adjacent filenames discovered in Phase 0):

- `packages/core/src/knowledge/derive/assertion-wire.ts`
- `packages/core/src/knowledge/derive/assertion-runner.ts`
- `packages/core/src/knowledge/derive/prompt-bounds.ts`
- `packages/core/src/knowledge/derive/bounds.ts`
- `packages/core/src/knowledge/derive/manifest.ts`
- `packages/core/src/knowledge/assertions/assertions.ts`

Target tests:

- `packages/core/__tests__/knowledge/assertion-wire-schema.test.ts`
- `packages/core/__tests__/knowledge/assertions.test.ts`
- `packages/core/__tests__/knowledge/derive-diagnostics.test.ts`

Write failing tests first for:

1. Deterministic authored ordering maps kinds to `type_0`, `type_1`, … independent of authored identifiers, and produces one required closed root object with one required array per kind.
2. Each slot's item schema is closed; every generated property is required; absent kinds are represented by `[]`.
3. A recursive compatibility assertion rejects `oneOf`, `anyOf`, `allOf`, optional/nullable/type unions, unconstrained objects/records, and provider-inconsistent keywords anywhere in the provider-facing schema.
4. Closed required objects, homogeneous arrays, primitive types, integer/number distinction, string and numeric enums, bounded nesting/size, and descriptions remain typed.
5. Authored `.describe()` text survives on typed `data`, enums retain authored guidance, slot/evidence/provenance descriptions are present, and lowercase provenance enum values are provider-enforced.
6. Unsupported types fall back only in their own slot to required `dataJson: string`; neighboring portable types remain typed; the manifest records `typed | json-string` plus a stable diagnostic reason and expected-shape description.
7. Compiler version and normalized manifest affect the stage fingerprint, while chunk contents do not affect the generated schema/manifest.

Focused red command template:

```sh
pnpm --filter @use-crux/core exec vitest run packages/core/__tests__/knowledge/assertion-wire-schema.test.ts --maxWorkers=1
```

### 1B. Implement the compiler and manifest

1. Add a private compiler version constant and internal manifest types: stable slot, authored assertion identity, wire mode, original Zod schema reference, and fallback reason.
2. Normalize authored assertion ordering using the existing canonical ordering contract, then allocate positional slot names. Never derive slot names from authored IDs.
3. Recursively analyze each authored data schema against the portable profile. Enforce maximum depth/size deterministically and return structured fallback reasons.
4. Emit a single closed root schema. For every slot emit a required array of closed assertion items containing exactly one of required `data` or required `dataJson` according to the manifest, plus required evidence and provenance.
5. Preserve safe constraints and descriptions; summarize unsupported fallback shapes in prose without embedding unsupported schema constructs.
6. Thread the manifest/compiler version into the existing stage fingerprint without including batch/chunk content in the wire-schema identity.
7. Rerun the focused test with `--maxWorkers=1` until green; refactor only after green.

### 1C. Red tests: prompt, decode, validation, dedupe, and slot-scoped repair

Add failing tests to the existing extraction and repair suites for:

1. One generation call handles multiple assertion kinds for a bounded batch.
2. System/user prompts explain every slot, required empty arrays, no cross-slot/batch duplication, target-only evidence, provenance selection, `dataJson` encoding, and evidence-supported-only claims.
3. Decode restores canonical `type`, parses fallback JSON, and validates typed/parsed data with the original authored Zod schema.
4. Decode rejects mismatched/unknown slots, malformed JSON, invalid provenance, invisible evidence, evidence outside target chunks, and invalid authored data with exact slot-local diagnostics.
5. Canonical identity deduplicates equal assertions across slots/batches without discarding distinct valid assertions.
6. A mixed response retains valid first-attempt slots; repair receives only invalid slots and exact local failures, uses the same stable grouped schema, and replaces only invalid material.
7. Repair success and exhausted repair both return deterministic valid retained material and diagnostics.

Focused red command template:

```sh
pnpm --filter @use-crux/core exec vitest run packages/core/__tests__/knowledge/assertions.test.ts packages/core/__tests__/knowledge/derive-diagnostics.test.ts --maxWorkers=1
```

### 1D. Implement decode and repair

1. Decode strictly through the manifest; never trust generated type identity.
2. Parse `dataJson` with a caught, slot-addressed error, then run both modes through the original Zod schema.
3. Reuse the existing evidence visibility/target-admissibility checks and canonical assertion identity logic.
4. Partition valid and invalid slot material. Build repair feedback from exact local issues and merge repaired invalid material with retained valid assertions before final canonical dedupe.
5. Keep grouped extraction at one generation call per bounded batch, excluding actual repair calls.
6. Run each focused suite with `--maxWorkers=1`, then the combined assertion suites with `--maxWorkers=1`.

## Phase 2 — Assertion-aware deterministic community graph

### 2A. Red tests: projection, weights, and memberships

Target source files:

- `packages/core/src/knowledge/communities/assertion-policy.ts`
- `packages/core/src/knowledge/communities/types.ts`
- `packages/core/src/knowledge/communities/cluster-normalize.ts`
- `packages/core/src/knowledge/communities/graph-input.ts`
- `packages/core/src/knowledge/communities/cluster.ts`
- `packages/core/src/knowledge/communities/cluster-split.ts`
- `packages/core/src/knowledge/communities/cluster-parents.ts`
- `packages/core/src/knowledge/communities/reports.ts`
- `packages/core/src/knowledge/communities/report-schema.ts`
- `packages/core/src/knowledge/communities/records.ts`
- `packages/core/src/knowledge/communities/communities.ts`

Target tests:

- `packages/core/__tests__/knowledge/communities-cluster.test.ts`
- `packages/core/__tests__/knowledge/communities-build.test.ts`
- `packages/core/__tests__/knowledge/community-retained-refresh.test.ts`

Before production edits, encode this internal versioned policy in test fixtures and constants:

- Nodes: chunks, entities, and assertions each have canonical normalized IDs.
- Support edge weight from assertion `a` to visible evidence chunk `c`: `supportWeight(a,c) = 1 / visibleSupportCount(a)`.
- Assertion/entity affinity through visible evidence: for each entity linked to a supporting chunk, contribute `supportWeight(a,c) / max(1, entitiesInChunk(c))`; sum by entity and cap each assertion/entity pair at `1`.
- Explicit relation weights: support `1.0`, contradiction `1.0`, qualification `0.75`, supersession `1.25`; relation contribution is divided by the larger visible assertion degree of its endpoints to normalize prolific assertion sets.
- Per-source assertion-volume normalization: multiply all assertion-originating clustering contributions by `1 / sqrt(max(1, visibleAssertionsFromSource))`.
- Chunk/entity behavior retains its existing weight; a shared source document contributes no assertion-to-assertion merge edge by itself.
- Primary leaf membership: choose the leaf containing the visible support with greatest normalized support contribution; break ties by descending contribution, then normalized community ID, then chunk ID.
- Secondary leaf memberships: include each distinct remaining leaf whose support contribution is greater than zero, sorted by normalized community ID. Secondary membership affects report visibility only, never clustering weight or canonical primary identity.
- If an assertion has no admissible visible support, omit it from the view/projection.

Add failing tests for:

1. Assertion/evidence/entity/relation projection and exact edge weights above.
2. Deterministic primary tie-breaking and secondary memberships across input permutations.
3. Relation effects on leaf/parent affinity, no merge from shared source alone, and stable results when assertion volume is duplicated/prolific.
4. Every visible supported assertion gets exactly one primary leaf; secondary memberships do not multiply clustering influence.

Focused red command template:

```sh
pnpm --filter @use-crux/core exec vitest run packages/core/__tests__/knowledge/communities-cluster.test.ts --maxWorkers=1
```

### 2B. Implement projection and membership

1. Add a private membership-policy version constant and named internal weight constants/functions; expose no public tuning API.
2. Build the heterogeneous normalized projection and deterministic sorted adjacency lists.
3. Apply evidence, assertion/entity, explicit-relation, and per-source volume normalization exactly as specified above before clustering.
4. Compute primary/secondary membership after leaf communities are known; keep primary identity separate from report-only secondary availability.
5. Include normalized assertion projection, assertion relations, primary membership, membership-policy version, and any hierarchy-affecting secondary inputs in member hashes and lineage.
6. Rerun focused tests with `--maxWorkers=1` and refactor after green.

### 2C. Red tests: views, reports, counts, references, and caches

Add failing tests for:

1. View filtering removes assertions lacking visible admissible support and recomputes primary membership from the visible projection.
2. Relations with two visible endpoints are internal only when both resolve within the report community; cross-community visible relations are bounded boundary summaries; invisible endpoints are never presented as complete internal evidence.
3. Leaf report input contains member chunks, entities, primary/secondary assertions, internal relations, and bounded cross-community summaries in deterministic order.
4. Prompt guidance distinguishes canonical assertions from raw text and requires evidence/assertion-ID citations.
5. Finding assertion references validate against assertions in the report projection; unknown references fail local validation or are removed according to the existing report validation contract.
6. Leaf counts use unique identity sets for entities, chunks, and assertions across primary/secondary membership.
7. Parent counts union descendant identity sets instead of summing children.
8. Assertion/relation/membership-policy/report-prompt changes invalidate reusable reports; identical normalized projections across input permutations hit the same identity/cache entry.

Focused red commands:

```sh
pnpm --filter @use-crux/core exec vitest run packages/core/__tests__/knowledge/communities-build.test.ts --maxWorkers=1
pnpm --filter @use-crux/core exec vitest run packages/core/__tests__/knowledge/communities-cluster.test.ts --maxWorkers=1
pnpm --filter @use-crux/core exec vitest run packages/core/__tests__/knowledge/community-retained-refresh.test.ts --maxWorkers=1
```

### 2D. Implement views, reports, counts, and reuse identity

1. Reproject visible assertion support before assigning view memberships.
2. Classify relation presentation from visible endpoints and resolved communities; enforce the existing bound for boundary summaries.
3. Extend report inputs/prompts and locally validate finding assertion IDs.
4. Carry identity sets through leaf and parent aggregation, deriving public counts from set sizes at the final boundary.
5. Add the assertion projection, relations, policy version, and report-prompt version to reuse identity.
6. Run the three focused suites and then all community suites, each with `--maxWorkers=1`.

## Phase 3 — Eval-owned in-memory Knowledge Base terminal regression

### 3A. Red integration test before diagnosis

Target files:

- `packages/core/__tests__/eval/node-run.test.ts`
- `packages/core/__tests__/eval/fixtures/node-run-project/evals/` (new discovered fixture)
- `packages/core/__tests__/eval/defer-capture.test.ts`
- `packages/core/__tests__/eval/identity.test.ts`
- Existing `runDiscoveredEval()`, `coordinateNodeEval()`, `runEvalScope()`, and `openEvalCellScope()` implementations
- `packages/core/src/knowledge/communities/build.ts` if tracing identifies retained community refresh/lease/interval ownership there
- `packages/core/src/eval/internal/evidence/cache-epochs.ts` only if the fix changes evidence identity or reuse semantics

Add one integration regression whose Eval task:

1. Creates in-memory storage and an explicitly owned Knowledge Base.
2. Indexes chunks and assertions, creates relations and communities, and reads assertions, reports, and inspection state.
3. Disposes resources only where required by the public ownership contract.
4. Asserts terminal task, cell, coordinator, and saved-run events on success.
5. Repeats with an injected failure after resource creation and asserts terminal failure events.
6. Asserts no retained worker work, timers, captured signals, subscriptions/listeners, or effect scopes after both paths using observable lifecycle state or existing test instrumentation—not an arbitrary timeout.

Run the regression first against current code:

```sh
pnpm --filter @use-crux/core exec vitest run packages/core/__tests__/eval/node-run.test.ts --maxWorkers=1
```

Record the actual non-terminal event/resource owner in the test failure or a short code comment. If current behavior is terminal, keep the regression and do not invent a fix.

### 3B. Trace and fix the owning boundary

1. Follow only resources captured by the failing task from Knowledge Base creation through task/cell settlement and saved-run finalization.
2. Identify the owner that creates each retained signal, listener, timer, promise, or effect scope and the lifecycle boundary responsible for releasing it.
3. Add the smallest unit-level red test at that owner for both success and failure cleanup.
4. Fix cleanup in the owner/finalizer using the existing disposal contract; do not add timeouts or special-case Knowledge Base method names.
5. Prove idempotent cleanup and preservation of the original task error when cleanup also fails, following existing error aggregation semantics.
6. Run the owner unit test and integration regression separately with `--maxWorkers=1`, then together with `--maxWorkers=1`.

## Phase 4 — One-worker-only verification and release notes

### 4A. Update existing changesets

1. Read all pending `.changeset/*.md` files except `README.md`.
2. Update `.changeset/assertion-provenance.md` with the grouped portable wire behavior, local validation/repair, and user-visible compatibility improvement.
3. Update `.changeset/connected-knowledge-foundations.md` with assertion-aware community/report/view/cache behavior and, if externally observable, the Eval lifecycle fix.
4. Add only directly affected package front matter (`@use-crux/core`, expected `minor` for the new pre-stable behavior unless the owning existing changeset already has a higher necessary bump). Do not create a new changeset.

### 4B. Focused verification matrix

Run only after implementation, always serially/one worker:

```sh
pnpm --filter @use-crux/core exec vitest run packages/core/__tests__/knowledge/assertion-wire-schema.test.ts packages/core/__tests__/knowledge/assertions.test.ts packages/core/__tests__/knowledge/derive-diagnostics.test.ts --maxWorkers=1
pnpm --filter @use-crux/core exec vitest run packages/core/__tests__/knowledge/communities-cluster.test.ts packages/core/__tests__/knowledge/communities-build.test.ts packages/core/__tests__/knowledge/community-retained-refresh.test.ts --maxWorkers=1
pnpm --filter @use-crux/core exec vitest run packages/core/__tests__/eval/node-run.test.ts packages/core/__tests__/eval/defer-capture.test.ts packages/core/__tests__/eval/identity.test.ts --maxWorkers=1
```

Then run the package's existing assertion, community, and Eval test directories with `--maxWorkers=1`. Run the repository's normal typecheck/build only after these focused suites are green, and never introduce a multi-worker verification command into documentation or CI examples for this work.

Live provider smoke tests are optional and credential-gated. When available, exercise native OpenAI, Anthropic, Gemini, OpenRouter Luna, and an Anthropic-backed OpenRouter endpoint one at a time. Record them as time-bound smoke evidence, not permanent compatibility proof.

## Completion checklist

- [ ] All phases began with a focused red test and recorded the observed failure.
- [ ] Grouped extraction uses stable slots and one call per bounded batch; typed and fallback slots decode to the unchanged canonical assertion API.
- [ ] Provider-facing schemas recursively satisfy the portable profile and retain useful descriptions.
- [ ] Valid assertions survive slot-scoped repair; evidence and canonical dedupe are locally enforced.
- [ ] Community weights, normalization, tie-breaks, primary/secondary membership, and policy versions are explicit and deterministic.
- [ ] Views, report inputs, references, counts, identity, lineage, and reuse caches include assertion semantics without double counting.
- [ ] The Eval-owned in-memory Knowledge Base regression reaches terminal success and failure states and proves cleanup without arbitrary timeouts.
- [ ] Every test invocation used `--maxWorkers=1` or the runner's documented equivalent.
- [ ] Existing assertion and Connected Knowledge changesets were updated; no duplicate changeset was created.
- [ ] No generated output, build artifact, cache, or unrelated change is committed.
