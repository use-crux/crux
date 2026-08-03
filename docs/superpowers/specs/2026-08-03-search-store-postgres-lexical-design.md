# SearchStore and PostgreSQL lexical retrieval

Status: binding implementation specification. The product direction is approved; implementation must preserve these names and shapes unless this document is amended and re-approved.

## Decision and scope

`SearchStore` becomes the primary Storage Beta retrieval-index contract. A query composes one or more independent dense, sparse, and lexical legs; it never selects a fixed combination mode. Indexed Knowledge writes raw chunk content into the same search record as its vectors. PostgreSQL stores that content beside pgvector columns, indexes a generated `tsvector` with GIN, and executes dense plus lexical reciprocal-rank fusion (RRF) in one server-side statement.

This release uses PostgreSQL full-text ranking, not BM25. True BM25 is deferred to RFC #352. Shipping learned sparse providers is deferred to RFC #353; the existing sparse-vector port remains composable.

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

export type SearchFusion =
  | { readonly strategy: 'rrf'; readonly k?: number }
  | { readonly strategy: 'dbsf' }

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
  readonly matches?: readonly SearchLegMatch[]
}

export interface SearchStoreCapabilities {
  readonly legs: Readonly<Record<SearchLegKind, boolean>>
  readonly fusion: readonly ('rrf' | 'dbsf')[]
  readonly filter: 'pre' | 'post' | false
  readonly consistency: 'strong' | 'eventual'
  /** @deprecated compatibility projections */
  readonly dense: boolean
  readonly sparse: boolean
  readonly hybrid: boolean
}

/** Derive deprecated projections; providers do not hand-author them. */
export function searchStoreCapabilities(
  capabilities: Omit<SearchStoreCapabilities, 'dense' | 'sparse' | 'hybrid'>,
): SearchStoreCapabilities

export interface SearchStore {
  readonly _tag?: 'SearchStore' | 'VectorStore'
  upsert(records: readonly SearchRecord[]): Promise<void>
  delete(keys: readonly string[]): Promise<void>
  search(query: SearchQuery | VectorSearchQuery): Promise<readonly SearchHit[]>
  capabilities(): SearchStoreCapabilities
}

export interface Storage {
  readonly records: RecordStore
  readonly search?: SearchStore
  /** @deprecated Use `search`. */
  readonly vectors?: VectorStore
  readonly assets?: AssetStore
}

// Existing VectorStore, VectorRecord, VectorSearchQuery, VectorHit, and
// VectorStoreCapabilities declarations remain deprecated but otherwise
// source-compatible for third-party implementations.
```

`VectorSearchQuery` and its three existing mode-shaped members remain deprecated source-compatible types. `SearchStore.search()` accepts them and normalizes `dense`, `sparse`, and `hybrid` to one dense leg, one sparse leg, and dense+sparse legs respectively. Legacy `hybrid` uses its requested fusion; omitted fusion means RRF with `k = 60`. Existing `dbsf` requests are accepted only by stores advertising `dbsf`.

`searchStoreCapabilities()` defines `dense === legs.dense`, `sparse === legs.sparse`, and `hybrid === legs.dense && legs.sparse && fusion.length > 0`. New providers use this helper so compatibility projections cannot drift.

`storage({ search })` is canonical. `storage({ vectors })` remains valid for existing third-party stores: normalization detects capabilities without `legs`, retains the original store at `vectors`, and installs a `SearchStore` adapter at `search`. The adapter derives legs from legacy `dense`/`sparse`/`hybrid`, translates supported leg queries to legacy mode queries, rescales legacy raw RRF sums to the normalized contract, and rejects lexical or unrepresentable fusion with `StorageError('unsupported_capability')`. Adapter hits may omit `matches` because legacy stores do not expose per-leg ranks. Supplying both fields with different explicit stores throws `StorageError('invalid_value')`. New built-in stores expose the same object through both names; a wrapped third-party legacy store may not preserve identity. `storage.scope()` prefixes keys exactly once in either case.

## Query rules

- A query contains one to three legs and at most one leg of each kind. Empty legs, duplicates, unknown kinds, empty lexical queries, invalid vectors, negative or non-integer counts, and non-finite thresholds throw `StorageError('invalid_value')` before provider I/O. An object carrying both new `legs` and legacy `mode` is also invalid even though TypeScript can structurally satisfy the union.
- `limit` defaults to `10` and may be zero. Zero returns `[]` before embedding or provider I/O. Each `candidates` defaults to `clamp(4 * limit, 50, 1000)`, raised to at least `limit`; it must be a positive integer and at least `limit`. Counts are independent per leg.
- One leg ignores `fusion`. Two or more legs require an advertised fusion strategy; omitted `fusion` means `{ strategy: 'rrf', k: 60 }`. `k` defaults to `60` and must be a positive integer.
- A store checks every requested leg, fusion, and pre-filter capability before search I/O. A missing leg or fusion and any Indexed Knowledge store without `filter: 'pre'` throws `StorageError('unsupported_capability')`.
- `threshold` is applied to the final score, after fusion, with `score >= threshold`, and defaults to `0`. Callers must not compare raw single-leg scores across leg kinds or providers.

For each leg, candidates rank by raw score descending, then `key` ascending. RRF uses one-based rank:

```ts
rrfScore = sum(matches.map(({ rank }) => 1 / (k + rank)))
  * (k + 1) / legs.length
