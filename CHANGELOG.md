# Changelog

Human-friendly release notes for synchronized Crux releases. Package-specific changelogs live next to each package.

## 0.4.0

### Highlights

- Introduce the Retrieval & RAG stable beta public API spine at `@use-crux/core/retrieval`, including `knowledgeBase`, named `retrievalRecipe`, typed retrieval steps, canonical `RetrieveRequest`, schema-derived metadata filters, recipe traces, and grounding/tool integration types.

  Wire `knowledgeBase` lifecycle methods to the existing indexing, corpus, indexed-knowledge, storage, and retriever primitives. Knowledge bases can now index, reindex, remove sources, create namespace-scoped handles, retrieve through store-backed indexes, and inspect lifecycle/storage capability metadata.

  Implement the named single-retriever `retrievalRecipe` runtime. Recipes now execute typed steps, expose `.retrieveWithTrace()` and `.asRetriever()`, capture failed-step traces, run fanout with bounded concurrency, keep score history in structured hit provenance, support recipe-level and per-step models, emit recipe/step observability spans, and replace the old internal pipeline/stage modules.

  Add federated `retrievalRecipe` sources. The built-in retrieve step now accepts multiple retrievers or weighted source entries, runs source/query retrieval concurrently, fuses cross-source hits with structured per-source provenance, supports `fail` and `skip-with-warning` source failure policies, and records per-source retrieve attribution in recipe traces.

  Add session-backed grounding and typed retrieval tool payloads. Grounded citation validation now accounts for both injected and tool-discovered hits without parsing tool strings or closing over mutable hit arrays, retrieval tools return lean structured `crux.retrieval.hits` payloads with model-facing renderers, and `getSource` can read discovered session hits or active store-backed indexed chunks with explicit visibility.

  Add Retrieval/RAG storage conformance coverage and Convex profile mirroring. Core now exposes a vector-store conformance suite that verifies namespace filtering, delete and sparse/hybrid capability claims, and indexed-knowledge hydration diagnostics; hydration misses now fail with `RetrievalRunError("hydration_miss")` instead of silently returning empty results. `@use-crux/convex/retrieval` mirrors the core retrieval API with Convex runtime storage defaults for `knowledgeBase()` and store-backed `retriever()`.

  Add provider-agnostic RAG evaluation metrics to the Quality system. `scorers.rag.*` now includes deterministic recall@k, MRR, expected source coverage, context precision, citation validity, and trace-shape snapshot scorers, and `evaluate()` can run retrieval recipes directly or through `target.recipe()`. New retriever spans emit the beta `retrieval.retrieve` observability primitive.

  Document the stable beta Retrieval/RAG surface around knowledge bases, retrievers, recipes, grounding sessions, typed retrieval tools, and Quality-based RAG evaluation. `knowledgeBase().grounding()`, `knowledgeBase().recipe()`, and `retrievalRecipe().asGrounding()` now delegate to the functional retriever/recipe/grounding runtime paths.

  Add the shared reranking contract and adapter bindings for the beta recipe surface. Core now exports `Reranker` and `judgeReranker()`, `rerank()` accepts custom engines, `@use-crux/ai` binds native AI SDK reranking, and the Anthropic, OpenAI, and Google adapters expose matching `retrievalModel()` and judge-backed `reranker()` factories on their adapter instances. Devtools and Project Index now understand beta retrieval recipe/step primitives while keeping historical pipeline/stage compatibility.

  Promote `reranker()` to an index-visible RAG primitive. Static, semantic, native, and local Project Index paths now emit `rag.reranker` definitions, `rag.recipe.step.uses_reranker` relations from `rerank({ engine })` recipe steps, and a cache epoch migration for the updated static output. The experimental indexer authoring API also exposes ordered object-or-helper config readers so mixed recipe step arrays keep authored order. Devtools renders rerankers as first-class catalog nodes, shows authored recipe steps and step dependencies in the recipe hero, and the built-in `rag.recipe_step_unresolved_target` lint surfaces recipe step dependencies that cannot be resolved to indexed retrievers, scorers, or rerankers.

- Add atomic `RecordStore.create()` support and use it for task creation so concurrent duplicate task IDs fail with `DuplicateTaskIdError`. Record adapters now need to implement the conditional insert primitive; Convex component refs include a matching `insert` mutation.

- Remove the old direct flow executor surface from `@use-crux/core`; `flow()` handles are now the only public flow authoring API.

  Flow input is now inferred from the handler's second parameter. Input-bearing handles expose `run(input, options?)`, no-input handles expose `run(options?)`, and suspended flows resume through `resume(flowId, options?)`.

  Flows can now declare local typed signal maps with `flow(name, { signals }, handler)`. Signal schemas type both `flow.suspend('name')` and `handle.signal(flowId, 'name', payload)`, and `noPayload()` declares notification-only signals.

  Declared signal schemas now validate payloads before `handle.signal()` writes to persistence and again when `flow.suspend()` delivers a stored signal during resume.

  Invalid declared signal payloads now throw `InvalidSignalPayloadError`, allowing callers to distinguish payload contract failures from flow lifecycle control errors.

  Resumed flows now persist terminal lifecycle metadata when they complete, cancel, or expire. Terminal snapshots are retained for inspection and listing, but `completed`, `cancelled`, and `expired` snapshots cannot be resumed again.

  Delivered flow signals are now consumed after validation and replayed from the flow snapshot for earlier suspend points, preventing stale pending signals from satisfying later waits.

  The Project Index now records local flow signal names and emits lint findings for duplicate literal `flow.suspend()` names and literal suspend names missing from a local signal map.

  Flow step labels are now enforced as durable replay identities. Duplicate labels throw at runtime, the Project Index records ordered step label metadata, and linting reports duplicate literal `flow.step()` labels.

  Flow lifecycle control errors thrown inside `flow.step()` now bypass step retry and fallback handling, preserving suspend, cancel, and expire outcomes.

  Persisted flow input, step outputs, signal payloads, and terminal snapshot metadata are now validated as JSON-serializable before flow state is written.

  Convex flow actions now start and resume through the accepted core `run(input)` and `resume(flowId)` handle APIs. Convex flows can also declare local signal maps, and `.signal()` validates declared payload schemas before writing a pending signal or scheduling the resume action.

  Refresh OTel package README wording to describe `flow().run()` spans.

