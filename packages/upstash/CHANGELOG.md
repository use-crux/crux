# @use-crux/upstash

## 0.8.0

### Minor Changes

- a0ed87c: Add the new `@use-crux/core/knowledge` entrypoint as the canonical home for `knowledgeBase`, add `knowledgeBase` pipeline config, and add an inert fingerprinted derive slot to `indexingPipeline`.

  Bind knowledge-base recipes to namespace-scoped graph readers when record storage is configured, allowing recipe steps to traverse knowledge relations and hydrate active chunk refs.

  Add the `expandRelations()` retrieval recipe step: additive, visibility-safe graph expansion of retrieved hits with deterministic ordering, bounded fan-out, and per-hit graph provenance.

  Export `relate()` and `knowledgeModel()` from the canonical `@use-crux/core/knowledge` entrypoint.

  Add built-in `relateReferences()` and `relateEntities({ model })` relation stages for explicit references and generic entity connections.

  Validate `knowledgeBase({ metadataSchema })` metadata during ingestion so invalid direct sources are skipped with aggregate diagnostics after valid sources index, while corpus-backed sources report schema failures through per-source sync outcomes.

  Add `knowledgeBase().view()` for schema-typed connected knowledge views with live and pinned revisions, view-scoped retrieval, recipes, grounding, and tools.

  Add `assertions()` for schema-typed, evidence-backed connected knowledge assertions with deterministic and model-backed derive modes, assertion claim caching, and generation-scoped support merging.

  Add `knowledgeBase().assertions()` and `view.assertions()` lazy assertion sets, persisted assertion relations, and assertion resolution partitions for explicit supersession and conflict handling.

  Compose assertion sets and assertion resolutions directly in `use`, injecting bounded deterministic context summaries for selected assertions and selected resolution partitions.

  Compose knowledge bases and views directly in `use` and request representation wrappers, using default prompt-input retrieval while preserving explicit `asContext()` customization for query, limit, rendering, and tool retention.

  Add `communities({ model })` for Connected Knowledge community materialization, including knowledge-base and view lifecycle surfaces for `status()`, `prepare()`, and paginated `reports()`, with graph-backed clustering, report reuse, and atomic refresh publication.

  Project visible assertions into communities with deterministic evidence, entity-affinity, relation, and per-source volume weighting; assign canonical primary and report-only secondary memberships; and include assertion-aware report context, validated finding references, deduplicated counts, view filtering, and reuse identity.

  Harden assertion community projection against duplicate assertions and malformed relations, preserve assertion-only leaf identity, align admissible report evidence with rendered prompts, and bound internal relation context.

  Let Eval-owned in-memory knowledge bases reach terminal success and failure after community refreshes, without retaining captured refresh work or public defer signals.

  Add fail-closed multimodal evidence validation for model-backed Connected Knowledge derivation and community reports, with `knowledgeModel()` modality declarations and an optional parts-based structured generation hook for hydrated media evidence.

  Add `globalSearch({ model })` as a Connected Knowledge recipe producer over community reports, returning cited finding hits with knowledge receipts, freshness coverage, deterministic batching, and request-filter rejection in favor of typed views.

  Integrate connected-knowledge contexts with request representation planning: view/retriever and assertion contexts keep exact required defaults, summarizable view contexts key derived artifacts by source revisions, retriever-owned tools remain sticky until explicit omission, request inspection projects redacted knowledge trace receipts, and `globalSearch()` can consult one injected admission hook before map calls.

  Export `runConnectedKnowledgeConformance()` from `@use-crux/core/knowledge` so storage adapters can run the connected knowledge storage contract against their own storage bundles.

  Add first-party PostgreSQL Connected Knowledge storage with JSONB records,
  explicit idempotent setup, SearchStore dense/sparse retrieval, normalized RRF,
  shared pool ownership, and full storage conformance coverage.

  Let configured storage bundles expose a provider-neutral setup capability so
  `crux setup --check/--apply` verifies and safely provisions PostgreSQL storage,
  redacts adapter findings, and releases only adapter-owned resources.

  Rename the Core retrieval index contract to `SearchStore`, making
  `storage.search` and `inMemorySearchStore()` canonical, removing the pre-launch
  retrieval index API, and adding composable dense, sparse, and lexical retrieval
  plans with normalized RRF match details. PostgreSQL adds native full-text search
  and server-side RRF, Upstash exposes `upstashSearchStore()`, and Convex storage
  requires an explicit search store instead of advertising an unsupported one.

  Surface SearchStore leg match evidence on hydrated indexed-knowledge retrieval
  hits through `hit.provenance.matches`, preserving stored chunk provenance while
  retaining dense, sparse, and lexical rank/score details for audit.

  Align Eval host storage capabilities and Local retrieval telemetry with the
  SearchStore contract: hosted Eval tasks now declare `search-store`, and devtools
  retrieval events use `search`/`custom` modes with RRF/search-leg metadata.

  Emit native Effect receipts for public knowledge-base source mutations, including `index()`, `reindex()`, `remove()`, and corpus-backed sync, while keeping derived Connected Knowledge work outside the Effect boundary.

  Add Project Index discovery for Connected Knowledge definitions, relation/assertion vocabularies, model bindings, communities, and knowledge-base views.

  Add Project Index lint rules for unknown `expandRelations()` relation types, Connected Knowledge recipe producer conflicts, and unknown assertion type selections; Local LSP hovers and definition navigation now surface Connected Knowledge definition metadata from the Project Index read model.

