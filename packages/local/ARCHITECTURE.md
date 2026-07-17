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

## Eval and Inspect Filesystem Boundaries

Eval V3 artifacts and Inspect state retain the existing `.crux/quality` physical directory for an
in-place migration, but the directory name is storage provenance—not a public product model.

- `internal/evalfs` validates and reads authoritative Eval V3 run and Baseline records. It preserves
  exact stored run bytes and never reinterprets archived V2 experiments as reusable evidence.
- `internal/inspectfs` owns Inspect insight records plus status and silence streams.
- `internal/legacymigration` atomically archives V2 experiment records under the read-only legacy
  boundary. It does not make archived data eligible for Eval reuse or Baseline comparison.
- `internal/review` owns durable feedback and Review projections; repository writes go through
  `internal/reviewwriter` and the project-local Eval Case contract.

Services and HTTP handlers consume these focused packages. Project Index storage remains raw and
must not absorb Eval, Inspect, or Review projections.

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

## Eval, Inspect, and Review File Layout

Keep the storage packages split by responsibility:

- `internal/evalfs`: read and validate Eval V3 run/Baseline artifacts.
- `internal/inspectfs`: normalize, persist, and fold Inspect insight state.
- `internal/review`: persist immutable feedback submissions and Review action history.
- `internal/reviewwriter`: coordinate validated, atomic Add-to-eval source writes.
- `internal/legacymigration`: one-way archival of pre-Eval records only.

Do not reintroduce a single cross-domain snapshot package. If a file starts owning more than one
concern, split it before adding another behavior.
