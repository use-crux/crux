# ADR 0008: Local Index Read Model Owns Quality Enrichment

Status: Accepted

Date: 2026-06-10

## Context

Project Index quality annotations used to be assembled by three separate producers:

- `@crux/local/internal/store`, which joined in-memory eval, RAG eval, and flow runs while returning
  `Store.GetIndex()`.
- `@crux/local/internal/quality`, which parsed and joined file-backed `.crux/quality` records.
- `@crux/local/internal/devtools`, which added local filesystem metadata and safety target metadata.

The order mattered, but it was only implied by call sites. File-backed baseline and drift logic
depended on run-derived fields already being present, while cache writes and runtime snapshot merges
also called `GetIndex()` even though those paths need raw snapshot data.

## Decision

`@crux/local/internal/indexread` is the only producer of derived Project Index read-model quality.
The `.crux/quality` on-disk contract itself is owned by `@crux/local/internal/qualityfs`.

`store.Store` stores raw Project Index snapshots and exposes:

- `GetIndex()` for raw snapshot callers.
- `Snapshot()` for one atomic raw index plus in-memory run snapshot.

`indexread.Model.Index()` is the devtools/API read-model path. Its enrichment order is fixed:

1. Join in-memory eval, RAG eval, and flow runs.
2. Load one `qualityfs.Snapshot` from `.crux/quality`, then join experiments, suites, cassettes,
   feedback, baselines, comparisons, drift, and lint policy.
3. Add source mtime metadata and safety `appliesTo` metadata.

`indexread.Model.Raw()` exists for callers that need the raw snapshot and should not observe derived
quality data.

## Consequences

- `IndexQuality` aggregation rules have one implementation surface.
- Devtools HTTP and websocket snapshots share the same read-model function.
- Cache writes, incremental indexing, and runtime snapshot merging can use raw store data without
  accidentally persisting derived quality fields.
- `qualityfs` owns quality workbench file formats, record normalization, JSONL streams, feedback
  annotation overlays, insight status/silence folding, cassette issue overlays, and snapshot joins.
- `quality.Service` continues to own quality workbench APIs, event publishing, observability-derived
  run loading, insight persistence, and API mapping, but not file parsing or Project Index
  enrichment.
- Insight derivation is pure package-local logic: callers pass a `qualityfs.Snapshot`,
  observability-derived runs, and an explicit clock value into `deriveInsights`.
- `indexread` consumes `qualityfs.Load` and must not redeclare persisted quality records or parse
  `.crux/quality` directly.
- `@crux/indexer` remains responsible for authored source facts, not local runtime/file-backed joins.

## Validation

The local runtime has boundary tests for:

- in-memory eval/RAG/flow run fan-out through `indexread.Model.Index()`;
- full pipeline ordering across run facts, experiments, baselines, source mtimes, and safety targets;
- `qualityfs` boundary behavior for immutable snapshots, external-writer visibility, feedback
  overlays, and cassette issue overlays;
- pure insight derivation behavior for pattern detection, signal suppression, silencing, and
  resolved-insight reopening without filesystem or observability setup;
- `store.IndexQuality` and `api.IndexQuality` compatibility through shared read-model tests.
