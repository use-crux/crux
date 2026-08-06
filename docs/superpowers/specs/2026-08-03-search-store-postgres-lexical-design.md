# SearchStore and PostgreSQL lexical retrieval

Status: binding implementation specification. This is a pre-launch contract: `SearchStore` is the sole retrieval-index API.

## Decision and scope

`SearchStore` is the Storage Beta retrieval-index contract. A query composes one or more independent dense, sparse, and lexical legs. Indexed Knowledge writes normalized chunk content into the same `SearchRecord` as its dense and sparse payloads. PostgreSQL stores that content beside pgvector columns, indexes a generated `tsvector` with GIN, and executes multi-leg reciprocal-rank fusion (RRF) in one server-side statement.

This release uses PostgreSQL full-text ranking, not BM25. True BM25 is deferred to RFC #352. Shipping learned sparse providers is deferred to RFC #353; sparse search remains a composable leg.

## Core public contract

The following is the exact `@use-crux/core/storage` surface:

```ts
export type SearchLegKind = 'dense' | 'sparse' | 'lexical'

export interface DenseSearchLeg {
  readonly kind: 'dense'
  readonly vector: readonly number[]
  readonly candidates?: number
}

export interface SparseSearchLeg {
  readonly kind: 'sparse'
  readonly vector: SparseVector
  readonly candidates?: number
}

export interface LexicalSearchLeg {
  readonly kind: 'lexical'
  readonly query: string
  readonly candidates?: number
}

export type SearchLeg = DenseSearchLeg | SparseSearchLeg | LexicalSearchLeg

export type SearchFusion = { readonly strategy: 'rrf'; readonly k?: number }

export interface SearchQuery {
  readonly legs: readonly [SearchLeg, ...SearchLeg[]]
  readonly fusion?: SearchFusion
  readonly limit?: number
  readonly threshold?: number
  readonly filter?: ExactFilter
}

export interface SearchRecord {
  readonly key: string
  readonly content?: string
  readonly dense?: readonly number[]
  readonly sparse?: SparseVector
  readonly metadata?: ExactFilter
}

export interface SearchLegMatch {
  readonly kind: SearchLegKind
  readonly rank: number
  readonly score: number
}

export interface SearchHit {
  readonly key: string
  readonly score: number
  readonly metadata?: ExactFilter
  readonly matches: readonly SearchLegMatch[]
}

export interface SearchStoreCapabilities {
  readonly legs: Readonly<Record<SearchLegKind, boolean>>
  readonly fusion: readonly 'rrf'[]
  readonly filter: 'pre' | 'post' | false
  readonly consistency: 'strong' | 'eventual'
}

export interface SearchStoreCapabilityConfig {
  readonly legs: Partial<Readonly<Record<SearchLegKind, boolean>>>
  readonly fusion?: readonly 'rrf'[]
  readonly filter?: 'pre' | 'post' | false
  readonly consistency?: 'strong' | 'eventual'
}

export function searchStoreCapabilities(
  config: SearchStoreCapabilityConfig,
): SearchStoreCapabilities

export interface SearchStore {
  readonly _tag?: 'SearchStore'
  upsert(records: readonly SearchRecord[]): Promise<void>
  delete(keys: readonly string[]): Promise<void>
  search(query: SearchQuery): Promise<readonly SearchHit[]>
  capabilities(): SearchStoreCapabilities
}

export interface Storage {
  readonly records: RecordStore
  readonly search?: SearchStore
  readonly assets?: AssetStore
}
```

`searchStoreCapabilities()` fills absent leg booleans as `false`, defaults `filter` to `false`, defaults `consistency` to `'strong'`, and defaults `fusion` to `['rrf']` when at least two legs are enabled and `[]` otherwise. An explicit `fusion` value cannot advertise RRF with fewer than two enabled legs. Providers derive capabilities from construction options through this helper so advertised support cannot drift from enabled payloads. Distribution-based score fusion is intentionally omitted from this pre-launch API; adding another fusion strategy later requires a complete scoring and conformance contract.

`storage({ search })` is the only storage binding for retrieval indexes. `storage.scope()` prefixes search keys exactly once.

## Query rules

- A query contains one to three legs and at most one leg of each kind. Empty legs, duplicate kinds, unknown kinds, empty lexical queries, invalid dense or sparse payloads, negative or non-integer counts, and non-finite thresholds throw `StorageError('invalid_value')` before provider I/O.
- `limit` defaults to `10` and may be zero. Zero returns `[]` before embedding or provider I/O. Each leg's `candidates` defaults to `clamp(4 * limit, 50, 1000)`, raised to at least `limit`; it must be a positive integer and at least `limit`. Counts are independent per leg.
- One leg ignores `fusion`. Two or more legs require advertised RRF support; omitted `fusion` means `{ strategy: 'rrf', k: 60 }`. `k` defaults to `60` and must be a positive integer.
- A store checks every requested leg, fusion, and pre-filter capability before search I/O. A missing leg or fusion, or any Indexed Knowledge store without `filter: 'pre'`, throws `StorageError('unsupported_capability')`.
- `threshold` is applied to the final score with `score >= threshold` and defaults to `0`. Callers must not compare raw single-leg scores across leg kinds or providers.

