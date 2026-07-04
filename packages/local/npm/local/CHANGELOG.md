# @use-crux/local

## 0.4.0

### Minor Changes

- fa1c979: Add the public observability `TurnDecisionReport` type contract for per-turn explanation read models, including separate freshness and cache evidence, stable decision reason codes, source joins, coverage rows, and missing-evidence diagnostics.

  Expose `decisionReport` on Crux Local Run Detail generation nodes and details, projecting request composition, runtime decisions, source joins, coverage rows, and missing-evidence gaps from existing observability evidence. The public `CruxRunDetailNode` and `CruxRunDetailDetail` types now declare the optional `decisionReport` field so consumers can read the projection without re-deriving it.

  Project recorded freshness evidence into Run Detail `decisionReport` rows, including cache outcomes accepted or rejected by freshness while keeping cache and freshness as separate evidence concepts.

  Add Quality `ctx.expect.decisionReport` matchers for protecting context dispositions, routing/fallback outcomes, freshness status, and cache acceptance using stable `TurnDecisionReport` reason codes.

  Harden Run Detail turn explanations so empty `decisionReport` collections encode as `[]` in Crux Local and Devtools tolerates older partial reports that used `null` for empty collections.

  Polish the `TurnDecisionReport` V1 contract before freeze: rename `turn.verdict` to `turn.readout` (a deterministic evidence-bound sentence, not a pass/fail judgment), rename the top-level `summary` chip list to `chips` (type `TurnDecisionChip`, was `TurnSummaryChip`), and replace `TurnCoverageArea.area` with stable `id` + display `label` fields while renaming `suggest`/`cmd` to `suggestion`/`command`. These are breaking renames to the pre-release public contract; `@use-crux/local` and Devtools are updated to match.

  Document the `TurnDecisionReport` V1 freeze policy in the observability reference, including additive `schemaVersion: 1` compatibility, matcher-stable reason codes and coverage ids, display-only human text, explicit unknown/missing/unresolved states, cache/freshness separation, and the rule that Run Insight is UI-derived from per-turn reports rather than a separate run-level `decisionReport`.

  Add docs for debugging a bad model turn with Explain and for protecting setup behavior with `ctx.expect.decisionReport` Quality assertions.

### Patch Changes

- 3cbd499: Migrate the local TUI to the Bubble Tea/Lip Gloss/Bubbles v2 stack, centralize terminal colors in the shared theme palette, add deterministic TUI golden/resize test harness coverage, and introduce the rect-based TUI kit layout, virtualized list/table, memo, and component primitives used by the rebuilt shell and legacy screen adapters.

  Add the coalescing in-process TUI reactivity bridge with revision-tagged domain routing, hidden-screen stale marking, quality insight/cassette drift event coverage, and fixes for v2 text input and CLI color gating regressions.

  Rebuild the Runs screen on rect-based kit layout with responsive full/two/single breakpoints, run filtering, duplicate-span collapse/expand behavior, deterministic Runs goldens, and resize-fuzz coverage.

  Rebuild the Overview screen around the rect-based kit layout with responsive two-pane rendering, pass-rate baseline charting, live activity scroll latching, refreshed goldens, and focused resize-fuzz coverage.

  Rebuild the Insights screen on the rect-based kit layout with a virtualized insight list, responsive single/two-pane rendering, tabbed diagnosis/detail/fix panes, deterministic goldens, and resize-fuzz coverage. Unsupported insight actions without service-backed DataClient methods are no longer silently stubbed.

  Rebuild the Experiments screen around the kit table/matrix/diff/progress primitives with running-experiment progress, promotion-ready detail rendering, JSON export fallback, deterministic goldens, and resize-fuzz coverage. Unsupported experiment actions without current service or screen surfaces are hidden for follow-up.

  Rebuild the Cassettes, Feedback, and Baselines screens with deterministic fixture data, goldens, and resize-fuzz coverage. Cassettes now surfaces read-only stats and drift context from available cassette summaries, Feedback dismiss writes through the existing annotation status surface, and Baselines can open source experiments or replace a baseline through the existing promote path while deferred Compare actions stay hidden.

  Add the Datasets TUI screen with fixture-backed dataset/case/editor rendering, local dirty tracking, undo/discard behavior, in-memory duplicate/assertion edits, deterministic goldens, and resize-fuzz coverage. Service-backed suite/case save and trace-derived case creation remain hidden until the dataset write surface is added.

  Route CLI command styling and live terminal control through the shared output IO gate, add a guard test for direct command `.Render()` calls, and keep command table rendering behind output-owned helpers so no-color and piped output stay ANSI-clean.

  Complete the final TUI sweep by deleting retired marker files, bounding boot and overlay rendering under resize fuzz, memoizing Runs and Overview pane renders, adding deterministic VHS review tape sources, and documenting the current theme/kit/bridge/screen architecture while replacing the stale V1 plan with a superseded pointer.

  Wire the Insights `p` action for insights linked to experiments so it promotes the linked experiment's winning variant through the existing baseline promotion surface, while keeping unavailable save/run/compare actions hidden.

  Replace the Experiments JSON export fallback with CSV export generated from loaded experiment detail metrics, while keeping unavailable compare, re-run, and new-experiment actions hidden.