```

Missing legs contribute zero, so fused scores are in `[0, 1]`. Final results order by `score` descending, then `key` ascending. `matches` is ordered as the query's `legs`, includes only matched legs, and reports pre-fusion rank and raw score. These rules make pagination-free repeated queries deterministic for unchanged data.

## Retrieval-facing contract

Retrievers select generated legs without spelling store payloads:

```ts
export interface RetrievalLegOptions { readonly candidates?: number }

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
  /** @deprecated Translated to `search`; no new modes will be added. */
  mode?: 'dense' | 'sparse' | 'hybrid'
  /** @deprecated Put fusion inside `search`. */
  fusion?: { strategy: 'rrf'; k?: number }
  // existing trace, caller, and admit fields remain
}

export interface KnowledgeBaseRetrieverConfig<TFilter extends ExactFilter = ExactFilter> {
  limit?: number
  threshold?: number
  filter?: TFilter
  search?: RetrievalSearchPlan
  /** @deprecated compatibility fields, with the same translation */
  mode?: 'dense' | 'sparse' | 'hybrid'
  fusion?: { strategy: 'rrf'; k?: number }
}

export type RetrieverMode = 'search' | 'dense' | 'sparse' | 'hybrid' | 'custom'
```

`DenseStoreBackedRetrieverConfig` and `KnowledgeBaseConfig` gain primary `search?: SearchStore`; their `vectors?: VectorStore` fields remain aliases. `Storage.search` wins only when the alias is absent; differing explicit stores are invalid. Inspection reports `storage.search`, per-leg capabilities, fusion, delete, and filter; deprecated `storage.vectors` and `dense`/`sparse`/`hybrid` projections remain.

A retriever configured with the new `search` plan exposes `mode: 'search'`; one configured only through deprecated `mode` preserves that legacy discriminant. Spans use `mode: 'search'` plus `searchLegs` for composable queries. No lexical or combination string is added to `RetrieverMode`.

Adding `'search'` to `RetrieverMode` can break exhaustive consumer switches and is called out in the migration note even though Retrieval remains beta.

Defaults preserve existing behavior: configured dense+sparse embeddings produce dense+sparse legs; sparse alone produces sparse; otherwise dense. Lexical is opt-in through `search.lexical`. Dense requires a dense embedding, sparse requires a sparse embedding, and lexical requires normalized text plus a lexical-capable store. Lexical never calls an embedding. A media request cannot include sparse or lexical; the existing legacy hybrid-media fallback remains dense-only, while a new composable plan fails with `unsupported_capability` rather than silently dropping legs. Providing both new `search` and deprecated `mode`/`fusion` is `invalid_value`.

```ts
const kb = knowledgeBase({
  id: 'docs', records, search: postgres,
  embeddings,
})

const hits = await kb.retriever({
  search: {
    dense: { candidates: 120 },
    lexical: { candidates: 80 },
    fusion: { strategy: 'rrf', k: 60 },
  },
  limit: 12,
}).retrieve({ query: 'transaction retry semantics', filter: { tenantId: 'acme' } })
```

## Indexed Knowledge persistence

`IndexedKnowledgeStoreConfig.search?: SearchStore` is primary and `vectors?: VectorStore` is its deprecated alias. For every child chunk, `persistGeneration()` first writes the canonical record, then upserts one `SearchRecord` with `content: chunk.content`, optional dense/sparse vectors, and existing exact-filter metadata. It upserts when any search store exists, even for lexical-only records. Parents remain only in `RecordStore`.

Deletion, namespace scoping, active-generation replacement, hydration, and embedding-space checks keep their current key contracts. Active-generation and tenant filters are merged and applied before every leg ranks. Deactivation must update search metadata as well as the canonical record; the implementation may reuse the existing upsert path. Hydration mismatches remain hard failures, never silently skipped.

`SearchStore.upsert()` is full-record replacement, matching the existing `VectorStore` contract: omitted `content`, `dense`, or `sparse` clears that stored payload. Metadata-only lifecycle updates therefore reconstruct and write the complete current search record; they must not erase content or vectors accidentally.

`createIndexWriter()` always passes normalized chunk content to Indexed Knowledge. Lexical-only indexing runs without dense or sparse embedding stages. Adding lexical configuration changes runtime knowledge-index output, so reindexing is required; it does not affect Project Index cache epochs.

## PostgreSQL adapter

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

/** @deprecated Alias of `postgresSearchStore`; `dimensions` stays required by its type. */
export type PostgresVectorStoreOptions = PostgresSearchStoreOptions & { readonly dimensions: number }
export type PostgresVectorStore = PostgresSearchStore
export const postgresVectorStore: (options: PostgresVectorStoreOptions) => PostgresVectorStore

export interface PostgresStorageOptions extends PostgresSearchStoreOptions {}
export interface PostgresStorage extends Storage {
  readonly records: RecordStore
  readonly search: PostgresSearchStore
  /** @deprecated Same object as `search`. */
  readonly vectors: PostgresVectorStore
  readonly setup: PostgresStorageSetup
  close(): Promise<void>
}
```