For each leg, candidates rank by raw score descending, then `key` ascending. Fused search uses one-based rank and deterministic normalized RRF:

```ts
rrfScore = sum(matches.map(({ rank }) => 1 / (k + rank)))
  * (k + 1) / legs.length
```

Missing legs contribute zero, so fused scores are in `[0, 1]`. Final results order by `score` descending, then `key` ascending. `matches` is ordered as the query's `legs`, includes only matched legs, and reports pre-fusion rank and raw score. These rules make pagination-free repeated queries deterministic for unchanged data.

## Retrieval-facing contract

Retrievers select generated legs without spelling store payloads:

```ts
export interface RetrievalLegOptions {
  readonly candidates?: number
}

export interface RetrievalSearchPlan {
  readonly dense?: boolean | RetrievalLegOptions
  readonly sparse?: boolean | RetrievalLegOptions
  readonly lexical?: boolean | RetrievalLegOptions
  readonly fusion?: SearchFusion
}

export interface RetrieveOptions<TFilter extends ExactFilter = ExactFilter> {
  limit?: number
  threshold?: number
  filter?: TFilter
  search?: RetrievalSearchPlan
  // existing trace, caller, and admit fields remain
}

export interface KnowledgeBaseRetrieverConfig<TFilter extends ExactFilter = ExactFilter> {
  limit?: number
  threshold?: number
  filter?: TFilter
  search?: RetrievalSearchPlan
}

export type RetrieverMode = 'search' | 'custom'
```

`SearchStoreBackedRetrieverConfig` and `KnowledgeBaseConfig` accept `search?: SearchStore`. Inspection reports `storage.search`, per-leg capabilities, fusion, delete, and filter. A retriever configured with a `search` plan exposes `mode: 'search'`; caller-provided retrievers expose `mode: 'custom'`. Spans use `mode: 'search'` plus `searchLegs` for composable queries.

Default retrieval plans are derived from configured generators: dense+sparse embeddings produce dense+sparse legs, sparse alone produces sparse, and otherwise dense. Lexical is opt-in through `search.lexical`. Dense requires a dense embedding, sparse requires a sparse embedding, and lexical requires normalized text plus a lexical-capable store. Lexical never calls an embedding. A media request cannot include sparse or lexical; plans that require unsupported legs fail with `unsupported_capability`.

```ts
const kb = knowledgeBase({
  id: 'docs',
  records,
  search: postgres,
  embeddings,
})

const hits = await kb.retriever({
  search: {
    dense: { candidates: 120 },
    lexical: { candidates: 80 },
    fusion: { strategy: 'rrf', k: 60 },
  },
  limit: 12,
}).retrieve({
  query: 'transaction retry semantics',
  filter: { tenantId: 'acme' },
})
```

## Indexed Knowledge and Project Index vocabulary

`IndexedKnowledgeStoreConfig.search?: SearchStore` is the only retrieval-index store field. For every child chunk, `persistGeneration()` first writes the canonical record, then upserts one `SearchRecord` with `content: chunk.content`, optional dense/sparse payloads, and exact-filter metadata. It upserts whenever a search store exists, including lexical-only records. Parents remain only in `RecordStore`.

Deletion, namespace scoping, active-generation replacement, hydration, and embedding-space checks keep their current key contracts. Active-generation and tenant filters are merged and applied before every leg ranks. Deactivation must update search metadata as well as the canonical record; the implementation may reuse the existing upsert path. Hydration mismatches remain hard failures, never silently skipped.

`SearchStore.upsert()` is full-record replacement: omitted `content`, `dense`, or `sparse` clears that stored payload. Metadata-only lifecycle updates therefore reconstruct and write the complete current `SearchRecord`; they must not erase content or embedding payloads accidentally.

`createIndexWriter()` always passes normalized chunk content to Indexed Knowledge. Lexical-only indexing runs without dense or sparse embedding stages. New Project Index definitions, facts, or source refs introduced by this work use `search`, `SearchStore`, and `SearchRecord` vocabulary. Adding lexical configuration changes runtime knowledge-index output, so reindexing is required; it does not affect Project Index cache epochs unless Project Index output shape changes.

## PostgreSQL package