- 78592f0: Harden Memory namespace handling and capture scheduling: dynamic proposal operations now resolve from input, synchronous tool collection throws clear errors for async namespaces or async block tools, and `memory({ capture: { mode } })` is available with `processing` kept as a deprecated alias.

  Align Memory store adapters with the beta `RecordStore` contract: `@use-crux/core` now exposes a reusable store conformance helper for adapter tests, deprecated private `memory/types` store aliases point to `RecordStore`, and the Upstash adapter supports page-shaped Convex component lists with decoded filtering and hydrated vector search metadata.

  Add the canonical Storage Beta type surface at `@use-crux/core/storage`, including `RecordStore`, `RecordEntry`, `RecordPage`, `RecordWriteOptions`, exact scalar filters, discriminated vector queries, `{ records, vectors, blobs }` bundles, and typed `StorageError` codes.

  Harden the in-memory Storage Beta adapters: record stores now validate JSON and TTL inputs, apply lazy TTL and exact null-aware filters, vector stores validate dense/sparse queries and pre-filter metadata correctly, blob stores expose `head`/delete lifecycle behavior, and `@use-crux/core/storage/testing/vitest` provides reusable record/vector/blob conformance suites.

  Move core workspace, indexing, retrieval, indexed knowledge, embedding cache, and semantic cache consumers onto Storage Beta `records`/`vectors`/`blobs` configuration, with vector-backed search requiring pre-filter-capable vector stores.

  Expose Convex and Upstash Storage Beta adapters: Convex now provides `convexRecordStore`, dense-only `convexVectorStore`, `convexStorage`, and a full-lifecycle workspace blob store; Upstash now provides a SCAN-backed Redis `RecordStore` and a stricter Vector `VectorStore` that validates filters, wraps backend errors, and reports conservative capabilities by default.

  Harden Memory capture and proposal review: adapter-bound memory capture now preserves settled tool results and errors when available, proposal approve/reject/edit operations are pending-only to prevent duplicate writes, and proposal write observations include flattened source metadata.

  Make Memory rendering predictable under token pressure: `budget.maxTokens` is now enforced for memory contexts and individual blocks, and extractive memory blocks support explicit list/recent and semantic render strategies.

  Expose Memory beta behavior in observability and Project Index surfaces: budgeted memory rendering now emits inspectable `memory.read` observations, static memory extraction records capture mode, budgets, render strategies, and retention metadata, and devtools memory details can show indexed episodic retention policy.

  Expose Storage Beta in Project Index facts: static extraction now records record/vector/blob store definitions, storage bundles, scoped storage, storage dependencies on retrievers/workspaces, and matching Rust/Oxc native parity.

  Resolve Storage Beta Project Index facts semantically: TypeScript and native semantic backends now agree on storage aliases, imported stores, config object indirection, bundle composition, scoped storage, and retriever/workspace storage relations.

  Surface Storage Beta in Crux Local and devtools: local Project Index payloads now include privacy-safe storage summaries, component usage, warnings, lint findings, cache replay support, and devtools storage inventory/detail panels.

  Refresh Storage Beta docs and public JSDoc so `RecordStore`, `VectorStore`, `BlobStore`, `{ records, vectors, blobs }` bundles, adapter capability claims, and devtools storage inspection are documented as the primary public storage path.

  Refresh Memory beta docs and public JSDoc so capture modes, render strategies, budgets, strict proposal review, retention metadata, and the `RecordStore` adapter contract are documented from the exported API surface through the user guides.

  Polish Memory beta inspection surfaces: local devtools memory details now expose capture mode, memory and block budgets, block render strategies, write/proposal mode, and retention metadata from the Project Index; run detail memory spans surface render-budget decisions and proposal status; docs include concrete memory observability record examples.

  Keep native indexing in parity for Memory beta metadata: Rust/Oxc static extraction now carries the same capture mode, budget, render strategy, disabled-render, write mode, and retention fields as the TypeScript extractor, with semantic backend parity fixtures covering the beta syntax.

