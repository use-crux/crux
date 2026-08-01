# Next, setup, config loading, and Postgres storage design

## Summary

Address six validated integration gaps and add first-party PostgreSQL storage
for Connected Knowledge:

1. Make `@use-crux/core/runtime/next` resolvable from Next's default
   `next.config.ts` loader.
2. Accept Next configurations whose `webpack` property is `null` without
   lying about the wrapped return type.
3. Stop generating unused Eval host capability constants when a project has
   no deployable Evals.
4. Make `crux setup --apply` ensure project-local `.crux/` state is ignored by
   Git before generated or secret-bearing local state is written.
5. Resolve `tsconfig.json` and `jsconfig.json` path aliases in root-config
   transitive imports.
6. Add PostgreSQL `RecordStore` and dense/sparse/hybrid `VectorStore`
   adapters, plus a composed storage bundle.

The implementation should keep `@use-crux/core` provider-agnostic, keep the
existing PostgreSQL Runtime adapter independent from application storage, and
avoid adding a JavaScript pgvector client dependency.

## Goals

- Work with the default Next 16 TypeScript config loader and its declared
  `NextConfig` type.
- Keep generated Next entries free of no-Eval lint warnings.
- Protect all `.crux/` contents, including ingest tokens and SQLite state,
  through an idempotent setup action.
- Give config loading the same practical path-alias behavior authors receive
  from TypeScript-aware application tooling.
- Let Connected Knowledge use first-party PostgreSQL records and vector search
  without a custom adapter.
- Support dense, sparse, and hybrid retrieval honestly through declared
  capabilities and shared conformance suites.

## Non-goals

- Publishing CommonJS builds of Crux packages.
- Replacing Next's config loader or moving `withCruxBuild()` to
  `@use-crux/next`.
- Implementing a complete general-purpose `.gitignore` parser.
- Adding `RecordStore.watch()` through PostgreSQL `LISTEN`/`NOTIFY`.
- Coupling Runtime Engine tables to Connected Knowledge storage tables.
- Supporting provider-specific DBSF semantics before Crux defines a portable
  normalization contract.
- Adding PostgreSQL asset storage.

## Design

### Next package resolution

Add a `default` condition to the `./runtime/next` export in
`packages/core/package.json`, pointing to the same ESM source as `import`.
The npm staging script already preserves and rewrites `default` targets to
compiled JavaScript.

Next's default `next.config.ts` loader transpiles static imports to
`require()`. A `default` condition makes the ESM subpath resolvable to that
loader without advertising or producing a distinct CommonJS artifact. The
package remains ESM-only and continues to require Node 22 or newer.

Release tests will inspect the staged manifest and load the staged subpath
through both dynamic `import()` and `createRequire()`.

### `withCruxBuild()` typing

Define one internal webpack-hook type and allow
`CruxNextConfig.webpack?: WebpackHook | null`. At runtime, delegate only when
`typeof nextConfig.webpack === "function"`.

Return:

```ts
Omit<TConfig, "webpack"> & { webpack: WebpackHook }
```

rather than `TConfig`. This preserves all authored config fields while
truthfully representing that the wrapper always installs a callable webpack
hook, including when the input explicitly contains `webpack: null`.

Core will not import `NextConfig` or add a dependency on `next`; a type test
will use a structurally equivalent Next-like configuration.

### No-Eval generated entries

`nextEntryFile()` will emit `supportedEvalHostCapabilities` and
`evalHostCapabilities` only when `hasEvals` is true. The empty exported Eval
registry remains stable because it is part of the generated entry surface.
Convex generation is unchanged because its generated host consumes the
capability list.

Tests will assert absence in both a project with no Eval definitions and a
project with Eval source that produces no deployable Runtime Eval. Existing
positive assertions continue to prove emission when Evals exist. The checked-in
Local fixture will be regenerated or updated to match.

### `.crux/` Git protection

Add a `local-state` setup contributor and register it before Runtime and defer
contributors. Inspection is read-only. When the project root does not contain
an effective canonical root rule for `.crux`, it reports
`LOCAL_STATE_NOT_GITIGNORED` and plans one `safe-additive` action.

