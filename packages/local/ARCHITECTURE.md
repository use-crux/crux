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
observability-derived runs, insight derivation, and suite merging with the Project Index. It delegates
persisted reads and writes to `qualityfs`.

`internal/store` stores raw Project Index snapshots and in-memory runtime/eval state. It must not
persist derived `IndexQuality` fields or parse `.crux/quality`.

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
  experiment enrichment, silence IDs, and canonical filenames.
- `fingerprint.go`: cache revalidation fingerprints.

If a file starts owning more than one concern, split it before adding another behavior.
