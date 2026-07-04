# @use-crux/indexer

## 0.4.0

### Minor Changes

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

- 4b29d0c: Add the `@use-crux/core/runtime` subpath with Runtime Engine port contracts, typed runtime diagnostics, wake envelope validation, retry helpers, the pure work state-machine surface, kernel composite operations, outbox dispatch, the in-memory runtime store, and the `@use-crux/core/runtime/testing` conformance suites for adapter authors.

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

### Patch Changes

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

- dcee4fa: Introduce the Retrieval & RAG stable beta public API spine at `@use-crux/core/retrieval`, including `knowledgeBase`, named `retrievalRecipe`, typed retrieval steps, canonical `RetrieveRequest`, schema-derived metadata filters, recipe traces, and grounding/tool integration types.

  Wire `knowledgeBase` lifecycle methods to the existing indexing, corpus, indexed-knowledge, storage, and retriever primitives. Knowledge bases can now index, reindex, remove sources, create namespace-scoped handles, retrieve through store-backed indexes, and inspect lifecycle/storage capability metadata.

  Implement the named single-retriever `retrievalRecipe` runtime. Recipes now execute typed steps, expose `.retrieveWithTrace()` and `.asRetriever()`, capture failed-step traces, run fanout with bounded concurrency, keep score history in structured hit provenance, support recipe-level and per-step models, emit recipe/step observability spans, and replace the old internal pipeline/stage modules.

  Add federated `retrievalRecipe` sources. The built-in retrieve step now accepts multiple retrievers or weighted source entries, runs source/query retrieval concurrently, fuses cross-source hits with structured per-source provenance, supports `fail` and `skip-with-warning` source failure policies, and records per-source retrieve attribution in recipe traces.

  Add session-backed grounding and typed retrieval tool payloads. Grounded citation validation now accounts for both injected and tool-discovered hits without parsing tool strings or closing over mutable hit arrays, retrieval tools return lean structured `crux.retrieval.hits` payloads with model-facing renderers, and `getSource` can read discovered session hits or active store-backed indexed chunks with explicit visibility.

  Add Retrieval/RAG storage conformance coverage and Convex profile mirroring. Core now exposes a vector-store conformance suite that verifies namespace filtering, delete and sparse/hybrid capability claims, and indexed-knowledge hydration diagnostics; hydration misses now fail with `RetrievalRunError("hydration_miss")` instead of silently returning empty results. `@use-crux/convex/retrieval` mirrors the core retrieval API with Convex runtime storage defaults for `knowledgeBase()` and store-backed `retriever()`.

  Add provider-agnostic RAG evaluation metrics to the Quality system. `scorers.rag.*` now includes deterministic recall@k, MRR, expected source coverage, context precision, citation validity, and trace-shape snapshot scorers, and `evaluate()` can run retrieval recipes directly or through `target.recipe()`. New retriever spans emit the beta `retrieval.retrieve` observability primitive.

  Document the stable beta Retrieval/RAG surface around knowledge bases, retrievers, recipes, grounding sessions, typed retrieval tools, and Quality-based RAG evaluation. `knowledgeBase().grounding()`, `knowledgeBase().recipe()`, and `retrievalRecipe().asGrounding()` now delegate to the functional retriever/recipe/grounding runtime paths.

  Add the shared reranking contract and adapter bindings for the beta recipe surface. Core now exports `Reranker` and `judgeReranker()`, `rerank()` accepts custom engines, `@use-crux/ai` binds native AI SDK reranking, and the Anthropic, OpenAI, and Google adapters expose matching `retrievalModel()` and judge-backed `reranker()` factories on their adapter instances. Devtools and Project Index now understand beta retrieval recipe/step primitives while keeping historical pipeline/stage compatibility.

  Promote `reranker()` to an index-visible RAG primitive. Static, semantic, native, and local Project Index paths now emit `rag.reranker` definitions, `rag.recipe.step.uses_reranker` relations from `rerank({ engine })` recipe steps, and a cache epoch migration for the updated static output. The experimental indexer authoring API also exposes ordered object-or-helper config readers so mixed recipe step arrays keep authored order. Devtools renders rerankers as first-class catalog nodes, shows authored recipe steps and step dependencies in the recipe hero, and the built-in `rag.recipe_step_unresolved_target` lint surfaces recipe step dependencies that cannot be resolved to indexed retrievers, scorers, or rerankers.

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

- 8927775: Add workspace versioning & history. Every content change (`write`, `edit`, `append`, `undo`) appends an immutable, append-only version, so destructive edits are recoverable without opting in beforehand.

  New `Workspace` methods: `history(path)` (newest-first revisions), `read(path, { version })` (read an older revision), `diff(path, { from, to })` (git-style unified-diff string plus structured hunks), and `undo(path)` (restore the previous version as a new version — history is never rewritten). Blob-backed content uses version-scoped blob keys so older revisions are never clobbered.

  Retention is unlimited by default; `versioning: { maxVersions }` bounds how many revisions are kept per file and GCs the oldest snapshots and their blobs. The `undoWorkspaceFile` tool is opt-in via `tools: { undo: true }`, like `deleteWorkspaceFile`. `rename`/`move`/`copy` start fresh history at the destination path, and `delete` purges a file's history.

  Each recorded version emits a single privacy-safe observability marker (path hash, version number, and operation only — no paths or content). Local devtools reconstruct a file's version timeline in the inspector's Versions tab from these markers, counting one entry per content change even though an `edit`/`undo` performs a nested write internally.

  `finalize()` now pins the current version as the published artifact (exposed as `WorkspaceArtifact.version`). Editing a finalized file creates new draft versions, but `artifacts()` and the manifest keep surfacing the pinned revision until `finalize()` is called again — the publish-a-snapshot model. `read()` returns the live working copy, while `read(path, { version })` is the general snapshot API for reading any retained revision, including but not limited to the pinned published version.

  Project Index workspace analysis now also surfaces `versioning.maxVersions`, the generated `undoWorkspaceFile` tool posture, and exact `history`/`diff`/`undo` data-access operations across the TypeScript static extractor, Rust/Oxc static frontend, and TypeScript/TSGO semantic backends.

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