Application appends a canonical `.crux/` line to the root `.gitignore`:

- create `.gitignore` when absent;
- preserve all existing bytes;
- insert one newline first when the existing file has no trailing newline;
- never duplicate the canonical rule on repeated application;
- recognize `.crux`, `.crux/`, `/.crux`, and `/.crux/` as equivalent positive
  root rules;
- append the canonical rule when a later matching negation would otherwise
  re-include `.crux`.

The contributor runs before Runtime artifact generation, so a successful
`crux setup --apply` protects `.crux/` before the setup operation writes into
it. The setup report owns the `.gitignore` mutation; it is not added to Runtime
artifact `changedFiles`.

This change does not make every command mutate `.gitignore` implicitly.
Projects that bypass setup may still receive a clear safety warning in future
work, but command-specific Git mutations are outside this change.

### TypeScript path aliases in user imports

Extend the registered user-module resolver in
`packages/indexer/src/indexer/imports.ts`. After normal Node resolution fails
for an authored import session:

1. Find the nearest `tsconfig.json` or `jsconfig.json` from the importing
   module, bounded by the project import root.
2. Parse it with TypeScript configuration APIs so `extends`, `baseUrl`,
   `paths`, and the selected module-resolution mode retain TypeScript meaning.
3. Resolve the specifier with `ts.resolveModuleName()`.
4. Reject declaration-only results and paths outside the authored project.
5. Feed the resolved source file through the existing extension handling,
   content fingerprinting, transpilation, timeout, and import-session identity.

Cache parsed config state by config path plus content identity during an import
session. Every config file consulted while resolving `extends` participates in
that identity. `LoadedProjectConfigResult.sources` records the complete parsed
config closure rather than only the selected root config.

The executable Static Index config artifact gains a bounded, root-relative
`configDependencies` list for the same closure. The Go protocol mirror and
Static Index planner hash every listed file into the plan/cache inputs, watch
them as index boundaries, and invalidate on change or deletion. This is a
durable dependency contract; a one-time epoch bump is not a substitute for
tracking future edits to extended configs. Paths outside the project root may
be used by TypeScript resolution only when the authored config explicitly
extends them, but are rejected from the root-relative artifact and disable
cache reuse for that config load.

Do not prebundle user configuration and do not install a second loader.

Tests cover a root config whose relative transitive import uses `@/*`, an
extended config, `jsconfig.json`, a missing alias, and containment. Cache tests
change and delete an extended config while authored source stays unchanged and
prove that the config artifact and Static Index plan are not reused. A built
worker smoke test proves the embedded Local path, not only the source test
environment. The implementation will also audit the hard cache epoch and bump
it if the first alias-aware release could otherwise reuse a pre-feature entry.

### PostgreSQL storage API

Add the package root export `@use-crux/postgres` while preserving
`@use-crux/postgres/runtime`.

The root exports:

```ts
postgresRecordStore(options?)
postgresVectorStore(options)
postgresStorage(options)
```

The associated public types are `PostgresRecordStoreOptions`,
`PostgresVectorStoreOptions`, `PostgresStorageOptions`, and the corresponding
adapter return types. Connection options follow the Runtime adapter:
`url`, `pool`, `poolOptions`, and `schema`. The default storage schema is
`crux_storage`, separate from `crux_runtime`. A caller-supplied pool is never
closed by an adapter; an adapter-created pool is closed by its public
`close()` method.

`postgresStorage()` creates records and vectors over one pool and exposes one
idempotent `setup` port and one `close()` boundary. Individual adapters expose
the same setup lifecycle for standalone use. Schema setup is explicit rather
than hidden in the first data operation.

Vector options require `dimensions`. `sparseDimensions` is optional; when it
is absent, the adapter advertises dense-only behavior. When present, it
advertises sparse and hybrid behavior as well. This is necessary because the
Crux sparse representation carries non-zero indices and values but not its
total vector width, while PostgreSQL `sparsevec` requires that width.