- Harden Memory namespace handling and capture scheduling: dynamic proposal operations now resolve from input, synchronous tool collection throws clear errors for async namespaces or async block tools, and `memory({ capture: { mode } })` is available with `processing` kept as a deprecated alias.

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

- Add the `@use-crux/core/runtime` subpath with Runtime Engine port contracts, typed runtime diagnostics, wake envelope validation, retry helpers, the pure work state-machine surface, kernel composite operations, outbox dispatch, the in-memory runtime store, and the `@use-crux/core/runtime/testing` conformance suites for adapter authors.

  Add the first Runtime Engine composer surface: `node()` for in-process local/test execution, `createRuntime()` for resolving composers with targets, store-backed timers and maintenance, cancellation, scoped-idle counters, and the standard `RUNTIME_REQUIRED` diagnostic factory.

  Wire existing flow handles into the Runtime Engine: runtime-backed `flow.suspend()` snapshots, reserved signal events with automatic resume from `FlowHandle.signal()`, `{ resume: false }` plus runtime-backed `FlowHandle.resume(flowId)`, replay fingerprint drift blocking, and delivery recording for multiple waiter events that arrive before replay.

  Add the flow runtime API layer: runtime-only executable `task()` targets from `@use-crux/core/runtime`, `flow.waitFor()`, barrier-buffered `flow.defer()` and `flow.after()` durable effects, scoped `flow.untilIdle()`, and name-bound `crux.flows.signal/resume/cancel`.

  Add `@use-crux/postgres/runtime` with a durable Postgres Runtime Engine store adapter, additive setup check/apply support for the Crux-owned schema, and real-Postgres conformance coverage gated by `CRUX_TEST_DATABASE_URL`.

  Add the HTTP wake layer for serverless Runtime Engine deployments: `createRuntimeHandler({ targets })`, `serverless({ store, wake })`, `genericQueue()`, and `@use-crux/upstash/runtime` `qstash()` wake delivery with QStash signature verification.

  Add host-bound Runtime Engine declarations and Convex runtime entry helpers: `RuntimeEngineDefinition` now distinguishes in-process and host-bound runtimes, `bindHostRuntime()` composes host bindings through the shared kernel path, `RUNTIME_HOST_ONLY` reports runtime use outside a required host, and `@use-crux/convex/runtime` exposes `convex()` plus `createConvexRuntimeHandlers()`.

  Add Runtime Engine artifact generation: the indexer can discover runtime flow/task targets, emit deterministic `.crux/generated/runtime/manifest.json` plus readable Next and Convex entry files, expose drift preflight helpers, and `withCrux()` can regenerate artifacts during Next builds.

  Add Runtime Engine operator tooling: `crux runtime setup`, `status`, `inspect`, `retry`, and `cancel` now route through the local worker, use typed runtime diagnostics, support JSON output, and preflight generated artifacts against durable runtime state.

  Harden Runtime Engine delivery and adapter parity: scheduled wake rows now honor `notBefore`/retry delays end-to-end, runtime-backed flows preserve object-bound replay semantics for errors, cancellation, resume options, and repeated suspend labels, Convex handler/component boundaries validate and encode runtime payloads consistently, and cross-adapter conformance now covers retry source-status guards, waiter matching, and idle-counter invariants.

  Tighten runtime artifact and handler DX: generated entry files are host-specific and marker-protected, target exports are validated before manifest generation, `withCrux()` runs during Next config evaluation for Webpack and Turbopack, unresolved name-only handler targets now fail with `TARGET_NOT_FOUND`, and malformed wake envelopes return terminal client responses instead of queue poison loops.

  Add Project Index runtime lint rules for durable target identity, exported targets, runtime API use without configured runtime support, closure-based defers, nondeterministic flow bodies, and non-serializable deferred payloads, with docs metadata and native lint parity.

  Expose bounded Runtime Engine inspection reads for work, timers, and outbox state so local tooling can show runtime status details without mutating durable state.

  Move the Postgres adapter's `pg` client to a caller-controlled peer dependency while retaining it as a repo dev dependency for tests, and refresh the package homepage to a live source URL.

  Add the Runtime Engine documentation set: core runtime reference, runtime deployment guides, recipe-only adapter mappings, package references for Postgres/QStash/Convex runtime surfaces, runtime lint navigation, and per-code Runtime Engine error pages.

  Fix final Runtime Engine hardening gaps: wake delivery now rechecks leased work before execution, null waiter payloads replay correctly, manual resume/retry keys are unique per invocation, runtime status counts use adapter-owned counting instead of silently truncated list samples, Postgres setup checks validate required columns, Convex component status queries avoid unindexed full-table scans, runtime artifact host detection no longer guesses from raw config text, and `runtime.missing_runtime_config` now runs in production Project Index lint paths without claiming native parity.

  Close follow-up Runtime Engine review gaps: Project Index snapshots now cache runtime-config presence for linting, destructured flow-scope runtime APIs retain TypeScript/Rust parity, manual resume/retry keys include an isolate nonce, delayed wake rows dedupe duplicate `notBefore` reschedules, Convex status counts stay under a bounded read budget, Convex outbox confirmation retains rows like other adapters, and Postgres setup column checks are covered by DDL parity tests.

  Finish the review-tail hardening: outbox duplicate suppression no longer hides legitimate re-enqueues while a row is being dispatched, maintenance re-enqueues orphaned pending work, config-load failures no longer produce false missing-runtime lint findings, status count truncation is surfaced in CLI and devtools, and runtime artifact preflight now uses the worker-owned stale-target result instead of duplicating status rules in the CLI.

  Complete native Project Index parity for runtime task targets and missing-runtime linting so the Rust/Oxc production path matches the TypeScript baseline.

  Fix npm release staging so exported package subpaths, including `@use-crux/core/runtime`, are typechecked through their declared public entry files.

  Make the public Runtime Engine barrels isolate-safe for Convex and edge-style bundlers by moving custom wake HMAC signing/verification to WebCrypto, run the Convex runtime store through the shared adapter conformance suite with declared substrate-atomic exclusions, and keep caller-provided Convex event IDs from colliding with internal event cursors.

  Improve Convex runtime generation DX: `crux dev` now refreshes runtime artifacts on startup and watched source changes, generated writes are idempotent, Convex no longer emits a top-level `convex/crux.ts` shim, generated target imports run behind a Node action boundary via `@use-crux/convex/runtime/node`, and Convex-native `flow()` handles can execute as generated Runtime Engine targets.

  Fix Convex direct flow starts under `createCruxConvex().run()`: core runtime-backed flow APIs now resolve host-bound declarations through an active request-scoped host binding, and the Convex profile bridge installs that binding before user code starts runtime-backed work.

