# Connected Knowledge Global Search Design

Status: **checkpoint spec for the global-search stage of
[#303](https://github.com/use-crux/crux/issues/303)**

References:

- [Implementation plan](../plans/2026-07-30-connected-knowledge-plan.md)
  (stage 6 checkpoint requirement; depends on #299 Work/Runtime plus #300
  planning/budget machinery for the integration seams only).
- [Communities design](./2026-07-31-connected-knowledge-communities-design.md)
  supplies the report hierarchy this stage consumes.
- RFC #303 sections "Global search", "Breadth and detail", "Freshness",
  "Execution control", "Citations", and "Receipts" are binding; this spec
  resolves batching, estimation, compensation, and the seams.

## Scope

Implementable now except two thin seams marked below (#299 wait-on-Work,
#300 root budgets). The built-in safety ceiling makes the step safe without
either.

## Hit kinds and the one-producer rule

The current `RetrieverHit` is chunk-shaped (`source`, `chunkId`, `metadata`
are required), so findings cannot ride it honestly. `RetrieverHit` becomes a
discriminated union: `EvidenceHit` (today's shape, `kind?: 'evidence'`,
absent means evidence — every existing producer compiles unchanged) and
`FindingHit` (`kind: 'finding'`, `content` = finding statement, `score`,
`namespace`, and a required `citation: FindingCitation` in place of
chunk fields). Built-in hit-phase steps narrow on `kind` before touching
chunk fields — updating them is part of this stage, not an afterthought.

A recipe has exactly one producer. `retrievalRecipe()`/`kb.recipe()` reject,
at construction time, step lists containing more than one step of a producer
kind (`retrieve`, `global-search`) — a new `RetrievalStepKind`
`'global-search'` marks the step; the existing `retrieve` kind is the other
producer. Type-level enforcement is best-effort (tuple filtering on the
const steps array where inference allows); the construction-time runtime
check is authoritative and its error names both producer step ids.

Steps that cannot operate on findings declare it: `expandParents` and
`expandRelations` skip `finding` hits (they pass through unchanged) and emit
one warning naming the skipped count. `rerank` and `compressToBudget` accept
both kinds.

## Step surface

```ts
globalSearch({
  model,                       // KnowledgeModel, required
  scan: 'all' | 'adaptive',    // default 'all'
  detail: 'auto' | 'overview' | 'detailed',  // default 'auto'
  limit?: number,              // max findings emitted, default 20
})
```

`RetrievalStep<'queries', 'hits'>`. It requires the recipe knowledge binding
plus a communities binding (the bound read surface's communities handle);
unbound recipes fail with the actionable diagnostic pattern. It rejects any
request-level filter (ephemeral narrowing) because reports may aggregate
evidence the filter would exclude: a request with a filter fails before any
model call, directing users to a typed view. View-scoped recipes are the
supported narrowing path.

## Detail selection and map/reduce

- `overview`: parent-level reports only (all non-leaf levels).
- `detailed`: leaf reports (clustered and fallback).
- `auto`: deterministic choice from the normalized query, pinned community
  generation id, strategy fingerprint, step config, and model fingerprint —
  hashed into a stable pick between overview and detailed. Available budget
  never participates.

Map phase: selected reports are packed into batches by report character
size against `GLOBAL_SEARCH_BATCH_BUDGET` (24_000 chars, constant), order =
hierarchy level then community id, so batching is deterministic. One model
call per batch produces rated candidate findings (statement + source finding
ids + 0–100 relevance) validated with one repair retry; a failed batch after
repair fails the whole step before any result is exposed (never a silently
partial scan under `scan: 'all'`).

Reduce phase: **deterministic, no model calls** — candidates merge by cited
finding id sets; scores combine by max; ties break by community id. Top
`limit` findings become `finding` hits with score normalized to (0, 1]. The
consuming model/recipe sees only the complete validated set — no streaming
of partial batches.

`scan: 'adaptive'` (explicit recall-risk opt-in): map the root and its
children first, then descend only into branches whose parent-batch rating
meets the fixed descent threshold (50), bounded by the same batch budget.
The descent trace (visited/skipped community ids and ratings) is receipted.

## Preflight and the safety ceiling

Before any model call the step computes: selected report count, batch
count, estimated input characters, and estimated call count (map batches
only — the reduce phase is deterministic). If estimated calls exceed
`GLOBAL_SEARCH_MAX_CALLS` (32, constant) the step fails before spend with
the counts and the three remedies the RFC names (overview, adaptive, or a
narrower view). Preflight never mutates `scan` or `detail`.

**#300 seam:** when root execution budgets land, a single injected
`admit(estimate)` hook runs after the built-in ceiling; absent hook = no
change. Nothing else references budgets.

## Freshness

Resolution order against the pinned view revision, matching the RFC:

1. Exact generation for `(viewRevision, graphGeneration, strategy)` → use it
   (`coverage: 'exact'`).
2. Generation exists for an older revision whose diff to the pinned revision
   is only additions, and the additions fit one map batch → use its reports
   plus one direct-mapping batch over the added sources' chunks
   (`'compensated'`).
3. Removals/replacements affecting members: exclude every report whose
   community contains a removed member; direct-map the remaining current
   evidence only when it fits one batch (`'compensated'`); otherwise fall
   through.
4. No usable generation and the whole view fits one batch → raw-evidence
   fallback (`'raw-fallback'`, explicitly receipted).
5. Otherwise → run/join the materialization build and wait
   (`'materialization-wait'`); with a Runtime host this is retained Work
   (#299 seam via `CommunityRefreshHost`), without one it awaits in-process.

The step never searches only stale reports while claiming current coverage.

## Citations

A `finding` hit's provenance carries an immutable bundle:

```ts
interface FindingCitation {
  readonly findingTarget: string            // opaque handle issued by the step
  readonly supports: readonly KnowledgeRef[] // transitive original evidence
  readonly assertionRefs: readonly { assertionId: string }[]
  readonly lineage: { readonly viewRevision: string | null; readonly communityGeneration: string; readonly reportCommunityId: string }
}
```

Models may cite only issued handles. A finding is never rendered as a
verbatim quote; verbatim quoting requires resolving a `supports` ref to
original evidence through the ordinary visibility path (revoked evidence
invalidates the citation immediately because resolution re-checks current
authorization).

## Receipts

The existing recipe `StepTrace` has no knowledge slot today — extending
`StepOutput`/`StepTrace` with a typed `knowledge` payload and threading it
through the step runner is in-scope work for this stage. Once threaded, the
trace gains a `knowledge` entry per contributing step run:
contributor id, view id + exact `viewRevision`, recipe id/fingerprint,
generations consumed, coverage basis (`exact | compensated | raw-fallback |
materialization-wait`), scan/detail, available vs processed report counts,
adaptive descent trace, preflight estimate, and every truncation. This
lives on the existing recipe trace surface now; surfacing as
`result.receipt.knowledge` on execution results is a mechanical projection
added when the #300 execution-result work merges (the trace record shape is
final here so no re-recording is needed).

## Failure behavior

- Missing communities config → construction-time error naming
  `communities({ model })`.
- Request filter present → fail before spend.
- Ceiling exceeded → fail before spend with remedies.
- Any map/reduce batch invalid after one repair → step fails; no partial
  finding set is ever emitted.
- Producer-rule violation → recipe construction error.

## Non-goals

Filtering broad reports at request time; per-step budget/concurrency/retry
options; streaming partial findings; a second citation product; adaptive as
a silent fallback for cost.