### PostgreSQL schema and setup

Setup creates or verifies the pgvector extension only for vector-capable
adapters, then creates the selected schema and tables.

The records table contains:

- `key text primary key`
- `value jsonb not null`
- `expires_at timestamptz`
- `version bigint not null`

It has a `text_pattern_ops` prefix index, an expiration index, and a JSONB GIN
index for scalar containment filters.

The vectors table contains:

- `key text primary key`
- `dense vector(dimensions)`
- `sparse sparsevec(sparseDimensions)` when sparse support is configured
- `metadata jsonb not null default '{}'::jsonb`

At least one vector value must be present. Setup creates cosine HNSW indexes
for configured dense and sparse columns and a JSONB GIN metadata index. DDL
uses quoted, validated identifiers and parameters for all authored data.

Setup checks extension availability/version, schema, tables, required columns,
configured dimensions, constraints, and indexes. `apply()` is additive and
idempotent. Missing extension privileges or incompatible existing dimensions
produce redacted setup findings rather than leaking connection information.

### PostgreSQL `RecordStore` behavior

- Validate keys, JSON values, filters, limits, cursors, and TTLs before SQL.
- Suppress expired values from `get`, `getMany`, `list`, `scan`, `create`, and
  versioned reads. TTL is reported as `lazy` because PostgreSQL does not remove
  rows automatically.
- Use ordered keyset pagination and opaque encoded cursors. Prefix matching
  escapes `%`, `_`, and `\\`.
- Use JSONB containment for exact top-level scalar filters, preserving the
  distinction between explicit JSON `null` and a missing property.
- Implement `getMany`, `putMany`, and `deleteMany`; reads preserve input order
  and duplicate batch writes are deterministic last-write-wins.
- Implement atomic conditional creation with expired rows treated as absent.
- Expose versioned compare-and-set through `getVersioned` and `putVersioned`;
  report `mutate: "cas"` and let Core's bounded `mutateRecord()` helper provide
  linearizable mutations.
- `putVersioned(key, value, null)` atomically inserts when no live row exists
  and replaces an expired physical row in the same statement/transaction.
  A non-null expected version never matches an expired row. This keeps the
  logical absence observed by `getVersioned()` consistent with subsequent CAS.
- Report `{ ttl: "lazy", filter: "native", watch: false, batch: true,
  mutate: "cas" }`.
- Wrap backend failures in privacy-safe `StorageError` values.

### PostgreSQL `VectorStore` behavior

Dense and sparse values use cosine similarity, returned as a descending score
where larger is better. All input numbers must be finite; dense width and
sparse bounds must match configuration. Crux zero-based sparse indices are
converted to pgvector's one-based `sparsevec` text form at the SQL boundary.

Metadata accepts only exact top-level scalar values and is applied before
ranking. Upsert supports dense-only, sparse-only, or combined records when the
configured capabilities permit them. Delete is strongly consistent.

Search modes:

- `dense`: rank the dense column by cosine distance;
- `sparse`: rank the sparse column by cosine distance;
- `hybrid`: obtain bounded dense and sparse candidate rankings and combine
  them with reciprocal-rank fusion, using a stable key tie-break;
- explicit `fusion: "rrf"` uses the same portable RRF path;
- `fusion: "dbsf"` returns `unsupported_capability` until Core defines a
  portable DBSF normalization contract.

Capabilities are:

```ts
{
  dense: true,
  sparse: sparseDimensions !== undefined,
  hybrid: sparseDimensions !== undefined,
  fusion: sparseDimensions === undefined ? [] : ["rrf"],
  filter: "pre",
  consistency: "strong",
}
```

HNSW is an approximate index. Documentation will explain its recall tradeoff,
pgvector dimension/non-zero limits, and how exact scans differ. Tests use
deterministic small fixtures while still verifying that setup creates the
declared indexes.

