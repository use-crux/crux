# @use-crux/local Context

## Language

**QualityFS**:
The internal Go package `internal/qualityfs` that owns the `.crux/quality` on-disk contract.
_Avoid_: quality readers, Project Index read-model quality parsers, service file helpers

**Quality Snapshot**:
The immutable read model returned by `qualityfs.Snapshot`. It contains parsed records, overlay-folded
streams, cassette summaries, and join maps.
_Avoid_: partial quality cache, index quality model

**Quality Workbench Service**:
`internal/quality.Service`, the API/orchestration layer for local workbench endpoints, events,
observability-derived runs, insight loading, persistence, and API mapping.
_Avoid_: file format owner, parser owner

**Quality Insight Derivation**:
The pure `deriveInsights(qualityInsightInputs)` layer in `internal/quality`. It combines a
Quality Snapshot, observability-derived runs, and an explicit clock value into insight records.
_Avoid_: service insight loader, observability query, qualityfs snapshot

**Project Index Read Model**:
The devtools-facing read model produced by `internal/projectindex/readmodel`, enriched from raw Project Index
snapshots plus runtime and Quality Snapshot data.
_Avoid_: raw store index, quality filesystem owner

**Project Index Event Wire**:
The `internal/projectindex/eventwire` package that validates Project Index worker event streams and
projects them into patch/source-profile/artifact records.
_Avoid_: generic wire, request wire, worker host

**Project Index Workers**:
The `internal/projectindex/workers` package family that composes Local's TypeScript worker lanes and
Node process adapters.
_Avoid_: host, projectindexer, UI-owned worker packages

**TypeScript Worker Request Wire**:
The `internal/projectindex/workers/requestwire` package that builds batched requests for TypeScript
worker entrypoints.
_Avoid_: indexwire, eventwire, protocol mirror

**Static Syntax Frontend**:
The `internal/projectindex/staticindex/frontend` package that adapts parser frontend processes and
Static Syntax records.
_Avoid_: staticindex/syntax worker package, Static Index compiler client

**Static Index Compiler Client**:
The `internal/projectindex/staticindex/compiler` package that calls Rust Static Index compiler
methods.
_Avoid_: staticindex/client, parser frontend, semantic backend

**Resolved Project Model**:
The local-facing project shape assembled from Project Index facts, QualityFS conventions, runtime
evidence, and optional policy config. It should show inferred versus explicit provenance.
_Avoid_: central registry, dashboard config, hidden setup

**Local Tooling Policy**:
Optional local config or CLI/run-tier choices for lint profile, discovery overrides, replay posture,
extension trust, and local/cloud data boundaries.
_Avoid_: prompt registry, context registry, tool registry

**Local Auto-Attach**:
Best-effort local observability attachment when `crux dev` provides a local devtools target.
_Avoid_: production telemetry default, cloud export default

## Relationships

- QualityFS owns `.crux/quality` parsing, normalization, writes, overlays, and snapshot caching.
- Quality Workbench Service consumes QualityFS and owns API behavior and event publication.
- Quality Insight Derivation consumes Quality Snapshot data and run records without performing I/O or
  reading the clock.
- Project Index Read Model consumes QualityFS and owns derived `IndexQuality` annotations.
- Project Index Event Wire consumes worker event streams; TypeScript Worker Request Wire builds worker
  requests. Keep those directions separate.
- Static Syntax Frontend adapts parser evidence; Static Index Compiler Client calls compiler methods.
  Keep both separate from semantic backend behavior.
- Resolved Project Model combines Project Index facts, QualityFS conventions, runtime evidence, and
  Local Tooling Policy without requiring duplicate primitive registration.
- Local Tooling Policy may override or constrain local behavior, but it must not be the only way for
  local tools to discover authored prompts, contexts, tools, memories, retrieval, flows, or agents.
- `store.Store.GetIndex()` returns raw Project Index data and must not include Quality Snapshot
  enrichment.
- External writers may write `.crux/quality` files at any time; QualityFS snapshots must observe those
  writes on the next read.

## Rules

- Do not redeclare persisted `.crux/quality` record structs outside `internal/qualityfs`; use aliases
  only when keeping package-private service names readable.
- Do not add new `.crux/quality` parsing helpers in `internal/quality` or `internal/projectindex/readmodel`.
- Put new overlay/fold semantics in `internal/qualityfs` with boundary tests.
- Keep observability run summaries out of `qualityfs`; they are runtime-derived, not part of the
  filesystem contract.
- Keep new insight detection, suppression, silencing, and reopen behavior table-testable through
  `deriveInsights`; loaders must pass snapshots, runs, and `now` explicitly.
- Do not add a local tooling dependency on `config({ prompts, contexts, tools, stores, memories })`
  when the relationship is already authored in source. Add Project Index discovery or diagnostics
  instead.
- Do not add new `host`, `indexwire`, `wire`, `staticindex/syntax`, or `staticindex/client` package
  references when adding Project Index runtime code; use the target responsibility names.
- Keep production telemetry, cloud upload, raw-content capture, retention, durable stores, providers,
  and destructive capabilities explicit. Local Auto-Attach is local-only and best-effort.
