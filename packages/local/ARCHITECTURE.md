# @use-crux/local Architecture

`@use-crux/local` is the Go runtime for local Crux development. It owns the HTTP server, WebSocket/SSE
subscriptions, TUI, embedded devtools UI, observability read models, Project Index read models, and
the local Quality Workbench filesystem boundary.

## Local Configuration Boundary

Local Crux tooling should treat source and runtime evidence as the primary description of the
harness. A central `crux.config.ts` file is allowed as an override/policy boundary, but it must not be
required to repeat primitive relationships that were already authored in code.

The product rule is:

> Explicit construction decides behavior; Crux discovery provides visibility.

For `@use-crux/local`, this means:

- `crux dev`, Devtools, lint, and Quality should be able to start from conventions and the Project
  Index whenever possible.
- Local defaults such as `.crux/quality`, `.crux/cache`, package-name quality ids, and conventional
  `*.eval.ts` discovery are local tooling behavior, not production ownership decisions.
- A future `crux config inspect` or equivalent Project Model view should explain inferred package
  roots, source roots, ignored paths, discovered definitions, quality assets, explicit config files,
  and diagnostics with inferred-vs-explicit provenance.
- Runtime behavior that moves data, spends money, persists state, installs plugins, exports telemetry,
  enables cloud upload, or changes privacy/retention must remain explicitly authored or explicitly
  configured.
- Local devtools auto-attachment is allowed only for a local Crux dev environment. Production
  telemetry or cloud export stays explicit.

Local code should therefore avoid new APIs that require `config({ prompts, contexts, tools, stores,
memories, retrievers })` before local tooling can see an authored harness. When discovery is partial,
return diagnostics and small fixes rather than turning config into a second product model.

## Quality Filesystem Boundary

`.crux/quality` is a local, file-backed contract shared by the Go runtime and external writers such
as the Node eval runner. The single parser/normalizer/writer owner is:

```txt
internal/qualityfs
```

`qualityfs` is a leaf package: it uses the Go standard library only and does not import `store`,
`quality`, `projectindex/readmodel`, `observability`, or API packages. This keeps the persisted
record contract separate from service orchestration and Project Index enrichment.

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

`internal/projectindex/readmodel` consumes `qualityfs.Load` and owns only Project Index read-model enrichment. It
does not parse `.crux/quality` files directly and should not redeclare persisted quality records.

`internal/quality.Service` owns local workbench API orchestration: event publishing, HTTP/API mapping,
observability-derived runs, insight loading, and suite merging with the Project Index. It delegates
persisted reads and writes to `qualityfs`, then calls the pure insight derivation layer described
below.

`internal/store` stores raw Project Index snapshots and in-memory runtime/eval state. It must not
persist derived `IndexQuality` fields or parse `.crux/quality`.

## Project Index Runtime Boundary

`internal/projectindex/service` is the Local facade for Project Index refreshes. Server, route, TUI,
and devtools packages should call service and read-model APIs instead of importing worker, eventwire,
cache, or Static Index internals directly.

Internally the package keeps each refresh concern in its own file. `run.go` defines the `refreshRun`
state (root/config/project, started time, watch run, semantic mode, generation, Static Index metadata,
and previous/current snapshots) plus the single semantic-and-lint completion shared by both flows;
`reindex_full.go` and `reindex_incremental.go` build a `refreshRun` and hand it to that completion so
the semantic-mode branching is not duplicated. `patch_apply.go` owns patch normalization plus the
commit/apply/publish write path, `semantic_scheduler.go`/`semantic_patch.go` own semantic phase
scheduling, and `lint_scheduler.go` owns lint scheduling and prefetch.

The target Go package names are responsibility names:

- `internal/projectindex/eventwire`: Project Index worker event stream collection and validation.
- `internal/projectindex/workers`: composition root for TypeScript worker lanes.
- `internal/projectindex/workers/requestwire`: batched requests sent to TypeScript workers.
- `internal/projectindex/workers/source`, `workers/semantic`, `workers/runtime`, and
  `workers/node`: focused worker-lane adapters.
- `internal/projectindex/staticindex/frontend`: Static Syntax frontend process adaptation.
- `internal/projectindex/staticindex/compiler`: Go client for Rust Static Index compiler methods.
- `internal/projectindex/staticindex/run`: deep module facade for Static Index prepare/analyze/finalize
  orchestration, split into `prepare.go`, `analyze.go`, `finalize.go`, `compile.go`, and `cache.go`.

The former `staticindex/syntax` and `staticindex/client` packages were renamed to
`staticindex/frontend` and `staticindex/compiler`. New code should use the target vocabulary and
should not add compatibility aliases for the old package names.

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

## TUI Architecture

The local TUI is an in-process Bubble Tea surface over the same services that power the browser
devtools. It must not add WebSocket or HTTP paths for its own reads. Domain services publish typed
events on local channels; `internal/tui/bridge` coalesces those events into revision-tagged batches;
`internal/tui/workbench.go` routes each batch to the active screen and marks inactive interested
screens stale for one refetch on focus.

Rendering is layered:

- `internal/theme` owns the shared palette, tone mapping, glyphs, and immutable style sets for both
  CLI and TUI output.
- `internal/tui/kit` owns geometry, composition, virtualized lists/tables, bounded components, and
  small render caches. Screens render inside the `Size`/rect they are given and must not render
  beyond it.
- `internal/tui/shell` owns chrome shared by every screen: nav rail, breadcrumb, panes, and status
  bar.
- `internal/tui/screens` owns screen state, DataClient calls, key handling, and pure view assembly.
- `internal/tui/overlays` owns modal palette, help, and inspect surfaces; overlays must satisfy the
  same resize-fuzz bounds as screens.

The screen data boundary is `internal/tui/screens.DataClient`, implemented by
`internal/devtools.DirectClient` for production and `internal/tui/uitest.FixtureClient` for tests.
If a screen action needs a service method that does not exist, do not invent a placeholder command or
new transport path. Record the gap and resolve the service contract first.

Every screen and overlay should have deterministic fixture-backed resize fuzz coverage. Goldens live
next to the screen tests and are refreshed intentionally with the package-specific `-update` tests.
Manual terminal smoke is still useful for feel and performance, but width, height, and truncation
claims should be enforced by tests.

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