- 8d5c9d3: Add linearizable single-key record mutation through native or versioned
  compare-and-set adapters, including memory, Upstash Redis, and Convex storage.

  Replace the top-level `config.persistence` setting with the standard
  `config.storage` bundle. The legacy key now fails with targeted migration
  guidance; move `{ records }` directly to `storage`.

  Add the provider-neutral `thread({ id })` primitive with immutable canonical
  history, stable replay identities, causal-group pagination, and durable
  alternatives for concurrent appends. Threads support immutable user-message
  edits, remembered branch selection, and deterministic variant navigation
  metadata. Adapter authors can run the shared Thread conformance suite from
  `@use-crux/core/thread/testing/vitest`.

  Integrate Threads with managed Prompt and Agent execution through `use`.
  Execution reads one exact history snapshot, publishes the rendered user turn
  and accepted assistant/tool exchange atomically, and exposes the receipt as
  `threadCommit`. Call-site and Prompt-level messages shadow Thread I/O without
  merging transcripts. Bare Threads remain complete exact history, while
  `history.recent()` and `history()` project the Thread through whole-request
  planning. Sealed plans pin the Thread revision, managed summary artifacts use
  revision/range identity, streams await publication before final completion,
  and publication failures reject with `ThreadCommitError`.

  Add irreversible atomic message redaction, structural causal-group removal,
  and owner-safe whole-Thread deletion. Redaction permanently poisons replay and
  editing while erasing Thread-owned assets; deletion rejects while any durable
  owner remains, publishes inaccessibility before cleanup, and erases nodes,
  append receipts, pending receipt state, and assets.

  Hydrate persisted media automatically on Thread reads, emit payload-safe
  `thread.operation` evidence for every public operation, expose structural
  tree/group/branch/head data to the Runtime Bridge, and discover authored
  Threads plus Prompt/Agent bindings and binding diagnostics in Project Index.

  Surface duplicate active Thread ids and conflicting Thread bindings as
  descriptor-backed Project Index lint findings, including `crux lint` and LSP
  diagnostics, without unresolved-target false positives for valid Thread uses.

  Wire the devtools helpers' `bridge` option so `enableDevtools()` and
  `withDevtools()` connect the Runtime Bridge peer directly, and make
  `crux lint --port` read the running dev server instead of silently
  falling back to a one-shot index.

  Evict Project Index facts for source files deleted while the local server was stopped.

### Patch Changes

- Updated dependencies [02d7a23]
- Updated dependencies [d230918]
- Updated dependencies [7c3a5ae]
- Updated dependencies [7c3eaba]
- Updated dependencies [cc78bd5]
- Updated dependencies [a0ed87c]
- Updated dependencies [9418f19]
- Updated dependencies [91f7885]
- Updated dependencies [c090b22]
- Updated dependencies [ce9c409]
- Updated dependencies [226aa70]
- Updated dependencies [5d33890]
- Updated dependencies [d172b05]
- Updated dependencies [b9672b3]
- Updated dependencies [9f9b459]
- Updated dependencies [8d5c9d3]
- Updated dependencies [87c7958]
- Updated dependencies [e13389e]
  - @use-crux/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [70a8520]