- Harden observability emission so invalid optional metrics and JSON-hostile payload values are sanitized before fan-out, with invalid records counted instead of thrown into application code.

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

- Add the public observability `TurnDecisionReport` type contract for per-turn explanation read models, including separate freshness and cache evidence, stable decision reason codes, source joins, coverage rows, and missing-evidence diagnostics.

  Expose `decisionReport` on Crux Local Run Detail generation nodes and details, projecting request composition, runtime decisions, source joins, coverage rows, and missing-evidence gaps from existing observability evidence. The public `CruxRunDetailNode` and `CruxRunDetailDetail` types now declare the optional `decisionReport` field so consumers can read the projection without re-deriving it.

  Project recorded freshness evidence into Run Detail `decisionReport` rows, including cache outcomes accepted or rejected by freshness while keeping cache and freshness as separate evidence concepts.

  Add Quality `ctx.expect.decisionReport` matchers for protecting context dispositions, routing/fallback outcomes, freshness status, and cache acceptance using stable `TurnDecisionReport` reason codes.

  Harden Run Detail turn explanations so empty `decisionReport` collections encode as `[]` in Crux Local and Devtools tolerates older partial reports that used `null` for empty collections.

  Polish the `TurnDecisionReport` V1 contract before freeze: rename `turn.verdict` to `turn.readout` (a deterministic evidence-bound sentence, not a pass/fail judgment), rename the top-level `summary` chip list to `chips` (type `TurnDecisionChip`, was `TurnSummaryChip`), and replace `TurnCoverageArea.area` with stable `id` + display `label` fields while renaming `suggest`/`cmd` to `suggestion`/`command`. These are breaking renames to the pre-release public contract; `@use-crux/local` and Devtools are updated to match.

  Document the `TurnDecisionReport` V1 freeze policy in the observability reference, including additive `schemaVersion: 1` compatibility, matcher-stable reason codes and coverage ids, display-only human text, explicit unknown/missing/unresolved states, cache/freshness separation, and the rule that Run Insight is UI-derived from per-turn reports rather than a separate run-level `decisionReport`.

  Add docs for debugging a bad model turn with Explain and for protecting setup behavior with `ctx.expect.decisionReport` Quality assertions.