Hybrid search uses fixed portable semantics. For requested `limit = n`, each
modality retrieves `min(1000, max(50, 4 * n))` candidates after metadata
filtering; `limit = 0` returns immediately. RRF uses `k = 60`. The raw sum is
normalized by the theoretical two-modality maximum `2 / (k + 1)`, producing a
score in `[0, 1]`; a hit present in only one modality can score at most `0.5`.
The query `threshold` applies to this normalized post-fusion score, then results
sort by score descending and key ascending before applying the final limit.
Dense and sparse modes continue to apply threshold to cosine similarity.

### Project Index storage discovery

Treat the three new factories as first-party Storage definitions:

- `postgresRecordStore` produces `storage.recordStore` with PostgreSQL record
  capabilities;
- `postgresVectorStore` produces `storage.vectorStore`; statically known
  `sparseDimensions` controls sparse/hybrid/RRF capability projection, while
  non-literal configuration remains conservative;
- `postgresStorage` produces `storage.bundle` with record and vector
  capabilities.

Update the compiler-owned storage descriptor table, semantic/native call-name
manifests, direct projector coverage, backend parity fixtures, static syntax
interests/goldens where applicable, and Project Index capability assertions.
Because changing the descriptor manifest changes Project Index output for
unchanged authored calls, update its structured compiler identity and bump the
static/semantic cache epochs only where existing identity inputs do not already
capture the new manifest version.

## Error handling and privacy

- Package resolution and type failures receive compile/load regression tests,
  not new runtime error codes.
- Alias resolution failures continue through the existing sanitized config
  import diagnostic.
- Setup findings name the missing capability or schema object but never
  include connection URLs, credentials, SQL parameter values, or authored
  record contents.
- PostgreSQL operations translate validation, unsupported capability,
  conflict, and backend failures into existing `StorageError` codes.
- `.gitignore` application failures are contained by the existing setup
  contributor failure contract.

## Verification

Focused verification includes:

- Core runtime tests and typecheck for Next nullability and callable output.
- Staged npm package tests for `runtime/next` resolution from ESM and Next's
  CommonJS-lowered TypeScript loader.
- Indexer artifact tests for no-Eval and Eval-positive generation.
- Setup contributor and setup-operation tests for absent/present ignore files,
  equivalent rules, negation, empty files, missing final newlines, read-only
  checks, ordering, and repeated apply.
- Source and built-worker config import tests for alias resolution.
- Project Index JS/native parity tests for all PostgreSQL storage factories and
  literal versus dynamic sparse capability configuration.
- PostgreSQL `RecordStore` conformance.
- Both shared `VectorStore` conformance suites for dense, sparse, hybrid,
  filtering, thresholds, deletion, unsupported DBSF, and hydration failures.
- Connected Knowledge conformance using `postgresStorage()`.
- PostgreSQL setup idempotency, missing-extension diagnostics, incompatible
  dimensions, escaped prefixes, TTL, batches, and concurrent CAS mutation.
- Package typechecks and documentation example validation.
- Root build workflows appropriate to changed Local/indexer assets before
  final handoff.

Real PostgreSQL vector tests may use `CRUX_TEST_DATABASE_URL` when it points to
a pgvector-capable database. The default embedded harness must either install
pgvector for vector cases or skip only those integration cases with an explicit
reason; record conformance must remain runnable independently.

## Documentation and release notes

Update the Postgres README/reference and storage/Connected Knowledge guides
with record-only, dense, and dense+sparse examples. Retain the existing custom
Postgres cookbook as an advanced customization example or redirect it to the
first-party adapter.

Update `.changeset/connected-knowledge-foundations.md` with
`@use-crux/postgres: minor` and the new storage adapters. Add a separate patch
changeset for the directly affected Core, Indexer, and Local compatibility and
safety fixes because no current pending changeset describes that release
theme.

Add the new `.` export for `@use-crux/postgres` to
`scripts/portable-entrypoints.json` as `node-only`, retain `./runtime`, and
extend staged-package validation to cover both entrypoints.

No Project Index snapshot shape changes are intended. Cache epochs change only
if the alias-resolution cache audit shows that existing structured identities
would otherwise reuse stale config-derived output.