- 3b0fb37: Harden observability emission so invalid optional metrics and JSON-hostile payload values are sanitized before fan-out, with invalid records counted instead of thrown into application code.

  Bound observability delivery queues, count oldest-record drops, and contain synchronous transport throws so devtools or custom transport failures do not escape into application code.

  Retry failed observability deliveries on capped backoff, guard resets against stale in-flight requeues, and add `teeObservabilityTransport()` for composing capture sinks with existing transports.

  Move observability request chunking into the delivery engine, add the transport v2 idempotency/flush/shutdown contract, batch records on a short timer, and skip graph-record construction when no observability sinks are active.

  Split the manual span end API so attributes must be passed through `setAttributes()` or `end({ attributes })`, guard captured `endRun()` calls against duplicate terminal records, and finalize streaming generation spans once with merged completion and stream metrics.

  Specify and test no-AsyncLocalStorage degradation: synchronous `withContext()` scopes still preserve run/span parentage, contextless event/artifact/edge attempts are counted in diagnostics, and observability invariants are property-tested across arbitrary public inputs.

  Harden OTel runtime projection: late child spans stay parented to the run trace, open span registries are bounded with `crux.expired` evictions, duplicate telemetry installs no-op after a warning, and missing TracerProviders fall back to lightweight span tracking.

  Harden observability privacy capture: input/output capture modes now support `inline`, `reference`, and `off`; payload-shaped event and span attributes are stripped when capture is disabled; `redactRecord()` can fail-closed by dropping records; and the OTel mapper drops known payload attributes by default.

  Switch observability trace/span IDs to W3C-compatible lowercase hex, add per-run `seq` ordering to graph records and local raw-record storage, and let lightweight OTel exports reuse Crux span IDs directly.

  Add observability correlators with `propagateAttributes({ sessionId, userId, metadata })`, wire devtools `sessionId` as a default correlator, and let the local run list persist and filter runs by session ID.

  Harden the TypeScript observability contract so schema/type drift, span family mismatches, missing OTel primitive names, and unknown metric keys fail at compile time. Span options now derive `family` from `primitive`, custom metrics must use `custom.*`, and `subscribeObservability()` supports narrowed record-type filters.

  Split observability presentation/read-model types out of the wire contract module into a separately versioned presentation module while preserving root `@use-crux/core/observability` exports, and make imperative devtools cleanup restore by install token instead of a shared runtime slot.

  Move OTel GenAI projection to the pinned `genai-dev-2026-06` semantic convention table: span names now use GenAI operation names, provider/timing/finish-reason attributes use the new keys and value shapes, array attributes pass through, and message content is exported only with explicit `captureMessageContent` opt-in.

  Add shared TS/Go observability conformance fixtures, document schema-version policy, and make the local Go runtime preserve unknown record types and extra fields as raw records for forward compatibility.

  Move local observability run-list counts and token/cost totals to ingest-time SQLite rollups, add the supporting schema migration/indexes, and prepare ingest upsert statements once per batch.

  Tighten observability delivery correctness: diagnostics now expose total delivery failures, HTTP transports no longer re-validate already accepted batches before posting, failed in-flight batches requeue without over-dropping at the queue bound, tee transports forward lifecycle hooks, and hostile user values remain contained.

  Update local observability HTTP ingest semantics to partially accept parseable batches with `{ accepted, rejected }`, reserve `400` for malformed JSON, return retryable `503` on transient storage failures, and bound resource/read-model history queries with batched attachment loading.

  Coalesce streaming generation text into `token.chunk` events, cap stored token chunks per span, exclude them from heavy run-detail reads, add a lazy focused-span events endpoint, and broadcast coalesced live token updates.

  Bound local observability history with activity-based lifecycle reconciliation and retention. Crashed running runs are reconciled once, active streams avoid false stale states while chunks arrive, old/excess runs are deleted in bounded batches, and oversized artifact previews are replaced with truncation markers.

  Make local devtools websocket broadcasts backpressure-safe with per-client send queues, write deadlines, and stalled-client eviction, and lock observability scaling budgets with Go benchmarks.

  Update the devtools runs UI to group by root `sessionId`, render backend-owned token/cost/count rollups from the observability list endpoint, and stream focused-span `token.chunk` text through the lazy span-events endpoint.

  Promote observability to beta graph coverage for Quality: evaluations now emit an `eval.run` umbrella trace, case runs link with `eval.case_of`, promoted comparisons emit `comparison.report` artifacts plus candidate/baseline edges, and cassette replays emit `replay.of` edges to the originally recorded run when cassette metadata is available.

  Ensure Quality `eval.run` umbrella traces end with an error record when post-cell experiment persistence fails.

  Close the final stable-beta blockers: artifact preview capture is now exhaustive over canonical artifact kinds, `observe.run({ traceId })` preserves caller-supplied traces, late OTel records for ended spans attach to the run span with `crux.late_for_span`, invented GenAI rate metrics use `crux.gen.*` names, Convex observability call sites compile against the split span-end API without dropping attributes, and the local runtime protects out-of-order rollups, cursors, retention, lifecycle, and Quality fixture IDs under the expanded verification matrix.