- Fix workspace blob text/JSON read-back, byte-windowed text reads, globstar listings, bounded manifests, list limit pushdown, and privacy-safe workspace path hashes in OTel attributes.

  Add per-call workspace namespace overrides for direct methods and manually created tools, tighten generated workspace tool map types, and allow write tools to accept JSON arrays and scalar JSON values.

  Add filesystem-style workspace operations for `exists`, `stat`, `append`, `rename`/`move`, `copy`, and `grep`, plus default generated `renameWorkspaceFile` and `grepWorkspace` tools.

  Add the workspace artifacts facet with draft/final status, artifact kind metadata, finalization, artifact queries, download references, provenance capture, and manifest deliverables.

  Add workspace retention and quota controls with TTL passthrough for supporting stores plus `maxFileBytes` and `maxNamespaceBytes` write-time guards, and document the complete V0 workspace surface.

  Expose V0 workspace activity in local devtools, OTel, and Project Index: workspace OTel spans now use workspace-specific operation/path-hash attributes, devtools preserve privacy-safe path-hash labels and artifact metadata, and Project Index facts include workspace operator config, generated tool posture, and exact V0 workspace data-access operations.

  Harden V0 workspace filesystem and artifact edge cases: filesystem mutations now share write-limit and retention enforcement, `move` is distinct from `rename` in operation metadata, glob/list/grep reads respect mount access, and artifact observability avoids raw workspace paths.

  Add source-backed workspace mounts for virtual provider roots. `read`, `list`, `grep`, `exists`, and `stat` can now delegate to custom or retriever mount sources, retrievers can also be adapted with `retrieverWorkspaceMountSource()`, prompt context includes can read virtual files without copying bytes into the workspace store, local copies can materialize readable virtual text/JSON files, unscoped grep searches source-backed mounts, and custom source mounts can opt into provider-backed `write`/`edit`/`append`, provider-destination `copy`, and `delete` hooks when mounted with `access: "readwrite"`.

  Tighten source-backed mount correctness: copied string JSON now stays JSON, missing or truncated source reads fail instead of silently materializing partial local copies, provider write read-backs tolerate eventual consistency, fallback grep uses bounded source listings, retriever-backed limits apply after filtering, regex grep rejects risky patterns, and workspace JSON value guards now reject non-finite, cyclic, and non-plain values.

  Expose source-backed mount shape in Project Index and devtools: static/native and semantic/native analysis now preserve custom, retriever, helper, and capability metadata for workspace mounts, and local devtools show authored source-backed mounts even before runtime workspace events occur.

  Add `Workspace.transaction()` for staging multi-file workspace changes and committing touched paths together over the generic `RecordStore` contract, with README and docs coverage. Transaction callbacks get a restricted workspace surface with staged read-your-own-writes behavior; callback failures discard staged changes, observed commit failures roll back touched live paths, and source-backed mount mutations fail before provider hooks run.

  Expose `Workspace.transaction()` in Project Index data-access facts and workspace observability so source intelligence, semantic parity checks, and devtools activity can treat transaction calls as workspace writes.

  Add `StaticObjectReader.callName()` so Indexer Extensions can distinguish direct helper calls from identifier-backed references in object config metadata.

- Add workspace versioning & history. Every content change (`write`, `edit`, `append`, `undo`) appends an immutable, append-only version, so destructive edits are recoverable without opting in beforehand.

  New `Workspace` methods: `history(path)` (newest-first revisions), `read(path, { version })` (read an older revision), `diff(path, { from, to })` (git-style unified-diff string plus structured hunks), and `undo(path)` (restore the previous version as a new version — history is never rewritten). Blob-backed content uses version-scoped blob keys so older revisions are never clobbered.

  Retention is unlimited by default; `versioning: { maxVersions }` bounds how many revisions are kept per file and GCs the oldest snapshots and their blobs. The `undoWorkspaceFile` tool is opt-in via `tools: { undo: true }`, like `deleteWorkspaceFile`. `rename`/`move`/`copy` start fresh history at the destination path, and `delete` purges a file's history.

  Each recorded version emits a single privacy-safe observability marker (path hash, version number, and operation only — no paths or content). Local devtools reconstruct a file's version timeline in the inspector's Versions tab from these markers, counting one entry per content change even though an `edit`/`undo` performs a nested write internally.

  `finalize()` now pins the current version as the published artifact (exposed as `WorkspaceArtifact.version`). Editing a finalized file creates new draft versions, but `artifacts()` and the manifest keep surfacing the pinned revision until `finalize()` is called again — the publish-a-snapshot model. `read()` returns the live working copy, while `read(path, { version })` is the general snapshot API for reading any retained revision, including but not limited to the pinned published version.

  Project Index workspace analysis now also surfaces `versioning.maxVersions`, the generated `undoWorkspaceFile` tool posture, and exact `history`/`diff`/`undo` data-access operations across the TypeScript static extractor, Rust/Oxc static frontend, and TypeScript/TSGO semantic backends.

### Fixes

- Centralize indexed chunk and parent record persistence, active-generation filtering, vector-hit hydration, and parent expansion behind an internal indexed knowledge read-model boundary.

- Replace the broad Quality internal runner barrel with a narrow collect/run/promote facade for first-party tooling.

- Refined the internal `config()` runtime lifecycle so config-owned runtime state, observability, plugins, devtools fallback, bridge setup, and teardown are applied through a tested transaction boundary.

- Harden Memory namespace handling and capture scheduling: dynamic proposal operations now resolve from input, synchronous tool collection throws clear errors for async namespaces or async block tools, and `memory({ capture: { mode } })` is available with `processing` kept as a deprecated alias.

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