```ts
export interface PostgresLexicalOptions {
  /** PostgreSQL text-search configuration; defaults to `simple`. */
  readonly configuration?: string
}

export interface PostgresSearchStoreOptions extends PostgresStorageConnectionOptions {
  readonly dimensions?: number
  readonly sparseDimensions?: number
  readonly lexical?: true | PostgresLexicalOptions
}

export interface PostgresSearchStore extends SearchStore {
  readonly setup: PostgresStorageSetup
  close(): Promise<void>
}

export function postgresSearchStore(options: PostgresSearchStoreOptions): PostgresSearchStore

export interface PostgresStorageOptions extends PostgresSearchStoreOptions {}

export interface PostgresStorage extends Storage {
  readonly records: RecordStore
  readonly search: PostgresSearchStore
  readonly setup: PostgresStorageSetup
  close(): Promise<void>
}
```

At least one of `dimensions`, `sparseDimensions`, or `lexical` is required. `sparseDimensions` requires pgvector; dense is not required for lexical-only storage. `postgresStorage()` and `postgresSearchStore()` derive capabilities from options: configured payloads set `legs`, two or more configured legs advertise RRF, PostgreSQL filtering is `pre`, and consistency is `strong`. `inMemorySearchStore(): SearchStore` is the core in-memory factory; it advertises dense, sparse, and RRF, but not lexical.

PostgreSQL resolves the lexical configuration with a parameterized `$1::regconfig` lookup before DDL or queries. Invalid or unavailable names produce `StorageError('invalid_value')`; unchecked names are never interpolated. Lexical search uses `websearch_to_tsquery(configuration, query)` and `ts_rank_cd(search_document, tsquery)`. An empty resulting query returns no lexical candidates.

For multi-leg queries, one SQL statement uses filtered candidate CTEs, ranks each with `row_number()` and `key ASC`, full-joins by key, calculates normalized RRF, applies final threshold, orders by fused score then key, and limits. No candidate list is fused in application code.

## Setup and schema ownership

When lexical is enabled, the Crux-owned search table includes:

```sql
content text,
search_document tsvector GENERATED ALWAYS AS (
  to_tsvector('<resolved configuration>'::regconfig, coalesce(content, ''))
) STORED
```

and a GIN index on `search_document`. The search table contains only configured payload columns. Its presence constraint ORs `IS NOT NULL` across configured payload columns, including `content` when lexical is enabled.

`setup.check()` is non-mutating and reports missing columns, generated expression/configuration, GIN index, pgvector requirements, dimensions, and presence constraint with stable finding codes. `setup.apply()` retains the schema advisory transaction lock and may create the extension/schema/table, add nullable columns, replace only the Crux-owned presence constraint, and create missing indexes. It never rewrites content from the records table or changes a text-search configuration silently.

Existing rows with null content remain valid. After enabling lexical search, users run `knowledgeBase.reindex()` to populate content; `check()` reports `POSTGRES_SEARCH_LEXICAL_CONTENT_MISSING` while active indexed chunks have null content, with reindex remediation. A configuration mismatch reports `POSTGRES_SEARCH_CONFIGURATION_INCOMPATIBLE`; changing it requires an explicit schema change and reindex because PostgreSQL must rebuild the generated column and GIN index.

## Observability and errors

Retrieval spans and `retrieval.hits` artifacts add `searchLegs`, per-leg candidate counts, fusion strategy, and `rrfK`; hit previews may include `matches` but never embedding payloads or full stored content. PostgreSQL backend failures remain `new StorageError('backend_error', message, { cause })`. Validation and capability errors occur before embedding/provider I/O where possible. Dense embedding-space mismatch, hydration miss, and setup finding behavior retain their current typed errors.

## Conformance and delivery

Implementation must add shared SearchStore conformance tests for validation, capability derivation, capability rejection, exact pre-filtering, full-replacement upsert/delete, limit-zero short circuiting, per-leg candidate bounds, normalized RRF, `>=` thresholds, match details, and deterministic ties.

PostgreSQL integration tests cover setup check/apply from empty SearchStore schemas, idempotency, lexical-only records, configuration validation, GIN use, punctuation and empty queries, filters before ranking, inactive generations, reindex population, multi-leg single-statement RRF with unequal candidate counts and custom `k`, score/tie determinism, deletes, and caller-owned pool behavior.

Docs must make `storage.search`, `SearchStore`, `SearchRecord`, `SearchQuery`, `SearchHit`, `SearchStoreCapabilities`, `postgresSearchStore`, `inMemorySearchStore`, composable plans, setup/apply, and reindexing canonical. The implementation updates an existing relevant pending changeset or adds a minor changeset for `@use-crux/core` and `@use-crux/postgres`, following repository policy.

## Rejected alternatives

- Fixed strings for every leg combination: rejected because legs are independently composable.
- Treating PostgreSQL lexical search or BM25 as `SparseEmbedding`: rejected because corpus-owned ranking is not a stateless embedding.
- A separate lexical store with dual writes and core-side fusion: rejected for this release because PostgreSQL can keep one row, one filter boundary, and one query.