- Updated dependencies [69564b7]
- Updated dependencies [be06e40]
- Updated dependencies [3140e0b]
- Updated dependencies [d5d37bf]
- Updated dependencies [42419b1]
- Updated dependencies [0e52c7d]
- Updated dependencies [2b50f9d]
- Updated dependencies [f5c5da3]
  - @use-crux/core@0.7.0

## 0.6.0

### Patch Changes

- fa12d14: Make portable application entrypoints verifiable in both source and staged npm
  packages, remove package-wide Node engine restrictions where the primary graph
  is portable, and include the Next integration in TypeScript release staging.

  The `@use-crux/ai` root no longer downloads HTTPS transcription input
  implicitly. Portable callers must provide materialized audio; Node callers can
  import `transcribe` or `createAiSdkTranscribe` from the new
  `@use-crux/ai/transcription/node` subpath to retain the bounded, DNS-pinned
  download behavior. Portable data-URL transcription no longer relies on the
  Node `Buffer` global.

  Unify observability and host-lifecycle async scoping on Core's canonical
  carrier so no-AsyncLocalStorage runtimes retain synchronous fallback behavior
  while unsafe asynchronous ambient host scopes fail closed.

  Add portable deployment identity and privacy-safe Project Index manifest
  contracts to Core. The build-time Indexer now projects and verifies the same
  deterministic artifact internally.

  Carry immutable deployment identity through observability graph records,
  suspend/resume propagation, and local run detail. `@use-crux/otel` now exports a portable
  Resource-attribute mapper, maps lightweight identity per span, and projects
  DefinitionRefs through bounded attributes and events.

  Advance observability to schema v4 with explicit operation-family identity.
  Root runs now own an `operationId`; independently durable nested Flow, named
  defer, and Convex swarm work opens causally linked child runs while ordinary
  pipeline, parallel, consensus, delegate, generation, and host continuations
  remain spans or fresh segments. Local Runs projects one row per operation with
  aggregate child/topology health, child-before-root shells, family-atomic
  retention, and deletion tombstones. Older observability storage resets in
  place because family membership cannot be reconstructed from trace IDs. Run
  lookup and deletion now require an operation or member-run ID; W3C trace IDs
  remain correlation data and never select an operation implicitly.

  Add daemon-free `crux check` with deterministic JSON and explicit CI exit
  codes. `crux lint` now uses the same one-shot Project Index service and embedded
  worker pipeline by default while retaining its no-gate compatibility behavior
  and an explicit `--server` path.

  Add daemon-free `crux manifest` artifact generation and verified, idempotent
  `crux catalog import`. Local observability now resolves runtime definition
  references only against the exact immutable deployment manifest named by a run
  and labels current-checkout comparisons separately.
  Definition fingerprints now use normalized project-relative source identity so
  identical checkouts produce the same manifest ID; static, semantic, and Go
  snapshot cache epochs invalidate root-dependent historical fingerprints.

  Add deterministic `crux catalog` list, show, status, and explain projections
  with compiler provenance, safe source paths, Health/Eval/runtime joins, and
  truthful partial or unknown state. The beta `crux index` list/show paths now
  delegate to Catalog while category keywords and explicit reindex remain.
  Durable definition evidence now retains canonical extractor and resolved
  extension provenance, and Catalog explanations name every actual contributor
  without changing the public evidence shape or phase producer identity.
  Durable relation, source-reference, and diagnostic evidence now retains the
  same exact extractor contributors across worker, cache, and restart boundaries.

  Add opinionated `withCrux` lifecycle boundaries for Cloudflare Workers and
  Next.js while retaining their low-level adapters. Workers and Next now compose
  deferred work with contained, bounded post-response observability drains;
  `createCruxConvex().run()` owns the corresponding bounded terminal drain and
  preserves deployment identity across durable continuation boundaries.
  Rejected promises returned by advisory drain reporters are contained without
  delaying or replacing handler results or host-owned drain work.
  Rename the Next Runtime artifact build plugin to `withCruxBuild`, reserving
  `withCrux` for framework lifecycle boundaries without a compatibility alias.
  Add explicit `config({ host })` retention bindings for Node, Next.js,
  Cloudflare Workers, and Vercel. Config-only ambient defer uses an ephemeral
  invocation per call; failed or cancelled scopes now record and skip inline
  callbacks instead of running them.
  Remove defer completion classes and lifetime factories in favor of the scope
  kernel's host bindings. Serverless and Node wrappers now enqueue retained work
  through the root gate. Move the Workers `withCrux` lifecycle boundary from
  Core's deleted `/observability/workers` subpath to `@use-crux/cloudflare`,
  where its structured drain runs before the kernel flush.
  Open lazy execution scopes at Crux agent, adapter, tool, Safety, flow-step, and
  Convex bridge boundaries. Inline `defer()` now works with zero host setup inside
  defer-capable primitives on long-lived processes; nested work drains at its
  nearest boundary and streaming adapters restore one scope across Core-owned
  iteration and completion segments.
  Configured host retention now applies uniformly when any Crux primitive is the
  execution root. Primitive drains still start immediately, while retention-port
  failures propagate after deterministic sealing instead of silently accepting
  work the host cannot keep alive.
  Run Evals and their cells as execution scopes. Deferred work registered by an
  Eval task is captured as cell evidence instead of invoking inline callbacks or
  staging named Runtime work, and expired remote cells drop late observability
  writes through the shared scope-sealing policy.
  Teach setup diagnostics, the built-in defer lint, and public documentation the
  same primitive-first host-retention ladder, including exact Next, Vercel, and
  Workers remediations and the generic serverless adapter contract.
  Remove the config-dependent `defer.missing_scope` bundled lint; `crux setup`
  now owns host-retention diagnostics using selected config and platform evidence.
  Portable MCP entrypoints now fail closed when stdio is selected, while Node
  runtimes resolve their lazy stdio adapters through private conditional imports.

  Align public documentation around Catalog, Runs, Evals, and Health. Narrow
  the published Indexer root to Crux-owned compiler contracts; third-party
  authoring stays on the experimental `/extensions` subpath and is declarative,
  limited to extractors plus relation declarations.

  Correlate successful managed operation results with the exact Core-owned W3C
  trace and producing span. Generation hooks and middleware receive finalized
  results; stream handles expose identity immediately and repeat it on
  completion; completed media, agent/composition, flow, scoring, compaction,
  citation, and content-indexing summary envelopes follow the same exact-owner
  contract while provider payloads and raw values remain ID-free.
  Completed-operation bindings now use the documented exact media-operation
  vocabulary; formerly normalized spellings such as `generate-image` or
  `generateimage` no longer imply a Core-owned media span.

  Managed AI Eval tasks retain correlated response metadata after removing raw
  provider values. Eval cells continue to store logical task `runIds`, while
  assertion outcomes store exact related span IDs; neither is relabelled as a W3C
  trace ID. Semantic-cache and flow persistence boundaries prevent
  invocation-local IDs from leaking across replay or durable execution. The
  private deployed-Eval result wire advances to schema version 2 so retained task
  responses require the same correlation contract across hosts.

  Postgres Runtime snapshot decoding now revives nested suspend deadlines, and
  terminal retention recognizes expired flow snapshots.

- Updated dependencies [efbed7f]
- Updated dependencies [fac9733]
- Updated dependencies [aa067eb]
- Updated dependencies [b22f00a]
- Updated dependencies [e24f46c]
- Updated dependencies [fa12d14]
- Updated dependencies [048b397]
- Updated dependencies [692e538]
- Updated dependencies [d943c41]
- Updated dependencies [4d51ecf]
- Updated dependencies [ed6626b]
- Updated dependencies [21bba63]
  - @use-crux/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [fd6edcc]
- Updated dependencies [37ebe22]
- Updated dependencies [cd3e235]
- Updated dependencies [0c3ba08]
- Updated dependencies [64a716b]
- Updated dependencies [74f27bf]
- Updated dependencies [2ab4bd9]
- Updated dependencies [58edfa9]
- Updated dependencies [089ba6f]
- Updated dependencies [aa37b64]
  - @use-crux/core@0.5.0

## 0.4.0

### Minor Changes

- 01ce116: Add atomic `RecordStore.create()` support and use it for task creation so concurrent duplicate task IDs fail with `DuplicateTaskIdError`. Record adapters now need to implement the conditional insert primitive; Convex component refs include a matching `insert` mutation.
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