- Introduce the Retrieval & RAG stable beta public API spine at `@use-crux/core/retrieval`, including `knowledgeBase`, named `retrievalRecipe`, typed retrieval steps, canonical `RetrieveRequest`, schema-derived metadata filters, recipe traces, and grounding/tool integration types.

  Wire `knowledgeBase` lifecycle methods to the existing indexing, corpus, indexed-knowledge, storage, and retriever primitives. Knowledge bases can now index, reindex, remove sources, create namespace-scoped handles, retrieve through store-backed indexes, and inspect lifecycle/storage capability metadata.

  Implement the named single-retriever `retrievalRecipe` runtime. Recipes now execute typed steps, expose `.retrieveWithTrace()` and `.asRetriever()`, capture failed-step traces, run fanout with bounded concurrency, keep score history in structured hit provenance, support recipe-level and per-step models, emit recipe/step observability spans, and replace the old internal pipeline/stage modules.

  Add federated `retrievalRecipe` sources. The built-in retrieve step now accepts multiple retrievers or weighted source entries, runs source/query retrieval concurrently, fuses cross-source hits with structured per-source provenance, supports `fail` and `skip-with-warning` source failure policies, and records per-source retrieve attribution in recipe traces.

  Add session-backed grounding and typed retrieval tool payloads. Grounded citation validation now accounts for both injected and tool-discovered hits without parsing tool strings or closing over mutable hit arrays, retrieval tools return lean structured `crux.retrieval.hits` payloads with model-facing renderers, and `getSource` can read discovered session hits or active store-backed indexed chunks with explicit visibility.

  Add Retrieval/RAG storage conformance coverage and Convex profile mirroring. Core now exposes a vector-store conformance suite that verifies namespace filtering, delete and sparse/hybrid capability claims, and indexed-knowledge hydration diagnostics; hydration misses now fail with `RetrievalRunError("hydration_miss")` instead of silently returning empty results. `@use-crux/convex/retrieval` mirrors the core retrieval API with Convex runtime storage defaults for `knowledgeBase()` and store-backed `retriever()`.

  Add provider-agnostic RAG evaluation metrics to the Quality system. `scorers.rag.*` now includes deterministic recall@k, MRR, expected source coverage, context precision, citation validity, and trace-shape snapshot scorers, and `evaluate()` can run retrieval recipes directly or through `target.recipe()`. New retriever spans emit the beta `retrieval.retrieve` observability primitive.

  Document the stable beta Retrieval/RAG surface around knowledge bases, retrievers, recipes, grounding sessions, typed retrieval tools, and Quality-based RAG evaluation. `knowledgeBase().grounding()`, `knowledgeBase().recipe()`, and `retrievalRecipe().asGrounding()` now delegate to the functional retriever/recipe/grounding runtime paths.

  Add the shared reranking contract and adapter bindings for the beta recipe surface. Core now exports `Reranker` and `judgeReranker()`, `rerank()` accepts custom engines, `@use-crux/ai` binds native AI SDK reranking, and the Anthropic, OpenAI, and Google adapters expose matching `retrievalModel()` and judge-backed `reranker()` factories on their adapter instances. Devtools and Project Index now understand beta retrieval recipe/step primitives while keeping historical pipeline/stage compatibility.

  Promote `reranker()` to an index-visible RAG primitive. Static, semantic, native, and local Project Index paths now emit `rag.reranker` definitions, `rag.recipe.step.uses_reranker` relations from `rerank({ engine })` recipe steps, and a cache epoch migration for the updated static output. The experimental indexer authoring API also exposes ordered object-or-helper config readers so mixed recipe step arrays keep authored order. Devtools renders rerankers as first-class catalog nodes, shows authored recipe steps and step dependencies in the recipe hero, and the built-in `rag.recipe_step_unresolved_target` lint surfaces recipe step dependencies that cannot be resolved to indexed retrievers, scorers, or rerankers.

- Fix workspace blob text/JSON read-back, byte-windowed text reads, globstar listings, bounded manifests, list limit pushdown, and privacy-safe workspace path hashes in OTel attributes.

  Add per-call workspace namespace overrides for direct methods and manually created tools, tighten generated workspace tool map types, and allow write tools to accept JSON arrays and scalar JSON values.

  Add filesystem-style workspace operations for `exists`, `stat`, `append`, `rename`/`move`, `copy`, and `grep`, plus default generated `renameWorkspaceFile` and `grepWorkspace` tools.

  Add the workspace artifacts facet with draft/final status, artifact kind metadata, finalization, artifact queries, download references, provenance capture, and manifest deliverables.

  Add workspace retention and quota controls with TTL passthrough for supporting stores plus `maxFileBytes` and `maxNamespaceBytes` write-time guards, and document the complete V0 workspace surface.

  Expose V0 workspace activity in local devtools, OTel, and Project Index: workspace OTel spans now use workspace-specific operation/path-hash attributes, devtools preserve privacy-safe path-hash labels and artifact metadata, and Project Index facts include workspace operator config, generated tool posture, and exact V0 workspace data-access operations.

  Harden V0 workspace filesystem and artifact edge cases: filesystem mutations now share write-limit and retention enforcement, `move` is distinct from `rename` in operation metadata, glob/list/grep reads respect mount access, and artifact observability avoids raw workspace paths.

  Add source-backed workspace mounts for virtual provider roots. `read`, `list`, `grep`, `exists`, and `stat` can now delegate to custom or retriever mount sources, retrievers can also be adapted with `retrieverWorkspaceMountSource()`, prompt context includes can read virtual files without copying bytes into the workspace store, local copies can materialize readable virtual text/JSON files, unscoped grep searches source-backed mounts, and custom source mounts can opt into provider-backed `write`/`edit`/`append`, provider-destination `copy`, and `delete` hooks when mounted with `access: "readwrite"`.

  Tighten source-backed mount correctness: copied string JSON now stays JSON, missing or truncated source reads fail instead of silently materializing partial local copies, provider write read-backs tolerate eventual consistency, fallback grep uses bounded source listings, retriever-backed limits apply after filtering, regex grep rejects risky patterns, and workspace JSON value guards now reject non-finite, cyclic, and non-plain values.

  Expose source-backed mount shape in Project Index and devtools: static/native and semantic/native analysis now preserve custom, retriever, helper, and capability metadata for workspace mounts, and local devtools show authored source-backed mounts even before runtime workspace events occur.

  Add `Workspace.transaction()` for staging multi-file workspace changes and committing touched paths together over the generic `RecordStore` contract, with README and docs coverage. Transaction callbacks get a restricted workspace surface with staged read-your-own-writes behavior; callback failures discard staged changes, observed commit failures roll back touched live paths, and source-backed mount mutations fail before provider hooks run.

  Expose `Workspace.transaction()` in Project Index data-access facts and workspace observability so source intelligence, semantic parity checks, and devtools activity can treat transaction calls as workspace writes.

  Add `StaticObjectReader.callName()` so Indexer Extensions can distinguish direct helper calls from identifier-backed references in object config metadata.

