# @use-crux/otel

## 0.4.0

### Minor Changes

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

### Patch Changes

- cdc9c16: Remove the old direct flow executor surface from `@use-crux/core`; `flow()` handles are now the only public flow authoring API.

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

- 41cf753: Fix workspace blob text/JSON read-back, byte-windowed text reads, globstar listings, bounded manifests, list limit pushdown, and privacy-safe workspace path hashes in OTel attributes.

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

- Updated dependencies [01ce116]
- Updated dependencies [cdc9c16]
- Updated dependencies [d2b64b4]
- Updated dependencies [78592f0]
- Updated dependencies [3b0fb37]
- Updated dependencies [643751b]
- Updated dependencies [dcee4fa]
- Updated dependencies [0ba939b]
- Updated dependencies [4b29d0c]
- Updated dependencies [fa1c979]
- Updated dependencies [41cf753]
- Updated dependencies [8927775]
  - @use-crux/core@0.4.0

## 0.3.0

### Minor Changes

- 5477724: Add the public observability event spine APIs: `subscribeObservability()` for in-process graph-record subscribers and `CRUX_OBSERVABILITY_CHANNEL` / `CruxObservabilityChannelMessage` for Node diagnostics-channel consumers.

  Remove the legacy runtime instrumentation hook bus. `withTelemetry()` now subscribes to the canonical graph-record stream by default, and `createOtelRecordSubscriber()` remains available for custom OTel wiring.

  Migrate AI agent, Convex swarm/compaction, and ingest parser instrumentation to canonical graph records so they continue emitting observability after the hook bus removal. `TelemetryOptions.recordContent` is removed; use the core `observability.recordInputs` / `recordOutputs` policy instead.

  Add observability capture policy controls: `config({ observability: { recordInputs, recordOutputs } })`. Disabled input/output artifacts are emitted as reference records with size/hash metadata and no preview.

  Generation and streaming span-end records now carry `gen.*` performance metrics, and `@use-crux/otel` maps them to exported `gen_ai.client.*` attribute constants.

  Restore the documented default `withTelemetry()` behavior: when no lightweight exporter is configured, `@use-crux/otel` now uses the globally registered OpenTelemetry tracer instead of silently dropping spans.

### Patch Changes

- 53b04a3: Refresh npm-facing package documentation and homepage metadata so package pages point users to cruxjs.dev and the core package README presents a concise onboarding path.

  Allow `@use-crux/google` consumers to use either `@google/genai` 1.x or 2.x.

  Document the single-turn provider bundle authoring path in adapter package READMEs.

- Updated dependencies [2cd8c52]
- Updated dependencies [890d660]
- Updated dependencies [53b04a3]
- Updated dependencies [5477724]
- Updated dependencies [a9fd8f9]
- Updated dependencies [fd4b17f]
- Updated dependencies [5a164be]
  - @use-crux/core@0.3.0

## 0.2.0

### Minor Changes

- 96fb6b7: Prepare the first npm release under the `@use-crux` package scope.

  Document the native AST beta parity gate, release checklist, and `experimental.indexer.nativeAst`
  troubleshooting guidance.

  Fix `make local` so the current-platform Rust/Oxc worker binary is replaced atomically when an old
  worker process is still running.

### Patch Changes

- Updated dependencies [96fb6b7]
  - @use-crux/core@0.2.0