At least one of `dimensions`, `sparseDimensions`, or `lexical` is required. `sparseDimensions` continues to require pgvector; dense is no longer required for lexical-only storage. `postgresStorage()` and `postgresSearchStore()` advertise exactly the configured legs. `postgresVectorStore()` delegates without changing ownership or setup behavior. `inMemorySearchStore(): SearchStore` is the primary core factory; `export const inMemoryVectorStore = inMemorySearchStore` is its deprecated alias. The in-memory store advertises dense, sparse, and RRF but not lexical; RRF is a new capability for that store, not preserved legacy behavior. Lexical conformance is provider-gated.

PostgreSQL resolves the configuration with a parameterized `$1::regconfig` lookup before DDL or queries. Invalid or unavailable names produce `StorageError('invalid_value')`; unchecked names are never interpolated. Lexical search uses `websearch_to_tsquery(configuration, query)` and `ts_rank_cd(search_document, tsquery)`. An empty resulting query returns no lexical candidates.

For dense+lexical, one SQL statement uses filtered dense and lexical candidate CTEs, ranks each with `row_number()` and `key ASC`, full-joins by key, calculates normalized RRF, applies final threshold, orders by fused score then key, and limits. Other supported multi-leg combinations use the same single-statement pattern. No candidate list is fused in application code.

## Setup, migration, and schema ownership

When lexical is enabled, the existing search table gains:

```sql
content text,
search_document tsvector GENERATED ALWAYS AS (
  to_tsvector('<resolved configuration>'::regconfig, coalesce(content, ''))
) STORED
```

and `vectors_search_document_gin_idx USING gin (search_document)`. A new table contains only configured payload columns; its presence constraint ORs `IS NOT NULL` across those columns. An existing dense/sparse table adds `content IS NOT NULL` to its Crux-owned presence constraint. Existing `vectors` table and index names remain in this release to keep migration additive; renaming them is out of scope.

`setup.check()` is non-mutating and reports missing columns, generated expression/configuration, GIN index, pgvector requirements, dimensions, and presence constraint with stable finding codes. `setup.apply()` retains the schema advisory transaction lock and may create the extension/schema/table, add nullable columns, replace only the Crux-owned presence constraint, and create missing indexes. It never drops user data, rewrites content from the records table, or changes a text-search configuration silently.

Existing rows remain valid with null content. After `apply()`, users run `knowledgeBase.reindex()` to populate lexical content; `check()` reports `POSTGRES_SEARCH_LEXICAL_CONTENT_MISSING` while active indexed chunks have null content, with reindex remediation. A configuration mismatch reports `POSTGRES_SEARCH_CONFIGURATION_INCOMPATIBLE`; changing it requires an explicit migration/reindex because PostgreSQL must rebuild the generated column and GIN index.

## Observability and errors

Retrieval spans and `retrieval.hits` artifacts add `searchLegs`, per-leg candidate counts, fusion strategy, and `rrfK`; hit previews may include `matches` but never vectors or full stored content. PostgreSQL backend failures remain `new StorageError('backend_error', message, { cause })`. Validation and capability errors occur before embedding/provider I/O where possible. Dense embedding-space mismatch, hydration miss, and setup finding behavior retain their current typed errors.

## Conformance and delivery

Implementation must add shared SearchStore conformance tests for validation, capability rejection, exact pre-filtering, full-replacement upsert/delete, per-leg candidate bounds, normalized RRF, thresholds, match details, and deterministic ties. The legacy suite remains as a compatibility suite and adds adapter/translation tests for third-party `VectorStore`, `storage.vectors`, `postgresVectorStore`, and `inMemoryVectorStore`.

PostgreSQL integration tests cover setup check/apply from empty and existing vector schemas, idempotency, lexical-only records, configuration validation, GIN use, punctuation and empty queries, filters before ranking, inactive generations, reindex population, dense+lexical single-statement RRF with unequal candidate counts and custom `k`, score/tie determinism, deletes, and caller-owned pool behavior.

Docs must make `storage.search`, `postgresSearchStore`, composable plans, setup/apply, and reindexing canonical; old names appear only in a migration note. That note explicitly calls out the new `RetrieverMode` member and the legacy PostgreSQL hybrid score-scale change: hybrid RRF moves from a raw sum (maximum near `2 / 61` for two legs at `k = 60`) to normalized `[0, 1]`, so thresholds may need retuning. The implementation updates an existing relevant pending changeset or adds a minor changeset for `@use-crux/core` and `@use-crux/postgres`, following repository policy.

## Rejected alternatives

- Fixed strings such as `lexical-hybrid`, `dense-lexical`, or an expanding mode matrix: rejected because legs are independently composable.
- Treating PostgreSQL lexical search or BM25 as `SparseEmbedding`: rejected because corpus-owned ranking is not a stateless embedding.
- A separate lexical store with dual writes and core-side fusion: rejected for this release because PostgreSQL can keep one row, one filter boundary, and one query.