- Add workspace versioning & history. Every content change (`write`, `edit`, `append`, `undo`) appends an immutable, append-only version, so destructive edits are recoverable without opting in beforehand.

  New `Workspace` methods: `history(path)` (newest-first revisions), `read(path, { version })` (read an older revision), `diff(path, { from, to })` (git-style unified-diff string plus structured hunks), and `undo(path)` (restore the previous version as a new version — history is never rewritten). Blob-backed content uses version-scoped blob keys so older revisions are never clobbered.

  Retention is unlimited by default; `versioning: { maxVersions }` bounds how many revisions are kept per file and GCs the oldest snapshots and their blobs. The `undoWorkspaceFile` tool is opt-in via `tools: { undo: true }`, like `deleteWorkspaceFile`. `rename`/`move`/`copy` start fresh history at the destination path, and `delete` purges a file's history.

  Each recorded version emits a single privacy-safe observability marker (path hash, version number, and operation only — no paths or content). Local devtools reconstruct a file's version timeline in the inspector's Versions tab from these markers, counting one entry per content change even though an `edit`/`undo` performs a nested write internally.

  `finalize()` now pins the current version as the published artifact (exposed as `WorkspaceArtifact.version`). Editing a finalized file creates new draft versions, but `artifacts()` and the manifest keep surfacing the pinned revision until `finalize()` is called again — the publish-a-snapshot model. `read()` returns the live working copy, while `read(path, { version })` is the general snapshot API for reading any retained revision, including but not limited to the pinned published version.

  Project Index workspace analysis now also surfaces `versioning.maxVersions`, the generated `undoWorkspaceFile` tool posture, and exact `history`/`diff`/`undo` data-access operations across the TypeScript static extractor, Rust/Oxc static frontend, and TypeScript/TSGO semantic backends.

- Migrate the local TUI to the Bubble Tea/Lip Gloss/Bubbles v2 stack, centralize terminal colors in the shared theme palette, add deterministic TUI golden/resize test harness coverage, and introduce the rect-based TUI kit layout, virtualized list/table, memo, and component primitives used by the rebuilt shell and legacy screen adapters.

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

- Harden observability emission so invalid optional metrics and JSON-hostile payload values are sanitized before fan-out, with invalid records counted instead of thrown into application code.

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

- Remove the old direct flow executor surface from `@use-crux/core`; `flow()` handles are now the only public flow authoring API.

  Flow input is now inferred from the handler's second parameter. Input-bearing handles expose `run(input, options?)`, no-input handles expose `run(options?)`, and suspended flows resume through `resume(flowId, options?)`.

  Flows can now declare local typed signal maps with `flow(name, { signals }, handler)`. Signal schemas type both `flow.suspend('name')` and `handle.signal(flowId, 'name', payload)`, and `noPayload()` declares notification-only signals.

  Declared signal schemas now validate payloads before `handle.signal()` writes to persistence and again when `flow.suspend()` delivers a stored signal during resume.

  Invalid declared signal payloads now throw `InvalidSignalPayloadError`, allowing callers to distinguish payload contract failures from flow lifecycle control errors.

  Resumed flows now persist terminal lifecycle metadata when they complete, cancel, or expire. Terminal snapshots are retained for inspection and listing, but `completed`, `cancelled`, and `expired` snapshots cannot be resumed again.

  Delivered flow signals are now consumed after validation and replayed from the flow snapshot for earlier suspend points, preventing stale pending signals from satisfying later waits.

  The Project Index now records local flow signal names and emits lint findings for duplicate literal `flow.suspend()` names and literal suspend names missing from a local signal map.

  Flow step labels are now enforced as durable replay identities. Duplicate labels throw at runtime, the Project Index records ordered step label metadata, and linting reports duplicate literal `flow.step()` labels.

  Flow lifecycle control errors thrown inside `flow.step()` now bypass step retry and fallback handling, preserving suspend, cancel, and expire outcomes.

  Persisted flow input, step outputs, signal payloads, and terminal snapshot metadata are now validated as JSON-serializable before flow state is written.

  Convex flow actions now start and resume through the accepted core `run(input)` and `resume(flowId)` handle APIs. Convex flows can also declare local signal maps, and `.signal()` validates declared payload schemas before writing a pending signal or scheduling the resume action.

  Refresh OTel package README wording to describe `flow().run()` spans.

## 0.3.0

### Highlights

