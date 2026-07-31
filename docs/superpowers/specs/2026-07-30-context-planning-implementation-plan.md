# Context Planning Implementation Plan

Status: **proposed**

Plans the implementation of
[RFC #300 — Context planning](https://github.com/use-crux/crux/issues/300).

Authoritative semantics:

- [Whole-Request Context Management](./2026-07-27-whole-request-context-management-design.md)
- [Adaptive Execution Control](./2026-07-28-adaptive-execution-control-design.md)
- [Canonical Thread](./2026-07-24-thread-design.md) and
  [Message History Projection](./2026-07-25-message-history-projection-design.md)
  where not superseded

This document does not re-litigate semantics. It maps the approved design onto
the current codebase: what exists, what is removed, module layout, type
strategy, and a TDD-ordered build sequence with per-phase behavior lists.

## 1. Codebase reality map

What exists today and how each RFC concern lands on it:

| RFC concern | Current code | Disposition |
| --- | --- | --- |
| Managed language loop | `adapter/execution/{generate,stream}-{core,sdk}.ts`, `generation/orchestrate.ts` | Planning seals a `RequestPlan` before each provider call in both Core-owned and SDK-owned loops |
| `use[]` contributor graph | `prompt/context-types.ts` (`ContextEntry`, `ContributorEntry`), `prompt/contributor.ts` | Extended with representation-ladder entries; contributor union grows four wrapper tags |
| `when()` / `match()` | `prompt/context.ts:353–430` | Reused; epoch-pinning added in the planner, not in the wrappers |
| `tokenBudget` | `adapter/define-adapter-types.ts:64`, `resolver/system-budget.ts`, threaded through `define-adapter.ts` | Removed; replaced by `inputBudget` resolved by the planner |
| `prompt.inspect()` | `prompt/prompt-types.ts:368`, `runtime-bridge/prompt-preview/*` | Public API removed; runtime-bridge preview protocol re-targets `preview()` |
| Compaction helpers | `compaction/*` (`summarizeMessages`, `compactConversation`, `createSlidingWindow`, `createBudgetManager`, `extractKeyFacts`) | Module deleted; strategy internals (`summarize.ts` partitioning, `generate-object.ts` bridge) are salvage candidates for `summarize.*` strategies |
| Stateful `recentMessages()` | `memory/block-system.ts:1067`, exported from `/memory` | Removed; `history.recent()` replaces it |
| Token estimation | `shared/tokenizer.ts`, `resolver/ports.ts` counting port, `adapter/execution/media-token-budget.ts` | Reused as the fast-estimate tier; planner adds the authoritative-counter port |
| Model capacity profile | **Does not exist** (only embeddings carry `maxInputTokens`) | New: adapter/model capacity contract (context window, output reserve default, counting capability) — prerequisite for budget derivation |
| Thread | **Not implemented** (RFC #298 is a spec) | History projection is built against a `HistorySource` seam; caller-owned `messages` (already supported by adapter options) is the first source, Thread binds later |
| Defer host | `defer/` (node + serverless ports, retained tasks) | Reused as-is for summary maintenance scheduling |
| Storage / assets | `storage/`, `workspace/`, `asset/` | Reused for offload backing and content-addressed artifacts |
| Receipts / observability | `observability/`, `evidence/`, per-step `_meta` | `RequestReceipt` attaches to step results; full inspection goes through the existing observability retention pipeline |
| Eval evidence identity | `eval/internal/evidence/cache-epochs.ts` | `TASK_EVIDENCE_CACHE_EPOCH` bump when plan identity enters task evidence |
| Unrelated `plan()` | `plan/`, `tasks/` | Untouched; new internal dir avoids the name |

Tests live in `packages/core/__tests__/`. Run with
`pnpm --filter @use-crux/core test -- --run`.

## 2. Sequencing decisions

1. **Thread is not a blocker.** All history projection is written against an
   internal `HistorySource` contract with two initial implementations:
   caller-owned messages (exists today) and, when RFC #298 lands, Thread.
   Artifact identity already has a manual-mode answer (prefix digests), so
   nothing is throwaway.
2. **Model capacity profiles come first.** `inputBudget` derivation needs
   `contextWindow`, default output reserve, and counting confidence per
   resolved model. This is a small additive adapter-spec change and unblocks
   everything else.
3. **The planner runs even when it changes nothing.** From phase 1 on, every
   managed language call flows through measure → plan → seal, producing a
   receipt with `adaptations: []`. Later phases only add rungs and hooks to an
   already-load-bearing pipeline — no big-bang integration at the end.
4. **Removals happen in the phase that ships the replacement**, never earlier
   (no dead window) and never later (no duplicate mental models).
5. **`prepareStep`/`prepareInvocation` land after the grammar**, because
   amendments are validated against the same contributor/ladder machinery.
6. **stats/resources for hooks** are scoped by the Adaptive Execution Control
   design; this plan implements only what `prepareStep` V1 needs
   (`stats`, `resources.read`, `signal`) and leaves owner-handle `stats()`
   endpoints to that design's own plan.

## 3. Module layout

New internal directory: `packages/core/src/request/`. Public exports are
re-exported through `packages/core/src/index.ts`; nothing imports `request/`
internals from outside core. Every file stays under ~300 lines; when a concern
grows, split by the boundaries below rather than inflating a file.

```text
packages/core/src/request/
  index.ts                    // public re-exports only
  errors.ts                   // RequestCompositionError + reason codes + diagnostics type
  budget/
    input-budget.ts           // InputBudget type, validation, invocation override merge
    derive.ts                 // capacity → effective max, optimizeAt, reset watermark (hysteresis)
  capacity/
    model-profile.ts          // ModelCapacityProfile contract + resolution from adapter spec
  measure/
    estimate.ts               // fast whole-request estimate (reuses shared/tokenizer + media-token-budget)
    counter-port.ts           // authoritative provider counter port + confidence/margin
    breakdown.ts              // per-contribution token breakdown for receipts/inspection
  representation/
    wrappers.ts               // prefer(), summarizable(), offloadable(), offload(), droppable()
    ladder-types.ts           // nominal ladder tags + legal-composition types (§4)
    ladder.ts                 // runtime compile → ordered Ladder, invalid-composition preflight
    capabilities.ts           // sticky-capability resolution, protected-contract checks
  planner/
    candidates.ts             // enumerate legal complete-request candidates
    select.ts                 // two-tier fit, lexicographic fidelity, deterministic tie-breaks
    epoch.ts                  // model-epoch identity, monotonic fidelity floors
    plan.ts                   // sealed internal RequestPlan (immutable, pinned revisions)
    seal.ts                   // validate → lower via adapter → seal; overflow replacement (one shot)
  receipt/
    receipt.ts                // public RequestReceipt (JSON-safe, non-enumerable inspect())
    inspection.ts             // RequestInspection assembly, inspectRequest(), retention buffer
    adaptations.ts            // RequestAdaptation / warning vocabularies
  history/
    source.ts                 // HistorySource seam (manual messages now, Thread later)
    causal-groups.ts          // group-safe suffix selection, leading system-prefix rules
    recent.ts                 // history.recent() — stateless projection
    managed.ts                // history() — options, defaults, onMiss ladder
    strategies.ts             // summarize.adaptive/regenerate/rolling/hierarchical constructors
  artifacts/
    identity.ts               // content-addressed identity (source, strategy, model, prompt version, policy)
    lifecycle.ts              // trigger, defer scheduling, dedup, stale-while-revalidate, inline fallback
  offload/
    handle.ts                 // opaque owner-scoped handle, lifetime/tenancy validation
    publish.ts                // pre-dispatch publication over Storage/Workspace/assets
    support-tool.ts           // bounded provider-neutral retrieval capability (budgeted per candidate)
  prepare/
    step.ts                   // prepareStep orchestration in the managed loop
    invocation.ts             // prepareInvocation orchestration at composition boundaries
    amendment.ts              // ExecutionAmendment validation, add/remove identity rules
    step-context.ts           // immutable StepContext assembly
    resources.ts              // PreparationResources.read() mediator, ResourceReadError
  preview/
    preview.ts                // preview() — observational planning without side effects
```

Integration edits (existing files, kept small):

- `adapter/spec.ts` + `define-adapter-types.ts`: add `capacity` profile and
  optional `countTokens` hook; remove `tokenBudget` option.
- `adapter/execution/generate-core.ts` / `stream-core.ts` /
  `generate-sdk.ts` / `stream-sdk.ts`: call `planner.seal()` before each
  provider dispatch; attach receipts to step results; route `prepareStep`.
- `generation/orchestrate.ts`: epoch tracking across routing/fallback.
- `agent/agent.ts`, `define-adapter-types.ts`, generation option types:
  `inputBudget`, `prepareStep` config fields.
- `agent/{pipeline,swarm,parallel,consensus}.ts`: `prepareInvocation`.
- `prompt/context-types.ts`: `ContextEntry` union gains ladder entries.
- `memory/block-system.ts`, `compaction/`, resolver budget files: removals.

## 4. Type strategy

### Ladder grammar — nominal tags, not conditional types

The invalid compositions (`summarizable(offloadable(x))`,
`droppable(droppable(x))`, `prefer(droppable(x), y)`…) are rejected by
constructor parameter types using distinct nominal tags. No conditional-type
machinery is needed; each wrapper simply accepts only the tags below it in the
fixed order `source → prefer → summarizable → offloadable → droppable`:

```ts
interface PreferLadder<T> { readonly _tag: 'prefer'; /* … */ }
interface SummarizableLadder<T> { readonly _tag: 'summarizable'; /* … */ }
interface OffloadableLadder<T> { readonly _tag: 'offloadable'; /* … */ }
interface DroppableLadder<T> { readonly _tag: 'droppable'; /* … */ }

type SummarizableInput<T> = ContextSource<T> | PreferLadder<T> | readonly ContextSource<T>[]
type OffloadableInput<T> = ContextSource<T> | PreferLadder<T> | SummarizableLadder<T>
type DroppableInput<T> =
  | ContextSource<T> | PreferLadder<T> | SummarizableLadder<T> | OffloadableLadder<T>

declare function summarizable<T>(source: SummarizableInput<T>, opts?: SummarizeOptions): SummarizableLadder<T>
declare function offloadable<T>(source: OffloadableInput<T>, opts?: OffloadOptions): OffloadableLadder<T>
declare function droppable<T>(source: DroppableInput<T>): DroppableLadder<T>
```

Wrong nesting fails with a readable "not assignable" error at the exact
argument. Runtime preflight in `ladder.ts` remains the backstop for dynamically
constructed entries (`INVALID_COMPOSITION`).

`offloadable` is overloaded once more for the Tool `output:` policy position
(`offloadable({ aboveTokens })` with no source), and `offload(value)` returns a
branded forced-representation value usable both in `use[]` and as a Tool
return. Type tests (compile-pass and `@ts-expect-error`) live in
`__tests__/request-ladder-types.test.ts` alongside runtime tests.

### Operation-narrowed amendments

`ExecutionAmendment` follows the Adaptive Execution Control shape:
`CommonAmendment<Op> & AmendmentByOperation[Op]` with language contributing
`tools` / `activeTools` / `inputBudget`. V1 wires `language` only, but the
generic is introduced now so media operations later narrow instead of fork.

### JSDoc

Every public symbol gets full JSDoc in the `define-adapter.ts` style: one-line
summary, contract paragraphs (what it does *and* what it never does — e.g.
"never mutates canonical history"), `@param`/`@returns`, and a realistic
`@example` block. Module-level `@module` docblocks state the file's single
concern. Internal helpers document constraints only where code can't show them.

## 5. Build order

Each phase is a mergeable PR-sized unit, built test-first in vertical slices:
one behavior → red → minimal green → next behavior. The behavior lists below
are the ordered tracer bullets; they test public API only (through
`generate()`/`stream()` with fake adapters, and the exported constructors),
never planner internals.

### Phase 0 — Model capacity profiles

Adapter spec gains an optional `capacity(model)` hook returning
`ModelCapacityProfile { contextWindow, defaultOutputReserve, countingConfidence }`
plus optional `countTokens()`. First-party adapters (`ai`, `openai`,
`anthropic`, `google`) supply profiles for their known models with a
conservative fallback.

Behaviors:

1. An adapter without a profile yields a conservative derived budget and
   `measurement: 'conservative'` downstream (asserted in phase 1; here, the
   profile resolution function is exercised directly as public adapter API).
2. Known model → exact window; unknown model string → adapter fallback rule.

### Phase 1 — Measurement, `inputBudget`, sealed plan, receipts, exact default

The planner becomes load-bearing for every managed language call, with only
exact representations. Delivers: `measure/`, `budget/`, `planner/` (single
candidate), `receipt/`, `errors.ts`; `inputBudget` on agent/generation options;
`tokenBudget` removed; `result.steps[i].request` populated.

Behaviors:

1. A small exact request produces a receipt: resolved model, measured tokens,
   effective max, `measurement`, `adaptations: []`.
2. Derived budget: no explicit `inputBudget` → effective max =
   window − maxTokens − overhead − margin; absent `maxTokens` uses the profile
   reserve.
3. Invocation `inputBudget` overrides definition values per-field.
4. Oversized exact request fails **before dispatch** with
   `RequestCompositionError{ code: 'REQUEST_TOO_LARGE' }`, largest
   contributors named in diagnostics, no provider call recorded (fake adapter
   asserts zero calls).
5. Each tool-loop step gets its own linked receipt (`previousRequestId`).
6. Transport retry reuses the sealed request — one plan, one receipt, retry
   count visible; no re-measurement.
7. Estimated vs conservative measurement reported per counting capability.
8. `tokenBudget` no longer type-checks; resolver system-budget behavior is
   driven by the planner's budget.
9. Parity: the same behaviors pass through `generate-core` and `generate-sdk`
   loop paths (shared fixture matrix).

### Phase 2 — `history.recent()`

Stateless newest-suffix projection over the `HistorySource` seam
(caller-owned messages now). Removes stateful MemoryBlock `recentMessages()`
and `createSlidingWindow()`/`sliding-window-storage`.

Behaviors:

1. `history.recent(20)` selects the newest 20 messages; no Storage, no model
   calls (fakes assert).
2. Token cap, message cap, and both-caps selection at causal-group
   boundaries; an oversized newest indivisible group is kept whole and the
   overflow receipted.
3. Contiguous leading system-only prefix retained outside the caps; later
   system messages stay in causal position.
4. Manual-transcript mode projects the supplied array; automatic mode
   projects prior history and appends the current prompt outside the caps.
5. Two history projections in one resolved graph → composition error; zero
   history sources + a projection → actionable diagnostic.
6. Bare history source (no projection) is exact: over-watermark emits one
   deduplicated dev warning; over-max fails pre-dispatch pointing to
   `history.recent()` / `history()`.
7. Removal: `/memory` no longer exports `recentMessages`; migration notes in
   changeset.

### Phase 3 — Representation grammar: `prefer()`, `droppable()`, sticky capabilities

Ladder types, runtime compile, capability stickiness, and planner selection
across authored rungs (no generated artifacts yet).

Behaviors:

1. Type tests: every legal nesting compiles; each illegal form is a
   `@ts-expect-error`; dynamic invalid composition throws
   `INVALID_COMPOSITION` at definition preflight.
2. Under pressure, `prefer(full, compact)` selects `compact`; receipt records
   an `alternative` adaptation with both candidate sizes.
3. Below the watermark the full rung wins (two-tier selection: optimizeAt
   tier preferred, then strict tier, else failure).
4. `droppable(x)` omits only after smaller legal rungs are exhausted;
   omission receipted.
5. Plain contributors are never altered: pressure with no authorized rungs →
   `REQUEST_TOO_LARGE`, never silent loss.
6. Capabilities stay sticky: a `prefer()` alternative selection keeps the
   primary's tools/guardrails active; `droppable()` omission removes
   representation *and* capabilities; an alternative declaring different
   capabilities is rejected at definition time.
7. Fidelity ordering is lexicographic by priority then declaration order —
   deterministic across runs (property test with shuffled candidate
   enumeration order).
8. Monotonic epoch: after a contributor drops a rung, later steps in the same
   epoch never re-expand it; a `model` change re-plans from canonical sources.
9. Hysteresis: crossing optimizeAt then shrinking below the reset watermark
   does not oscillate representation between consecutive steps.

### Phase 4 — Managed `history()`, strategies, artifact lifecycle

`history()` options with derived defaults, `summarize.*` strategies (salvaging
`compaction/summarize.ts` partitioning and `generate-object.ts` internally),
content-addressed artifacts, defer-scheduled maintenance, onMiss ladder.
Removes `summarizeMessages()`, `compactConversation()`,
`createBudgetManager()`, `extractKeyFacts()` and deletes `compaction/`.

Behaviors:

1. `history()` under pressure = summary prefix + exact raw suffix; canonical
   source untouched (source fixture asserts immutability).
2. Summary artifacts are content-addressed: identical (range, strategy,
   model, prompt version, policy) → one artifact; concurrent preparation
   deduplicates.
3. Maintenance schedules through the defer host after the accepted turn and
   never delays completion (fake defer host records retained work; the
   response resolves first).
4. Stale-while-revalidate: valid older prefix summary + raw suffix used while
   a newer artifact prepares.
5. Miss ladder in order: fits-raw (schedule, don't block) → join in-flight →
   inline generate → other authorized rung → fail. Each rung observable in
   the receipt.
6. `onMiss: 'recent-only'` authorizes omission of older history;
   `onMiss: 'fail'` rejects; missing defer host falls back inline **with** a
   dev warning and never silently selects recent-only.
7. Summary model defaults to the resolved invocation model; strategy defaults
   to `summarize.adaptive()`; explicit `model`/`strategy` respected and part
   of artifact identity.
8. `providerNative: false` forces the portable path (fake adapter with a
   native-compaction capability asserts it is bypassed).
9. Manual-messages identity: prefix digests key artifacts; no Thread commit
   is inferred.
10. Preparation calls are receipted, linked support calls — never counted as
    agent steps; a preparation request cannot recurse into the same source's
    `summarizable()` policy.

### Phase 5 — `summarizable()`, `offloadable()`, `offload()`, Tool output policy

Generated-summary rungs for non-history sources reuse the phase-4 artifact
lifecycle. Offload publishes exact-recovery references over existing
Storage/Workspace/assets and injects the budgeted support capability.

Behaviors:

1. `summarizable(docs)` under pressure → summary rung; array input is one
   atomic unit with union capabilities (member collision fails at
   definition).
2. Exact-contract facets (schemas, guardrails, constraints) are never
   summarized; only authored `prefer()` can represent them compactly.
3. Offload selection publishes the handle **before** dispatch; the model view
   is a deterministic typed preview + retrieval path; canonical bytes are
   reused when already addressable, not duplicated.
4. The support retrieval capability is budgeted in every candidate that
   contains an offload rung; a Tool-less structured-output call makes the
   rung unavailable (planner skips it; no secret agent loop).
5. Handles are owner-scoped: cross-tenant/expired handle access fails; raw
   storage keys/URLs never appear in the model view (snapshot test).
6. `offload(value)` forces the rung and fails pre-dispatch without backing;
   Tool `output: offloadable({ aboveTokens })` lowers small results inline
   and large results by reference, with canonical `output` vs model-facing
   `modelOutput` distinguished in execution evidence.
7. Expired/revoked artifacts or handles invalidate affected plans before
   dispatch/replay (pinned revisions).

### Phase 6 — `prepareStep`

Constrained per-provider-call amendments across all managed language loops,
plus `resources.read()` V1 (`workingState()`, Blackboard).

Behaviors:

1. Hook runs once per provider call with immutable `StepContext` (index,
   reason, previous receipt, typed tool history, stats, signal); returning
   `undefined` changes nothing.
2. Amendment fields work end-to-end: `use.add`/`use.remove` (by entry
   identity and `{ id }`), `tools` + `activeTools` (unknown name fails
   pre-dispatch), `model` (new epoch), `inputBudget` (new epoch).
3. Amendments are boundary-scoped and non-accumulating: step N's removal does
   not affect step N+1's baseline.
4. Protected contracts reject removal unless the whole contributor was
   droppable; raw message/system replacement is not expressible (type test).
5. `resources.read()` returns `T | null`, memoizes per boundary, pins the
   revision the request also observes; undeclared/unauthorized/unresolved/
   storage-down reads throw distinct `ResourceReadError` reasons; no write
   API exists.
6. Accepted amendments are journaled: transport retry and overflow recovery
   reuse them without re-running the callback (spy asserts single
   invocation).
7. Callback throw/timeout prevents dispatch with a typed preparation error.
8. Parity matrix: identical semantics through core-owned and SDK-owned
   generate/stream loops, structured output included.

### Phase 7 — `prepareInvocation` + operation facets

Composition-boundary amendments for `pipeline()`, `swarm()`, `parallel()`,
`consensus()`, routers; receipt trees; contributor facet applicability.

Behaviors:

1. Hook runs before each managed leaf child with composition-typed context
   (stage/accumulator, hop/handoff, branch); function-only pipeline stages
   and nested compositions skip it.
2. Layering: definition + invocation + prepareInvocation = child baseline;
   child `prepareStep` composes on top; invocation amendment applies to every
   provider call of that child.
3. Composition results expose a linked tree of child request receipts.
4. Facet classification: applicable / dormant-facet / inert (rejected) /
   unsupported-required (pre-dispatch failure) / omitted-optional
   (receipted), starting with the language operation.

### Phase 8 — `preview()`, inspection, Devtools, Project Index, docs

Behaviors:

1. `preview()` returns `fits | over-limit | unknown` with prospective
   adaptations and never mutates: no artifacts generated, no offloads
   published, no maintenance scheduled, no Thread/Session writes (fakes
   assert zero side effects); over-limit returns, resolution errors throw.
2. `inspect()`/`inspectRequest()` return full redacted evidence while
   retained; expired evidence fails cleanly while the receipt stays useful;
   receipts survive JSON round-trips (`inspect` non-enumerable).
3. `prompt.inspect()` removed; runtime-bridge prompt-preview protocol serves
   `preview()`; devtools render the contribution map from inspection data.
4. Project Index (in `@use-crux/indexer` + native parity per AGENTS.md):
   history-projection cardinality, wrapper topology/invalid order, protected
   vs droppable, `inputBudget` definitions, hook references — conclusive
   diagnostics only where source structure proves them. Ship as its own
   change with parity fixtures updated together (semantic-backend rule).
5. Docs: apps/docs guides for context planning, history, budgets, hooks,
   receipts; migration page for every removed helper (semantic ownership
   changes, not just renames).

## 6. Cross-cutting obligations

- **Changesets.** One changeset owns the RFC #300 release theme; each phase
  updates it (raise bump, append notes) rather than adding new files. Bump:
  `minor` while pre-launch breaking removals are policy (`major` if the fixed
  group has crossed 1.0 by then). Affected: `@use-crux/core` plus adapter
  packages when their spec gains `capacity`/`countTokens`.
- **Eval evidence identity.** When plan identity (selected representations,
  amendment, resource revision hashes) enters task evidence (phases 6–7), bump
  `TASK_EVIDENCE_CACHE_EPOCH` in the same change and add stale-miss red tests.
  Summary artifacts introduce no new epoch — they are content-addressed.
- **No phase names in code.** Source and comments describe conditions, never
  "phase N" (repo rule).
- **Observability.** Receipts/adaptations reuse the canonical event spine
  (ADR 0001); no new store. Sensitive content never enters receipts,
  diagnostics, or artifact identity (redaction tests per phase).
- **File size.** Any `request/` file approaching 300 lines splits along the
  §3 boundaries first.

## 7. Risks and watch items

1. **Thread landing order.** If #298 lands mid-stream, bind `HistorySource`
   to Thread in a focused follow-up; artifact identity switches from prefix
   digests to Thread revisions per the design's table. Keep the seam narrow
   (one interface, two implementations) so this is additive.
2. **SDK-owned loop parity.** `packages/ai` owns its own loop; sealing a plan
   per step requires surfacing each provider-call opportunity. If the AI SDK
   cannot expose a step boundary, fail preflight loudly (design rule: never
   silently skip planning). Prototype this in phase 1, not phase 6.
3. **Counting cost.** Authoritative counters only near decision boundaries;
   watch fixture latency and cache counter results per sealed candidate.
4. **Selection blow-up.** Ladders multiply candidates; enumerate greedily by
   lexicographic fidelity order and prune candidates that cannot fit the
   strict tier before full measurement.
5. **`resources.read()` scope creep.** V1 admits `workingState()` and
   Blackboard only; every other resource kind is a typed error, not a warning.
