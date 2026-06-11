# @crux/local Context

## Language

**QualityFS**:
The internal Go package `internal/qualityfs` that owns the `.crux/quality` on-disk contract.
_Avoid_: quality readers, indexread quality parsers, service file helpers

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
The devtools-facing read model produced by `internal/indexread`, enriched from raw Project Index
snapshots plus runtime and Quality Snapshot data.
_Avoid_: raw store index, quality filesystem owner

## Relationships

- QualityFS owns `.crux/quality` parsing, normalization, writes, overlays, and snapshot caching.
- Quality Workbench Service consumes QualityFS and owns API behavior and event publication.
- Quality Insight Derivation consumes Quality Snapshot data and run records without performing I/O or
  reading the clock.
- Project Index Read Model consumes QualityFS and owns derived `IndexQuality` annotations.
- `store.Store.GetIndex()` returns raw Project Index data and must not include Quality Snapshot
  enrichment.
- External writers may write `.crux/quality` files at any time; QualityFS snapshots must observe those
  writes on the next read.

## Rules

- Do not redeclare persisted `.crux/quality` record structs outside `internal/qualityfs`; use aliases
  only when keeping package-private service names readable.
- Do not add new `.crux/quality` parsing helpers in `internal/quality` or `internal/indexread`.
- Put new overlay/fold semantics in `internal/qualityfs` with boundary tests.
- Keep observability run summaries out of `qualityfs`; they are runtime-derived, not part of the
  filesystem contract.
- Keep new insight detection, suppression, silencing, and reopen behavior table-testable through
  `deriveInsights`; loaders must pass snapshots, runs, and `now` explicitly.