- Deepen the loop-owned execution boundary into a single gateway-closed `LoopRuntimePort`, replacing the per-call `client` threading of the old `ExecutorSpec`/`SdkLoopDialect` seam.

  `@use-crux/core`:
  - Replace `ExecutorSpec` with `LoopRuntimePort` (`id`, `describeModel`, `mapSettings`, `runTextLoop`, `runStructuredAttempt`, `runStream`, `replayStream`). The port is already bound to its SDK client, so each run method takes only an `ExecutorRequest` — there is no per-call `client` argument.
  - `bind()` now returns the client-dependent `BoundLoopRuntime` (renamed from `BoundLoopOwnedRuntime`), which core assembles with `id`/`describeModel`/`mapSettings` into the port.
  - Rename `executorAdapter(spec)(client)` to `loopRuntimeAdapter(port)`.
  - Testing: `fakeExecutor` → `fakeLoopRuntime` (returns `{ runtime, calls }`); `executorSpecConformance` → `loopRuntimePortConformance` (harness `prepare()` returns `{ runtime, model }`).

  `@use-crux/ai`:
  - Add `createAiSdkLoopRuntime(gateway): LoopRuntimePort<LanguageModel>` and the `AiSdkLoopRuntime` type — the adapter from `SdkGateway` to the core port. `aiSdkProviderRuntime` and `createCruxAi({ gateway })` are unchanged.

  `defineProviderRuntime({ ownership: 'loop-owned', loop })` authoring is unchanged except that `loop.bind()` now returns `runTextLoop`/`runStructuredAttempt`/`runStream` (was `run`/`attemptStructured`/`stream`).

- Complete the profile-backed `convexAgent()` lifecycle around the Convex Agent method surface.
  - Align thread continuation with Convex Agent: call `continueThread(ctx, target)` first, then pass Crux prompt `input` to `thread.generateText()`, `thread.streamText()`, `thread.generateObject()`, or `thread.streamObject()`.
  - Add profile-backed `generateObject()` and `streamObject()` support, injecting resolved Crux prompt state and prompt output schemas through the same lifecycle/driver boundary as text generation.
  - Derive public generation args/options/results from upstream Convex Agent method types while omitting Crux-owned `system`, `prompt`, `messages`, and `tools`.
  - Add the `crux` config namespace for Crux-owned lifecycle controls: `crux.prepare`, `crux.runtime.store`, `crux.runtime.namespace`, `crux.observe`, `crux.persistence`, and advanced `crux.driver`. Existing top-level `prepare`, `store`, and `namespace` remain as deprecated compatibility aliases.
  - Move Crux-only prompt resolution to `agent.crux.resolve()` with direct `agent.resolve()` kept as a deprecated compatibility alias.
  - Deepen the Convex store document contract with a substitutable `ComponentDocumentPort`, normalized `ConvexStoreDocumentComponent`, and `createInMemoryConvexStoreDocumentComponent()` for server/React boundary tests.

- Add the public observability event spine APIs: `subscribeObservability()` for in-process graph-record subscribers and `CRUX_OBSERVABILITY_CHANNEL` / `CruxObservabilityChannelMessage` for Node diagnostics-channel consumers.

  Remove the legacy runtime instrumentation hook bus. `withTelemetry()` now subscribes to the canonical graph-record stream by default, and `createOtelRecordSubscriber()` remains available for custom OTel wiring.

  Migrate AI agent, Convex swarm/compaction, and ingest parser instrumentation to canonical graph records so they continue emitting observability after the hook bus removal. `TelemetryOptions.recordContent` is removed; use the core `observability.recordInputs` / `recordOutputs` policy instead.

  Add observability capture policy controls: `config({ observability: { recordInputs, recordOutputs } })`. Disabled input/output artifacts are emitted as reference records with size/hash metadata and no preview.

  Generation and streaming span-end records now carry `gen.*` performance metrics, and `@use-crux/otel` maps them to exported `gen_ai.client.*` attribute constants.

  Restore the documented default `withTelemetry()` behavior: when no lightweight exporter is configured, `@use-crux/otel` now uses the globally registered OpenTelemetry tracer instead of silently dropping spans.

- Deepen the core prompt-resolution pipeline behind one private pass primitive and complete the resolver-port seam.
  - Introduce `createPromptResolverPlan(config, ports)` — the single private pass primitive. `compilePrompt()` is now a thin boundary that validates the config, binds ports, and projects `resolve()` / `inspect()` over the plan's one `run(opts, mode)` call, so the two projections can never drift across ordering, gating, skills, budget, settings, or inspection.
  - Add a `TokenizerPort` (`{ count(text) }`): every token count the pipeline reports (system parts, prompt text, dropped contexts) now flows through it, so a deterministic counter pins token-budget behavior without depending on the production chars/4 estimate.
  - Broaden the `skills` port to own registry fetch **plus** skill-index generation and activation-session creation — the resolution pass no longer imports the skill module directly.
  - Add `createResolverFakes()`: a one-call bundle of deterministic in-memory ports (observability, skills, cache, clock, tokenizer, policy, diagnostics, instrumentation), each also exposed as a named handle for assertions. New `staticTokenizer()` fake.
  - `compilePrompt()` now returns a `PromptResolutionPipeline`; `CompiledPrompt` remains as a deprecated alias. New public exports: `PromptResolutionPipeline`, `TokenizerPort`, `staticTokenizer`, `createResolverFakes`, `ResolverFakes`, `ResolverFakesOptions`.
  - Internal-only refactor of the resolution internals (split port contracts in `resolver/ports.ts` from their production adapters in `resolver/default-ports.ts`). No change to the `prompt().resolve()` / `prompt().inspect()` runtime behavior or to resolved prompt args.

- Add `defineSingleTurnProviderBundle()` for provider packages that compile single-turn SDK wire hooks into the standard Crux provider runtime and helper factories.

