# Connected Knowledge (#303) — TDD implementation plan

Status: **ready to implement (stages 1–4); stages 5–6 need a design checkpoint
before their first task**

Specification:

- [RFC #303 Connected knowledge](https://github.com/use-crux/crux/issues/303)
  is the binding design. This plan maps it onto the codebase and orders the
  work; where the two disagree, the RFC wins.
- Related: #95, #143, #211, #220, #237, #286, #299, #300.

## Resolved design decisions (2026-07-30 RFC review)

Six implementation questions were escalated to the RFC author and resolved;
the refinements below are binding and should be reflected in #303 itself:

1. **Virtual structural graph.** Plain KnowledgeBases persist no structural
   edges and create no graph generations. Hierarchy, parent/child, ordering,
   and source/Asset provenance always exist *logically*, projected from
   existing source/parent/chunk records. Persisted graph generations begin
   only when non-recoverable connected features are configured (non-empty
   `derive`, relations/assertions, communities). `derive: []` is not an
   opt-in switch. Storage adapters may materialize structural adjacency as a
   transparent optimization; correctness never depends on it.
   `expandRelations()` may traverse requested virtual structural relations
   even without derive stages.
2. **`@use-crux/core/knowledge` is the canonical entrypoint** for
   `knowledgeBase`, KnowledgeBase/View types, `KnowledgeRef`, `relate`,
   `assertions`, `communities`. `/indexing` owns pipeline composition;
   `/retrieval` owns query-time recipe steps (`expandRelations`,
   `globalSearch`) and keeps re-exporting `knowledgeBase()` for the
   simple-RAG path.
3. **View vector retrieval** compiles the predicate into bounded disjunctive
   `ExactFilter` branches with exact failure semantics (see the View
   contract section). No RRF across branches — they partition one query and
   their scores are comparable.
4. **Model identity** requires `name` *and* `fingerprint` (see
   `KnowledgeModel`). No position-derived or object-identity fallback.
5. **`AssertionRef`/`AssertionRelation`** are a distinct contract;
   `KnowledgeRefKind` stays closed. `expandRelations()` does not traverse
   assertions in V1; support records are never disguised as graph edges.
6. **Checkpoint specs before stages 5 and 6.** Communities depend primarily
   on #299 Work/Runtime; global search additionally on #300 planning/budget;
   #286 supplies evidence relationships. Neither depends on #196 Effects —
   derived indexing and community materialization are explicitly not
   Effects.

## Operating protocol

Work in the order below. Every task uses red-green-refactor:

1. Add the smallest focused failing runtime or type test.
2. Run it and confirm it fails for the intended reason.
3. Add the minimum production behavior.
4. Run the focused test until green.
5. Refactor types, JSDoc, and module boundaries while green.
6. Run `pnpm --filter @use-crux/core test -- --run` and the package typecheck
   before moving on.

Tests assert public behavior (`knowledgeBase()`, recipes, stores through their
interfaces), never private helpers. Runtime tests live in
`packages/core/__tests__/knowledge/` and `packages/core/__tests__/retrieval/`;
type tests live in `packages/core/__type_tests__/*.test-d.ts`. All storage
tests run against `inMemoryStorage()`; no network I/O. Behavior that both the
portable RecordStore path and optimized Storage ports must satisfy lives in a
shared connected-knowledge conformance suite from the start, so later ports
run the same tests.

## Ground rules

- **No phase references in code.** Source files and comments never mention this
  plan's stage numbers; guard behavior by capability/config conditions instead.
- **File size.** Split any new module approaching ~300 lines into
  concern-specific files. The layout below is pre-split accordingly.
- **JSDoc.** Every public symbol gets JSDoc in the house style
  (`packages/core/src/adapter/define-adapter.ts`,
  `packages/core/src/retrieval/knowledge-base.ts`): `@module` header stating
  the file's single concern, one-sentence summaries, `{@link}` cross-refs,
  `@example` on primary factories, `Internal.` suffix on internal exports.
- **Dependency direction.** Everything lands in `@use-crux/core`. No provider
  SDKs; models arrive through the existing `RetrievalModel`-style port.
- **Cache identity.** Over-invalidate, never under-invalidate. Every stage
  fingerprint participates in pipeline/graph identity; if Project Index
  discovery of these definitions changes indexer output later, bump the epochs
  listed in `AGENTS.md` in the same change.
- **Changesets.** Each stage that ships public API updates the pending
  connected-knowledge changeset (minor) rather than adding a new one per task.
- **Docs.** Each stage ends with an `apps/docs` update for the surface it
  shipped; the progressive path (plain KB → view → relations → communities →
  assertions) is the narrative spine.
- **Non-goals are load-bearing.** No graph DB, no global ontology registry, no
  view query DSL beyond scalar/`IN`/`any`, no persisted similarity edges, no
  implicit paid extraction, no `refresh()` on views/communities.

## Codebase anchors

| RFC concept | Existing code |
| --- | --- |
| `knowledgeBase()` facade | `packages/core/src/retrieval/knowledge-base.ts` (+ `knowledge-base-runtime.ts`) |
| `indexingPipeline()` stages + fingerprint | `packages/core/src/indexing/pipeline.ts`, `types.ts` (`IndexingPipelineConfig`) |
| Pipeline execution | `packages/core/src/indexing/pipeline-runner.ts`, `index-writer.ts` |
| Persisted read model (chunk/parent records, keys) | `packages/core/src/indexed-knowledge/{records,keys,store}.ts` |
| Recipe steps (`retrieve`, `rerank`, `expandParents`) | `packages/core/src/retrieval/recipe/steps/built-ins.ts`, `recipe/step.ts` |
| `RetrieverHit`, provenance | `packages/core/src/retrieval/types.ts` |
| `RecordStore` contract | `packages/core/src/storage/types.ts` |
| Metadata filter typing | `KnowledgeBaseFilter` in `retrieval/knowledge-base.ts`, `retrieval/request.ts` |
| Citations/grounding | `packages/core/src/citations` |
| Evidence fingerprints (evals) | `packages/core/src/eval/internal/evidence` |

## New module layout

New domain directory `packages/core/src/knowledge/`, exported as
`@use-crux/core/knowledge` — the canonical home for `knowledgeBase`,
KnowledgeBase/View types, `KnowledgeRef`, `relate`, `assertions`, and
`communities`. `/retrieval` keeps re-exporting `knowledgeBase()` for
compatibility and owns the query-time steps; `/indexing` owns pipeline
composition. The fact that `relate()` produces a derive stage is an
implementation interface, not a reason to split its user-facing home:

```
packages/core/src/knowledge/
  index.ts            public exports only
  refs.ts             KnowledgeRef union, guards, canonical encoding
  keys.ts             record key builders (edges, entities, aliases, claims,
                      generation pointer) — extends the indexed-knowledge
                      `indexer:<id>:namespace:<ns>:` prefix contract
  records.ts          edge/entity/support record codecs (mirror of
                      indexed-knowledge/records.ts discipline: no raw casts
                      outside this file)
  generation.ts       graph generation ownership: build ids, complete-validate,
                      atomic current-pointer swap, retention-gated cleanup
  graph-store.ts      bounded adjacency + entity reads over RecordStore
                      (out/in prefix scans, hydration, visibility filtering)
  structural.ts       virtual structural relations (hierarchy, ordering,
                      source/asset provenance) projected on read from indexed
                      records — never persisted by core
  derive/
    stage.ts          DeriveStage contract (claims, evidence handles, modes)
    runner.ts         derive-phase execution, batching, claim caching
    targets.ts        locator resolution (ids, URLs, titles, aliases, anchors)
  relate/
    relate.ts         relate() vocabulary factory + type contracts
    references.ts     relate.references() deterministic reference resolution
    entities.ts       relate.entities({ model }) generic extraction
  view/
    view.ts           view() handle, at(revision), read-surface parity
    where.ts          typed where-clause types + normalization/validation
    membership.ts     incremental exact-value indexes, revision resolution
  assertions/
    assertions.ts     assertions() stage factory
    set.ts            AssertionSet list/stream handles
    identity.ts       canonical assertion identity + support merging
    resolution.ts     resolve() handle (status/prepare/result)
  communities/        (stage 5 — see design checkpoint)
  global-search/      (stage 6 — see design checkpoint)

packages/core/src/retrieval/recipe/steps/expand-relations.ts
packages/core/src/retrieval/knowledge-base-views.ts   view/assertions wiring so
                                                      knowledge-base.ts stays
                                                      under the size budget
```

Devtools projection additions ride the existing runtime-bridge/devtools
surface; Go/local changes (explorer UI) are follow-up work in
`packages/local` after the core read model exists.

## Foundational contracts

These are the contracts every later task builds on. Pin them with type tests
first; they are deliberately small.

### KnowledgeRef (`knowledge/refs.ts`)

```ts
/** Closed set of reference kinds connected knowledge can address. */
export type KnowledgeRefKind = 'document' | 'parent' | 'chunk' | 'entity'

/** A precise, kind-discriminated reference to indexed evidence. */
export type KnowledgeRef =
  | { readonly kind: 'document'; readonly sourceId: string }
  | { readonly kind: 'parent'; readonly sourceId: string; readonly parentId: string }
  | { readonly kind: 'chunk'; readonly sourceId: string; readonly chunkId: string }
  | { readonly kind: 'entity'; readonly entityId: string }
```

`refs.ts` owns `encodeKnowledgeRef`/`decodeKnowledgeRef` with a canonical
key-safe encoding. Existing indexed-knowledge keys interpolate raw ids; edge
keys embed *two* refs plus a type, so segments must be escaped
(percent-encode `:` and `%`) to keep prefix scans collision-free. Round-trip
property tests are the first red test of the whole effort.

### Record keys (`knowledge/keys.ts`)

Extend the existing namespace prefix; one generation pointer, generation-scoped
artifacts, directional adjacency mirrors:

```
indexer:<id>:namespace:<ns>:knowledge:current                    → { generationId }
indexer:<id>:namespace:<ns>:knowledge:gen:<gen>:edge:<edgeId>
indexer:<id>:namespace:<ns>:knowledge:gen:<gen>:adj:out:<fromRef>:<type>:<edgeId>
indexer:<id>:namespace:<ns>:knowledge:gen:<gen>:adj:in:<toRef>:<type>:<edgeId>
indexer:<id>:namespace:<ns>:knowledge:gen:<gen>:entity:<entityId>
indexer:<id>:namespace:<ns>:knowledge:gen:<gen>:alias:<alias>:<entityId>
indexer:<id>:namespace:<ns>:claims:<stageId>:source:<sourceId>:<claimHash>
indexer:<id>:namespace:<ns>:assertions:<stageId>:gen:<gen>:item:<assertionId>
indexer:<id>:namespace:<ns>:view:<viewId>:index:<field>:<value>:<sourceId>
indexer:<id>:namespace:<ns>:view:<viewId>:revision:<revisionHash>
```

Adjacency entries are pointer records (edge id + type + peer ref) so traversal
is prefix `list()` + `getMany()` — portable on any `RecordStore`. Symmetric
relations write both directions against a direction-normalized edge id.

### Two-layer generation model (`derive/runner.ts` + `generation.ts`)

Derive stages run **per source document** during indexing and emit *claims*
(typed, evidence-backed, unresolved-target-tolerant). Claims are cached under
`claims:` keyed by source hash + stage fingerprint, mirroring the embedding
stage cache discipline. Compiling claims into the queryable graph (target
resolution, evidence merging, adjacency, aliases) is a **namespace-scoped graph
generation build**: idempotent generation-scoped writes, complete validation,
one atomic `knowledge:current` pointer swap. A crash leaves the prior complete
generation active; partial generations are never queryable. Retrieval pins the
generation it started with.

**Structural relations are virtual.** Hierarchy, parent/child, chunk
ordering, and source/asset provenance are projected on read from existing
indexed records by `structural.ts` behind the same graph-reader interface
that serves persisted edges. Core never persists them; a Storage adapter may
materialize structural adjacency as a transparent optimization, but
correctness cannot depend on it. Persisted graph generations begin only when
non-recoverable connected features are configured: a non-empty `derive`
pipeline, explicit or model-derived relations/assertions, or communities.

Graph generations **layer over** the existing indexed read model: chunk/parent
records keep their stable keys and `active`-flag lifecycle
(`indexed-knowledge/store.ts`) unchanged. Only connected-knowledge artifacts
are generation-scoped. Graph records reference immutable source/chunk
versions, while current authorization/deletion visibility remains
authoritative. Source removal must clean both layers: `remove()` /
`deleteSource()` today deletes only the `source:<id>:` prefix, so
connected-knowledge cleanup (claims by source, evidence supports, view index
entries) is wired into the same removal path via source-keyed records —
supports become invisible immediately; physical edge/assertion GC happens at
the next generation build.

### Derive phase on the pipeline (`indexing/types.ts`, `pipeline.ts`)

```ts
export interface IndexingPipelineConfig {
  documents?: DocumentTransform[]
  chunker?: Chunker
  chunks?: ChunkTransform[]
  /** Post-chunk derivation stages: relations and assertions. */
  derive?: readonly DeriveStage[]
}
```

`DeriveStage = RelationStage | AssertionStage`, discriminated by `_tag`, each
carrying `id`, `version`, and `fingerprint()`. `IndexingPipeline.fingerprint()`
must include derive stages — this is cache identity, add the red test before
wiring execution. Stages emit claims through a context API only; they get no
storage handle. Independent stages may run concurrently; a stage may declare
`dependsOn` by stage id.

Note: `KnowledgeBaseConfig` has no `pipeline` field today (only `chunking`);
the RFC's `knowledgeBase({ id, pipeline })` shape is new. The `pipeline`
config field, the `derive` config slot, and its fingerprint participation land
first (types + fingerprint only); stage *execution* follows. `chunking` is
the simple shorthand used only without `pipeline`; passing both is a
configuration error because precedence would otherwise be unclear.
`derive: []` is **not** an opt-in switch: persisted graph work begins only
with a non-empty `derive`, relations/assertions, or communities.

### Exactly-one-mode config (shared pattern)

`relate()`, `assertions()`, and `resolve()` all accept exactly one of
`model` (+ optional `instructions`) or `run`. Encode it once as a reusable
union so the compiler rejects both/neither:

```ts
/** Exactly one production mode: model-backed extraction or deterministic code. */
export type StageMode<TRunArgs extends readonly unknown[]> =
  | { model: KnowledgeModel; instructions?: string; run?: never }
  | { model?: never; instructions?: never; run: (...args: TRunArgs) => void | Promise<void> }
```

`KnowledgeModel` reuses the `RetrievalModel` port shape
(`generateText`/`generateObject`) **plus required identity** — the same
discipline as named reranker engines (`rerank({ engine })` joins on
`engine.name`), strengthened for cache correctness:

```ts
/** A named, fingerprinted generation model for paid connected-knowledge stages. */
export interface KnowledgeModel extends RetrievalModel {
  /** Inspectable authored identity; joins receipts and Project Index. */
  readonly name: string
  /** Captures model/provider/router and all output-affecting configuration. */
  readonly fingerprint: string
}
```

Provider adapters create both automatically from their bound model and
settings; custom models use a helper requiring a stable name/version or
fingerprint. TypeScript rejects plain anonymous `RetrievalModel`s in
`relate()`, `assertions()`, `communities()`, and model-backed `resolve()`;
runtime validation protects JavaScript callers. No position-derived or
object-identity fallback. A fingerprint change invalidates cached artifacts
and replay compatibility.

### relate() vocabulary typing (`relate/relate.ts`)

```ts
export interface RelationTypeSpec {
  readonly from: readonly KnowledgeRefKind[]
  readonly to: readonly KnowledgeRefKind[]
  readonly direction: 'directed' | 'symmetric'
  readonly description: string
}

export function relate<const TTypes extends Record<string, RelationTypeSpec>>(
  config: { id: string; version: number; types: TTypes } & StageMode<
    [RelateRunInput, RelateEmitApi<TTypes>]
  >,
): RelationStage<TTypes>
```

`const` generics preserve literal type names; `RelateEmitApi<TTypes>` constrains
`emit(type, from, to, opts)` so `type` is `keyof TTypes` and endpoint kinds are
checked at the type level where refs are literal. `relate.references()` and
`relate.entities({ model })` are pre-built stages over the same contract; the
builtin generic vocabulary is a single `related` type.

### assertions() typing (`assertions/assertions.ts`)

```ts
export function assertions<const TTypes extends Record<string, z.ZodType>>(
  config: { id: string; version: number; types: TTypes } & StageMode<
    [AssertionRunInput, AssertionEmitApi<TTypes>]
  >,
): AssertionStage<TTypes>

/** One extracted assertion, discriminated by its authored type name. */
export type AssertionOf<TTypes, K extends keyof TTypes = keyof TTypes> = {
  [T in K]: {
    readonly type: T
    readonly data: z.infer<TTypes[T]>
    readonly evidence: readonly AssertionSupport[]
    readonly provenance: 'exact' | 'derived'
  }
}[K]
```

`view.assertions(stage, { types })` narrows the set:
`AssertionSet<AssertionOf<TTypes, TSelected>>` with `list({ limit, cursor })`
and `stream()`. Zod schemas describe `data` only; schema `.describe()` text is
the single description registry and participates in the stage fingerprint.

Canonical identity (`assertions/identity.ts`): stable hash of stage
id/version/fingerprint + literal type + normalized schema-valid data. Same
proposition from several sources merges supports; zero remaining support
garbage-collects at the next generation.

### View where-typing (`view/where.ts`)

```ts
type Scalar = string | number | boolean
type ScalarKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends Scalar ? K : never
}[keyof T]

/** AND of exact scalar matches; array values mean membership (IN). */
export type WhereClause<T> = {
  [K in ScalarKeys<T>]?: NonNullable<T[K]> | readonly NonNullable<T[K]>[]
}

/** V1 view selection: one clause, or a union of compound clauses. */
export type ViewWhere<T> = WhereClause<T> | { any: readonly WhereClause<T>[] }
```

`T` is `z.infer<TMetadataSchema>` from `knowledgeBase()`. Runtime validation
rejects fields not in the schema. No ranges, negation, predicates, or
graph-derived membership — reject, don't extend.

**View-scoped vector retrieval on the portable path.** `ExactFilter` is
top-level scalar equality only (`storage/types.ts`), so a view's `where` cannot
be pushed down as one vector filter. V1 compiles the predicate into bounded
disjunctive `ExactFilter` branches: expand `IN` arrays, execute one vector
search per branch, union by hit key preserving the best comparable vector
score (no RRF — branches partition one query, their scores are comparable),
then verify every result against the pinned revision's membership.
Membership is authoritative; pushdown is only an optimization.

Exact failure semantics:

- Never truncate filter branches silently. If expansion exceeds the fixed V1
  safety ceiling, fail with an actionable diagnostic or use an optimized
  Storage capability.
- If the VectorStore cannot honor exact filters, do not fall back to
  unfiltered overfetch and pretend recall is correct.
- Receipts record branch count, queries, deduplication, membership
  rejection, and capability path.
- An optimized connected-knowledge port may collapse this into one
  membership-aware query; the conformance suite covers both paths.

### expandRelations step (`retrieval/recipe/steps/expand-relations.ts`)

`RetrievalStep<'hits', 'hits'>` following the `expandParents` pattern.
`RetrievalStepContext` has no graph access today, so binding is explicit work,
not an assumption: extend `RetrievalStepContext` with an optional readonly
`knowledge` field (bounded graph reader + pinned generation + inherited
visibility filter) that KB/view `recipe()` injects. The reader serves both
virtual structural relations (always available, projected from indexed
records — no derive stages required) and persisted semantic edges when a
graph generation exists. `expandRelations()` in an unbound recipe (plain
`retrievalRecipe()`) fails with an actionable diagnostic. Users configure
only:

```ts
expandRelations({
  types?: readonly string[]        // default: all vocabulary types
  direction?: 'out' | 'in' | 'both' // default 'both'
  depth?: number                    // default 1 (semantic hops)
  limit?: number                    // default 20 added hits
  seeds?: readonly ('hits' | 'query')[] // default both
})
```

Semantics pinned by tests, straight from the RFC: additive (never evicts),
zero-cost mention/entity hydration hops, deterministic candidate order
(semantic distance → seed rank → distinct-path support → stable id), RRF score
fusion recorded in `HitProvenance` (new `graph` field: seed, path, edge ids),
visibility inherited from the originating retrieval (namespace + filter, no
second filter), internal fan-out/hub ceilings with receipted truncation
warnings.

## Delivery order

### Stage 1 — refs, virtual structural graph, generations, adjacency

1. **Package surface.** Add the `./knowledge` export to
   `packages/core/package.json` as the canonical entrypoint (re-homing
   `knowledgeBase` there while `/retrieval` keeps a compatibility re-export),
   the barrel `knowledge/index.ts`, and a type test importing the public
   entry points, so export coverage is pinned from the first commit.
2. **Pipeline config.** Add `pipeline` to `KnowledgeBaseConfig` (it does not
   exist today) accepting an `IndexingPipeline`; `chunking` remains the
   shorthand used only without `pipeline`, both set → configuration error.
   Add the `derive` config slot to `IndexingPipelineConfig` as inert typed
   data whose stages participate in `fingerprint()`. Execution comes later.
3. **KnowledgeRef codec.** One canonical, bijective encoder/decoder with
   round-trip, collision (ids containing `:`/`%`), malformed-input, and
   key-length tests; guards.
4. **Keys.** Key builders under the existing namespace prefix; assert exact key
   strings so the persisted contract is pinned.
5. **Edge/entity records.** Codec module with narrow/validate functions;
   malformed stored values return `null`, never throw through retrieval.
6. **Generation ownership.** Build → validate → atomic pointer swap on
   `knowledge:current`; crash-before-swap leaves prior generation queryable;
   generation-scoped idempotent rewrites; retention-gated cleanup honoring the
   existing `lifecycle.retention` config. Exercised against synthetic edges;
   no automatic build exists yet.
7. **Virtual structural projection.** `structural.ts` projects hierarchy,
   parent/child, chunk ordering, and source/asset provenance on read from
   active indexed records, behind the graph-reader interface later shared
   with persisted edges. Red test: plain `knowledgeBase()` writes zero
   `knowledge:` records and pays zero indexing overhead, yet the reader
   serves its hierarchy.
8. **Graph store reads.** Bounded out/in neighbor queries by type across
   virtual and persisted (synthetic-generation) edges; hydration to chunk
   hits; namespace isolation (traversal never crosses namespaces);
   visibility filter application; current authorization/deletion visibility
   authoritative over pinned generations.
9. **Devtools projection (core only).** Expose graph summary + neighbor reads
   (including virtual hierarchy for relation-free corpora) through the
   existing runtime-bridge contracts for the local explorer to consume
   later.

### Stage 2 — derive phase, relate(), expandRelations()

1. **Step context binding.** Extend `RetrievalStepContext` with the optional
   readonly `knowledge` binding (graph reader, pinned generation, inherited
   visibility filter) injected by KB `recipe()`; unbound knowledge steps fail
   with a diagnostic naming the fix.
2. **DeriveStage contract + runner.** Per-source execution with bounded
   batching, concurrency for independent stages, `dependsOn` ordering, claim
   emission API, schema validation/repair loop for model mode, claim caching by
   source hash + stage fingerprint (second index run performs zero model
   calls — assert via counting fake model).
3. **`relate()` vocabulary.** Type tests: literal type names flow to emit API;
   endpoint kind mismatches are compile errors for literal refs; both/neither
   mode rejection. Runtime: version/id validation, fingerprint stability.
4. **Target resolution.** Locator index (ids, URLs, titles, aliases, anchors)
   built from indexed records; ambiguous/unevidenced targets reject; resolvable
   locators produce edges; unresolved evidence-backed locators persist as
   pending claims picked up by a later generation (red test: index target
   document after claim, rebuild, edge appears).
5. **`relate.references()`.** Deterministic reference resolution over chunk
   content/metadata; `exact` provenance.
6. **`relate.entities({ model })`.** Generic `related` vocabulary; mention
   edges chunk→entity; alias records; evidence-backed generic edges with
   bounded descriptions; `derived` provenance; no call without explicit model.
7. **Evidence merge/removal.** Two sources supporting one normalized edge merge
   supports; removing one source (KB `remove()`) drops only its support; zero
   support removes edge from the next generation while pinned readers still
   see their generation. Wire connected-knowledge cleanup into the
   `remove()`/`deleteSource()` path (which today deletes only the
   `source:<id>:` prefix) via source-keyed claim/support records: affected
   evidence becomes invisible immediately, physical GC happens at the next
   generation build. Red test: remove a source, traversal never returns its
   evidence, pinned prior generation still resolves.
8. **`expandRelations()`.** The behavior list from the contract section, one
   red test per bullet; plus recipe integration tests through
   `kb.recipe({ steps: [retrieve(), expandRelations()] })`, virtual-only
   traversal on a KB with no derive stages (structural types resolve without
   any persisted generation), and provenance completeness (every added hit
   explains its seed/path/edges).

### Stage 3 — metadataSchema enforcement, live views, bound recipe identity

1. **Ingestion enforcement.** Required `metadataSchema` fields missing at
   ingestion fail the source with a diagnostic; optional fields simply don't
   match.
2. **Where typing + validation.** Type tests for `ViewWhere` (scalar keys only,
   `IN` arrays, `any` unions, unknown-field compile errors); runtime rejection
   mirrors.
3. **Membership indexes.** Incremental exact-value index maintenance on
   index/reindex/remove; view resolution reads indexes only (red test: no
   full-corpus scan — assert via instrumented RecordStore call counts).
4. **Revisions.** Content-addressed revision (exact source ids + versions);
   an operation resolves once and pins; new matching documents appear in the
   next revision without any refresh API; `view.at(revision)` returns a
   pinned handle; missing/revoked evidence fails exact replay rather than
   returning partial results.
5. **Read-surface parity.** `view()` exposes `retriever()`, `recipe()`,
   `grounding()`, `tools()`, `assertions()` (stage 4), `use[]` composition —
   same shapes as `KnowledgeBase`; extract shared surface builder into
   `knowledge-base-views.ts` so both files stay under the size budget.
   `use: [view]` is shorthand for its default `retrieve()` recipe.
6. **Bound recipe identity.** Anonymous bound recipes derive deterministic
   identity from read-surface identity + behavioral fingerprint (ordered
   steps/configs, model identities, typed contracts — prove line-number and
   variable-name independence with two structurally identical recipes).
   `retrievalRecipe()` standalone still requires `id`.
7. **Scope isolation.** `scope({ namespace })` isolates knowledge artifacts:
   graph, entities, views, revisions (extend existing scope tests).

### Stage 4 — assertions, evidence validation, resolution

1. **`assertions()` factory.** Type tests (schema-map inference, mode union);
   fingerprint includes schema descriptions.
2. **Evidence requirement.** Model mode: opaque evidence handles issued per
   batch must resolve; unevidenced output rejected with repair loop then
   drop + diagnostic. Deterministic mode: `evidence.chunk()` handles validated
   against the processed source.
3. **Identity + support merge.** Identical propositions merge; different data
   stays separate; source removal drops support; zero support GCs next
   generation.
4. **AssertionSet.** `view.assertions(stage, { types })` narrowing; lazy
   `list({ limit, cursor })` pagination; `stream()`; `use[]` composition emits
   bounded context representation (assert token-bounded rendering, not raw
   dumps).
5. **Assertion relations.** Context-independent evidence-backed relations
   between assertions (`supports`, `amends`, `supersedes`, `narrows`,
   `conflictsWith`) persisted at indexing; no all-pairs comparison (assert
   model-call count scales with sources, not pairs). Contract decision:
   `KnowledgeRefKind` stays closed; assertions get their own `AssertionRef`
   (`{ assertionId }`) and typed `AssertionRelation` record (from/to
   `AssertionRef`, closed type union, evidence, provenance, stage identity,
   direction) living in the assertion generation/keyspace and consumed by
   resolution. Consequences pinned by tests: `expandRelations()` does not
   traverse assertions in V1; assertion support records are never disguised
   as `supports` graph edges; when an asserted target does not exist, the
   source-level document/chunk relation may still exist independently;
   resolution may additionally inspect ordinary knowledge edges between
   supporting documents/chunks, but the record models remain distinct.
6. **`resolve()`.** No-model resolution over explicit indexed edges;
   model/deterministic policy modes; result partitions
   (`selected`/`superseded`/`contested`/`unresolved`) with complete decision
   trace; non-destructive (source assertions unchanged); lazy handle
   `status()`/`prepare()`/`result()`; `use: [resolved]` composition; pinned to
   one view revision.

### Stage 5 — communities (design checkpoint first)

Before the first task, write
`docs/superpowers/specs/<date>-communities-design.md` resolving: clustering
invariants and bounds for the deterministic V1 recluster, fallback
communities, the immutable report schema, dirty-ledger/coalescing behavior,
completeness and publication, and the Work/readiness lifecycle. Communities
depend primarily on #299 Work/Runtime (retained refresh), with #286
supplying evidence relationships — not on #196 Effects; derived indexing and
community materialization are explicitly not Effects. Then:
`communities({ model })` config, graph mapping reuse of `relate.entities`
artifacts, immutable hierarchy generations keyed by view revision + graph
generation + strategy fingerprint, single-flight builds,
`status()`/`prepare()` operations, staleness diagnostics without Runtime.

### Stage 6 — globalSearch (design checkpoint first)

Checkpoint doc covers map/reduce batching, preflight estimation, freshness
compensation states, coverage receipts, one-producer recipe typing, and
Context Planning integration. Global search depends on #299 Work/Runtime
plus #300 planning/budget machinery. Then: hit kinds
(`evidence` | `finding`) on `RetrieverHit`, one-producer recipe typing
(type-level where feasible, runtime diagnostics authoritative),
`globalSearch()` step with `scan`/`detail`, coverage receipts
(`result.receipt.knowledge`), citation bundles for findings, request-filter
rejection, safety ceiling before spend.

### Stage 7 — integration workstreams

Split into focused workstreams rather than one stage: multimodal
completeness (modality capability validation in derive stages — fail, never
skip silently), optimized Storage (connected-knowledge port + the shared
conformance suite covering portable and optimized paths), Devtools (local
explorer UI in `packages/local` over the stage-1 projection),
receipts/Evals (eval fingerprint coverage for view revisions and
stage/community fingerprints), and scale hardening. Project Index discovery
of knowledge definitions belongs here too — remember the `AGENTS.md`
cache-epoch rules.

## Acceptance tracking

The RFC's acceptance criteria checklist is the exit review for the whole plan;
map each checked criterion to the stage that proved it before closing #303.
