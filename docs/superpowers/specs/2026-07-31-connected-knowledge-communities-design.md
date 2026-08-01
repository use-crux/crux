# Connected Knowledge Communities Design

Status: **checkpoint spec for the communities stage of
[#303](https://github.com/use-crux/crux/issues/303)**

References:

- [Implementation plan](../plans/2026-07-30-connected-knowledge-plan.md)
  (stage 5 checkpoint requirement and dependency ruling: communities depend
  primarily on #299 Work/Runtime; #286 supplies evidence relationships; not
  #196 Effects).
- RFC #303 sections "Communities", "Community report", "Hierarchy defaults",
  "Maintenance and readiness" are binding; this spec resolves only what they
  deliberately left open.

## Scope

Everything here is implementable now on the no-Runtime path. The single #299
seam is the retained-refresh port in "Runtime seam" below; nothing else in
this spec may depend on durable execution.

## Configuration

```ts
const docs = knowledgeBase({
  // ...
  communities: communities({ model }),
})
```

`communities({ model })` requires a named `KnowledgeModel` (same contract as
every paid stage). No algorithm, seed, level-count, or size options in V1.
The strategy fingerprint covers: strategy version constant, model
name/fingerprint, and the internal bound constants below — so changing any
bound invalidates materializations honestly.

Wiring this requires two concrete extensions the current code lacks:
`communities` is a new field on `KnowledgeBaseConfig` (exported factory
`communities()` from `@use-crux/core/knowledge`), and the connected
integration's opt-in predicate widens from "non-empty `derive`" to "any
non-recoverable connected feature configured" — a configured `communities`
triggers graph mapping/compilation even with no authored derive stages,
exactly as the plan's resolved decision 1 lists.

When `relate.entities({ model })` is configured, its published entities,
mentions, and semantic edges are the mapping input and no additional mapping
extraction runs. When it is not configured, `communities` authorizes one
bounded generic mapping pass reusing the exact `relateEntities` stage
machinery internally (same claim cache, same generic vocabulary), so mapping
is never a second implementation.

## Input graph

One materialization is keyed by `(viewRevision, graphGeneration,
strategyFingerprint)` exactly as the plan states. The build reads, for the
pinned view members only:

- entities with at least one visible mention;
- evidence-backed semantic edges (typed vocabularies and generic `related`)
  whose support is visible in the view;
- chunk→entity mentions as the entity–evidence weighting signal;
- assertions as **side inputs only**, never cluster nodes: an assertion
  attaches to the communities its evidence chunks land in, referenced in
  reports through stage-scoped `assertionRefs` — the plan's ruling that
  assertion records never masquerade as graph structure holds here too.

Virtual structural edges do not connect communities (hierarchy/sequence is
intra-source structure, not cross-source semantics); they only inform the
residual-chunk fallback assignment below.

## Clustering: deterministic bounded agglomeration

V1 algorithm (internal, swappable, never user-visible):

1. **Weights.** Node set = entities. Edge weight = count of distinct
   evidence supports between two entities (semantic edge supports, plus
   co-mention within one chunk counting once per chunk).
2. **Level 0.** Connected components of the weighted graph.
3. **Bounding.** A community is *oversized* when its estimated report input
   (member descriptions + finding evidence excerpts, counted in characters)
   exceeds `COMMUNITY_INPUT_BUDGET` (constant, 24_000 chars). Oversized
   components split by greedy agglomeration: start from singleton clusters,
   repeatedly merge the pair with the highest total inter-cluster weight
   whose merged size stays within budget; ties break by lexicographic
   smallest member id. Iteration order is fully determined by sorted node
   ids, so the partition is a pure function of the input graph.
4. **Parents.** Bounded communities agglomerate upward with the same greedy
   rule against a `PARENT_INPUT_BUDGET` (4× the leaf budget, summaries only)
   until a single corpus root remains. Level numbers are internal ordinals;
   query detail never references them.
5. **Chunk assignment.** Every view-visible chunk assigns to exactly one
   leaf by a deterministic rule: a chunk with mentions goes to the community
   holding its strongest-weighted mentioned entity (weight = mention count,
   ties by lexicographic entity id, then community id); a chunk with no
   clustered evidence — whether its source has other clustered chunks or
   none at all — goes to a per-source **fallback community** (chunks in
   ordinal order, split at the leaf input budget, attached directly under
   the root). Coverage is total by construction: every visible chunk is
   reachable from exactly one leaf.

Invariants (each is a red test):

- Partition determinism: identical input graph → identical community ids.
- Total coverage: every view-visible chunk belongs to exactly one leaf
  (clustered or fallback).
- Budget: no leaf community's report input exceeds the budget constant.
- Isolation: communities never span namespaces or view boundaries.

Community identity = stable hash of sorted member identities (entities,
assertion ids, fallback chunk refs). The same member set therefore keeps its
community id across builds, which is what makes report reuse possible.

## Report

An immutable structured derived record, one per published community:

```ts
interface CommunityReport {
  readonly communityId: string
  readonly generationId: string
  readonly level: number
  readonly parentCommunityId?: string
  readonly title: string            // bounded, 120 chars
  readonly summary: string          // bounded, 2_000 chars
  readonly findings: readonly {
    readonly id: string
    readonly statement: string      // bounded, 500 chars
    readonly evidence: readonly KnowledgeRef[]  // non-empty
    readonly assertionRefs?: readonly { assertionId: string }[]
  }[]
  readonly lineage: {
    readonly viewRevision: string | null   // null = whole-corpus scope
    readonly graphGeneration: string
    readonly strategyFingerprint: string
    readonly memberHash: string
  }
  readonly counts: { readonly entities: number; readonly chunks: number; readonly assertions: number }
}
```

Report generation is bottom-up: leaf reports from member evidence; parent
reports from admitted child findings only (never from raw evidence, never as
an independent source of claims). Model output validates against the report
schema with one repair retry; a community whose report fails validation
twice fails the build — partial generations are never published.

Reports are not source documents: they do not enter view membership, vector
retrieval, chunking, or community construction. They live in their own
keyspace and are reachable only through the communities surface (and later
global search/Devtools/citations).

Reuse: before calling the model for a community, look up the prior
generation's report by `(communityId, memberHash, strategyFingerprint)` —
member-identical communities reuse the prior report verbatim, making
incremental corpus growth pay only for changed communities even though V1
reclusters fully.

## Storage

Same generation discipline as the knowledge graph, in a sibling keyspace:

```
indexer:<id>:namespace:<ns>:communities:<scopeKey>:current        → { generationId }
indexer:<id>:namespace:<ns>:communities:<scopeKey>:gen:<gen>:report:<communityId>
indexer:<id>:namespace:<ns>:communities:<scopeKey>:gen:<gen>:index:<level>:<communityId>
indexer:<id>:namespace:<ns>:communities:<scopeKey>:dirty          → dirty ledger
```

`scopeKey` = stable hash of `(viewId or 'corpus', strategyFingerprint)`;
the generation record itself stores the exact `(viewRevision,
graphGeneration)` pair it was built from. Build → validate-complete → one
atomic pointer swap; retention-gated cleanup of replaced generations follows
`lifecycle.retention`.

## Dirty ledger and staleness

`afterIndex()`/`afterRemove()` write one ledger record **keyed by source id**
(idempotent `put`; the value carries the reason — indexed or removed — and
the last-touch timestamp). Repeated or concurrent hooks for the same source
converge on one record; no monotonic sequence is required from the store.
Staleness is a pure comparison: current pointer's `(viewRevision, graphGeneration)` versus the
live view revision and published graph generation, plus a non-empty ledger.
The ledger never drives partial rebuilds in V1 (full recluster + report
reuse covers it); it exists so `status()` can say *why* the materialization
is stale and so the future retained-refresh Work has a trigger record.

## Readiness lifecycle

```ts
await view.communities.status()   // 'missing' | 'building' | 'ready' | 'stale'
await view.communities.prepare()  // ensure current; no-op when ready
await view.communities.prepare({ force: true })  // repair/prewarm rebuild
```

- Consumption (`reports()`, later `globalSearch()`) auto-ensures readiness by
  awaiting `prepare()` in-process.
- Single-flight: one build per `scopeKey` per process (in-process promise
  cache) plus a storage-level build lease claimed with `RecordStore.create()`
  — the existing create-if-absent primitive is the compare-and-swap; the
  holder heartbeats via `put` and a lease without a heartbeat for the lease
  TTL is claimable by deleting and re-`create()`ing. Builds are **idempotent
  and at-least-once**: two processes racing a stale lease may both build,
  and generation-scoped idempotent writes plus the atomic pointer swap make
  the duplicate harmless. Changes during a build coalesce into at most one
  follow-up build.
- Without Runtime, `status()` returning `'stale'` is a supported steady
  state; a development diagnostic (once per process per scope) reports the
  stale reason. Nothing ever silently spawns detached background work.

### Runtime seam (#299)

One injected port, unused until the Runtime lands. The descriptor is
serializable so a durable host can run/join it from another process; builds
stay idempotent at-least-once so the guarantee holds under either host:

```ts
interface CommunityBuildDescriptor {
  readonly indexerId: string
  readonly namespace: string
  readonly scopeKey: string
  readonly viewId?: string
}

interface CommunityRefreshHost {
  /** Ensure a build for the descriptor runs to completion; joining an
   * in-flight equivalent build satisfies the call. */
  ensure(descriptor: CommunityBuildDescriptor): Promise<void>
}
```

Without a host, `prepare()` awaits the in-process build; with one it
delegates to `ensure()`. Core registers the build executor for descriptors
at knowledge-base construction. No other module may reference Runtime
concepts.

## Consumption surface (this stage)

`kb.communities` / `view.communities` expose `status()`, `prepare()`, and
`reports({ level?, parentId?, cursor, limit })` — lazy paginated reads of the
current generation for Devtools and tests. Query-time composition
(`globalSearch()`) is the next stage and out of scope here.

## Failure behavior

- No configured `communities` → surface absent; nothing builds.
- Model failure after retry on any community → build fails atomically, prior
  generation stays current, error names the community and cause.
- Empty view → publishes an empty-but-complete generation (status `ready`,
  zero reports), not an error.
- Deleted/redacted evidence: report reads re-verify lineage against current
  authorization; a report whose generation references a revoked view
  revision is not served — status flips to `stale`.

## Non-goals (restated from the RFC)

Custom clustering algorithms or level counts; cross-namespace community
sharing; request-time filtering of broad reports; reports feeding back into
membership or vector retrieval; background work without a Runtime host.