- Stabilize Plan & Tasks task-list state handling: duplicate IDs, removed tasks, discarded lists, terminal transitions, pending/cancelled status derivation, and stale counter repair now resolve through typed lifecycle errors and row-derived state.

  Cut over the experimental Plans & Tasks API to the canonical `plan()`, `tasks()`, and `task()` surface. Plan and task handles are command handles with `get()`/`list()` reads, existing entities are bound with `plan.ref()` and `tasks.ref()`, creation tools live at `plan.tool()` and `tasks.tool()` with safe `created()` accessors, and the old `tasklist`, top-level agent/tool factories, and first-match task-list lookup exports are removed from public entrypoints.

  Add typed task definitions for `tasks({ items })`: keyed `task()` specs now infer literal task IDs for reads, lifecycle methods, and workers, infer schema-backed `complete()` result payloads, validate completed results at runtime, and reject non-JSON plan/task metadata, list metadata filters, and task results before persistence.

  Tighten the final beta contract with root-level task lifecycle error exports, schema-input completion typing for transforming result schemas, JSON guard coverage for dropped object properties, and consistent plan-list metadata filtering.

  Align React and devtools with the canonical beta surface: React hooks now expose `usePlan()` and `useTasks()` with ID-or-handle inputs and no public `useTaskList()` alias, while local/devtools plan details project canonical task activity with core task statuses and separate progress messages.

  Rewrite the public Plans & Tasks docs around the final beta API, including `plan()`, `tasks()`, `task()`, handle methods, dynamic vs defined ledgers, status derivation, lifecycle errors, React hooks, and guidance on when to use `flow()` or an external durable runner.

- Deepen Google CachedContent into a single `GoogleCachedContentLifecycle`. `createGoogle({ cachedContent })` now resolves one lifecycle that owns prefix detection, cache keying/reuse, SDK cache operations, and fallback policy, returning a request-ready config patch that both `generate()` and `stream()` merge.
  - Configure the built-in lifecycle with `GoogleCacheConfig` (`defaultTtlSeconds`, `maxEntries`, `onError: 'fallback' | 'throw'`, or a custom `GoogleCachedContentCachePort`), pass `false` to disable, or pass a fully custom `GoogleCachedContentLifecycle`.
  - Invalid TTL/config values are rejected (per-call TTL overrides fall back to the default; bad `defaultTtlSeconds`/`maxEntries` throw a clear error).
  - New exports: `GoogleCacheConfig`, `GoogleCacheName`, `GoogleCachedContentCachePort`, `GoogleCachedContentErrorMode`, `GoogleCachedContentLifecycle`, `GoogleCachedContentOption`, `GoogleCachedContentPlan`, `GoogleCachedContentPrepareArgs`.

### Fixes

- Refresh npm-facing package documentation and homepage metadata so package pages point users to cruxjs.dev and the core package README presents a concise onboarding path.

  Allow `@use-crux/google` consumers to use either `@google/genai` 1.x or 2.x.

  Document the single-turn provider bundle authoring path in adapter package READMEs.

- Add the public observability event spine APIs: `subscribeObservability()` for in-process graph-record subscribers and `CRUX_OBSERVABILITY_CHANNEL` / `CruxObservabilityChannelMessage` for Node diagnostics-channel consumers.

  Remove the legacy runtime instrumentation hook bus. `withTelemetry()` now subscribes to the canonical graph-record stream by default, and `createOtelRecordSubscriber()` remains available for custom OTel wiring.

  Migrate AI agent, Convex swarm/compaction, and ingest parser instrumentation to canonical graph records so they continue emitting observability after the hook bus removal. `TelemetryOptions.recordContent` is removed; use the core `observability.recordInputs` / `recordOutputs` policy instead.

  Add observability capture policy controls: `config({ observability: { recordInputs, recordOutputs } })`. Disabled input/output artifacts are emitted as reference records with size/hash metadata and no preview.

  Generation and streaming span-end records now carry `gen.*` performance metrics, and `@use-crux/otel` maps them to exported `gen_ai.client.*` attribute constants.

  Restore the documented default `withTelemetry()` behavior: when no lightweight exporter is configured, `@use-crux/otel` now uses the globally registered OpenTelemetry tracer instead of silently dropping spans.

- Reorganize `@use-crux/core` into package-root domain folders (`prompt/`, `resolver/`, `runtime/`, `generation/`, `tools/`, `shared/`) and split the largest single-file domains into curated barrels plus focused implementation files. The root `types.ts` mega file was drained into the owning domains and reduced to the dependency-free base contracts (`AnyModel`/`AnyToolSet`/`AnyMessage`, `FlowToolDef`, `ModelInfo`).

  This is an internal restructuring only: the public `@use-crux/core` API, every package subpath (including `./tools` and `./tool-middleware`), and `package.json` exports/`typesVersions` are unchanged. No import paths change for consumers.

  Deepen agent composition internals behind a shared composition runtime that owns composition ids, canonical composition spans, child execution contexts, retry wrapping, and report artifacts for `parallel`, `pipeline`, `consensus`, and `swarm`. Public composition factories are unchanged; consensus observability now reports voter agent spans directly under the consensus composition instead of adding a nested parallel composition span.

- Rename the bundled native worker binary from `crux-indexer-worker` to `crux-static-index-worker` to reflect its Static Syntax / Static Index ownership. The `crux` CLI is unchanged and discovers the renamed sibling binary automatically; the only visible change is the binary filename shipped inside the `@use-crux/local-<os>-<cpu>` platform packages.

## 0.2.0

### Highlights

- Prepare the first npm release under the `@use-crux` package scope.

  Document the native AST beta parity gate, release checklist, and `experimental.indexer.nativeAst`
  troubleshooting guidance.

  Fix `make local` so the current-platform Rust/Oxc worker binary is replaced atomically when an old
  worker process is still running.