- 8927775: Add workspace versioning & history. Every content change (`write`, `edit`, `append`, `undo`) appends an immutable, append-only version, so destructive edits are recoverable without opting in beforehand.

  New `Workspace` methods: `history(path)` (newest-first revisions), `read(path, { version })` (read an older revision), `diff(path, { from, to })` (git-style unified-diff string plus structured hunks), and `undo(path)` (restore the previous version as a new version — history is never rewritten). Blob-backed content uses version-scoped blob keys so older revisions are never clobbered.

  Retention is unlimited by default; `versioning: { maxVersions }` bounds how many revisions are kept per file and GCs the oldest snapshots and their blobs. The `undoWorkspaceFile` tool is opt-in via `tools: { undo: true }`, like `deleteWorkspaceFile`. `rename`/`move`/`copy` start fresh history at the destination path, and `delete` purges a file's history.

  Each recorded version emits a single privacy-safe observability marker (path hash, version number, and operation only — no paths or content). Local devtools reconstruct a file's version timeline in the inspector's Versions tab from these markers, counting one entry per content change even though an `edit`/`undo` performs a nested write internally.

  `finalize()` now pins the current version as the published artifact (exposed as `WorkspaceArtifact.version`). Editing a finalized file creates new draft versions, but `artifacts()` and the manifest keep surfacing the pinned revision until `finalize()` is called again — the publish-a-snapshot model. `read()` returns the live working copy, while `read(path, { version })` is the general snapshot API for reading any retained revision, including but not limited to the pinned published version.

  Project Index workspace analysis now also surfaces `versioning.maxVersions`, the generated `undoWorkspaceFile` tool posture, and exact `history`/`diff`/`undo` data-access operations across the TypeScript static extractor, Rust/Oxc static frontend, and TypeScript/TSGO semantic backends.

## 0.3.0

### Patch Changes

- 53b04a3: Refresh npm-facing package documentation and homepage metadata so package pages point users to cruxjs.dev and the core package README presents a concise onboarding path.

  Allow `@use-crux/google` consumers to use either `@google/genai` 1.x or 2.x.

  Document the single-turn provider bundle authoring path in adapter package READMEs.

- b7b8c2c: Rename the bundled native worker binary from `crux-indexer-worker` to `crux-static-index-worker` to reflect its Static Syntax / Static Index ownership. The `crux` CLI is unchanged and discovers the renamed sibling binary automatically; the only visible change is the binary filename shipped inside the `@use-crux/local-<os>-<cpu>` platform packages.

## 0.2.0

### Minor Changes

- 96fb6b7: Prepare the first npm release under the `@use-crux` package scope.

  Document the native AST beta parity gate, release checklist, and `experimental.indexer.nativeAst`
  troubleshooting guidance.

  Fix `make local` so the current-platform Rust/Oxc worker binary is replaced atomically when an old
  worker process is still running.
