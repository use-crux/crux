# @crux/local Architecture

`@crux/local` is the Go runtime for local Crux development. It owns the HTTP server, WebSocket/SSE
subscriptions, TUI, embedded devtools UI, observability read models, Project Index read models, and
the local Quality Workbench filesystem boundary.

## Quality Filesystem Boundary

`.crux/quality` is a local, file-backed contract shared by the Go runtime and external writers such
as the Node eval runner. The single parser/normalizer/writer owner is:

```txt
internal/qualityfs
```

`qualityfs` is a leaf package: it uses the Go standard library only and does not import `store`,
`quality`, `indexread`, `observability`, or API packages. This keeps the persisted record contract
separate from service orchestration and Project Index enrichment.

`qualityfs` owns:

- directory defaults and layout (`.crux/quality`, per-kind JSON files, JSONL streams);
- canonical filename sanitization;
- exported persisted record structs with frozen JSON tags;
- typed sealed writes through `Put`;
- JSONL append/read mechanics;
- feedback annotation overlays;
- insight status latest-wins and silence tombstone folding;
- cassette discovery, summaries, issue overlays, coverage, and hit-rate recomputation;
- snapshot join maps by trace, target, and id;
- snapshot cache revalidation by cheap filesystem fingerprint.

`qualityfs.Snapshot` is the dominant read API. It parses each persisted kind once, applies overlays,
builds joins, and returns immutable values to callers. Snapshot loading is best-effort: callers get a
non-nil partial snapshot plus an `errors.Join` error when one kind fails. External files written after
a snapshot are visible on the next call when the filesystem fingerprint changes.

## Consumers

`internal/indexread` consumes `qualityfs.Load` and owns only Project Index read-model enrichment. It
does not parse `.crux/quality` files directly and should not redeclare persisted quality records.

`internal/quality.Service` owns local workbench API orchestration: event publishing, HTTP/API mapping,
observability-derived runs, insight loading, and suite merging with the Project Index. It delegates
persisted reads and writes to `qualityfs`, then calls the pure insight derivation layer described
below.

`internal/store` stores raw Project Index snapshots and in-memory runtime/eval state. It must not
persist derived `IndexQuality` fields or parse `.crux/quality`.

## Quality Insight Derivation

Insight derivation is pure package-local logic in `internal/quality`. `buildQualityInsightsFromRuns`
is the loader/orchestrator: it reads one `qualityfs.Snapshot`, supplies observability-derived
`qualityRunRecord` values, passes an explicit `time.Time`, and calls `deriveInsights`.

`deriveInsights(qualityInsightInputs)` must not perform I/O or read the clock. It combines:

- file-backed quality snapshot data: experiments, feedback, cassettes, statuses, and silences;
- observability-derived run summaries;
- an explicit current time used for reopen timestamps.

Keep the insight files split by concern:

- `quality_insights.go`: loader wrapper plus status/silence persistence.
- `quality_insight_derivation.go`: top-level pure derivation pipeline.
- `quality_insight_patterns.go`: repeated-pattern detection and per-run signal suppression.
- `quality_insight_projection.go`: enrichment, severity helpers, status application, and silence
  filtering.
- `quality_insight_derivation_test.go`: table-driven tests over the pure derivation boundary.

## qualityfs File Layout

Keep `internal/qualityfs` split by concern:

- `fs.go`: `FS`, kind/stream constants, `Open`, and directory defaults.
- `records.go` and `records_*.go`: the sealed `Record` interface plus persisted record structs
  split by suite, experiment, comparison/baseline, feedback, insight, and cassette domains.
- `snapshot.go`: snapshot options, load orchestration, immutable snapshot copies, and join maps.
- `io.go`: raw JSON/JSONL mechanics.
- `read_*.go`: typed readers over raw records and streams.
- `put.go`: typed writes and per-record write validation/defaults.
- `cassette.go`, `cassette_discovery.go`, and `cassette_issues.go`: cassette parsing/loading,
  project discovery, issue overlays, and metrics.
- `normalize.go`, `normalize_*.go`, and `names.go`: shared helpers plus suite defaults,
  `EnrichExperiment`, silence IDs, and canonical filenames.
- `fingerprint.go`: cache revalidation fingerprints.

If a file starts owning more than one concern, split it before adding another behavior.
