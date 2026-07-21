# Changelog

Human-friendly release notes for synchronized Crux releases. Package-specific changelogs live next to each package.

## 0.6.0

### Highlights

- Replace the pre-release Quality authoring, execution, CLI, storage, and
  Devtools model with Crux Evals V1. Applications now bind ordinary callable
  production tasks with `generate.task()` or `stream.task()`, define inert typed
  Cases and Variants through `@use-crux/core/eval`, run them with `crux eval`,
  reuse exact safe evidence automatically, and explicitly accept complete Eval
  run arms as Baselines. The old `@use-crux/core/quality` exports and
  `crux quality` commands are removed without compatibility aliases.

  Add `stableModel()` to attest a standard or custom AI SDK model's secret-free
  versioned identity for safe automatic Eval reuse. Unattested model objects keep
  working fresh and receive one actionable CLI and Devtools remedy.

  Reuse function-form prompt, system, and message renderers through their tracked
  literal-ESM source closure and an exact one-way fingerprint captured from the
  real normalized generate/stream request. The comparison projects only fields
  that can affect the provider request, excluding per-resolution observability
  IDs while retaining Context text and cache boundaries. Evidence candidates are locally
  re-rendered before reuse; mismatches execute fresh with actionable
  `nondeterministic_renderer` CLI and Devtools guidance, and raw prompt material
  never crosses the evidence boundary. Unresolved source dependencies remain
  fresh.

  Fingerprint callback-free Crux router, split, retry, fallback, and cascade
  trees by recursively projecting attested model leaves and structural options,
  then include the resolved model target in observed identity. `stableModel()`
  rejects whole route trees. Static contexts, inline skills, and schema-only
  tools can reuse exact evidence; dynamic context renderers/selectors, executable tools,
  function-produced tools, memoized or effectful context families execute fresh.
  Route-tree evidence remains fresh when its resolved target was not covered at
  planning.

  Fail closed for inline managed-task bindings and callback-bearing Variant
  prompt overrides, report the distinct `task_binding_untracked` remedy, and
  derive deployed Variant fingerprints from adapter semantic projections so
  schema-backed prompt changes cannot collide. Fingerprint Current and imported
  replacement task bindings independently so an unrelated candidate edit does
  not invalidate Current evidence.

  Add Runtime-hosted Eval execution with generated identity-only registries,
  strict offline and pre-spend planning, Node/serverless/Convex conformance, and
  the first-party `@use-crux/cloudflare` Durable Object host. Explicit fresh
  executions use a new durable admission identity while retries reconnect to the
  same admitted action. Strict offline runs load the generated data-only privacy
  policy without importing Runtime code or touching the network, and fail closed
  when that projection is missing or stale. Add awaited
  run-linked feedback through `@use-crux/core/feedback` and AI message metadata
  through `@use-crux/ai/feedback`, plus durable Review and explicit Add-to-eval
  workflows in Crux Local and Devtools.

  Add first-class Eval catalog and run views to Devtools, including same-origin
  run triggering, exact run comparisons, Baseline promotion, Eval search, reuse
  and invalidation reasons, cost and score evidence, feedback, and Review links.
  Keep the CLI coordinator protocol bounded by sending diagnostic run summaries
  instead of duplicating stored inputs and outputs over NDJSON.

  Keep durable result writes type-safe and bounded: reject non-JSON media before
  redaction, preserve supported structured values exactly, and omit oversized
  provider response envelopes from the stored run while retaining their linked
  trace references. Align privacy-policy fingerprints across TypeScript and Go,
  including HTML-sensitive keys and JavaScript UTF-16 key ordering.

  Make `--max-cost` fail closed on conservative per-call USD ceilings. Managed AI
  tasks, routing trees, bounded tool loops, and judges estimate from
  `experimental.eval.pricing`; unknown paths report missing model keys and an
  actionable remedy before any billable work.

- Add portable MCP tool sources over Streamable HTTP and stdio. MCP tools now
  materialize lazily across every first-party generation adapter and retain the
  ordinary Crux middleware, Safety, approval, Eval, observability, and
  cleanup contracts.

  Project Index and Devtools now connect authored MCP servers with
  runtime-discovered tools, safe schemas and fingerprints, health and lifecycle state,
  Run Detail preparation evidence, and exact Catalog activity. The new
  `@use-crux/mcp` package owns both supported client paths and keeps MCP optional
  for Core and adapter installations.

  The release also validates widened runtime transport and selection values at
  the public boundary, keeps opaque dependency failures out of errors and
  evidence, preserves every accepted portable tool name, closes materialized
  sessions when lifecycle preparation fails, and bounds Project Index runtime
  delivery and ingestion.

- Make portable application entrypoints verifiable in both source and staged npm
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

- Safety input guardrail rewrites now fail closed on multimodal messages: a rewrite that cannot be
  faithfully re-applied to the message's text parts (mutated or spoofed media placeholders,
  media-only messages) throws `SafetyResultError` instead of being silently dropped or duplicating
  placeholder text into the prompt. `boundary.output.both()` guards now receive the parsed object
  alongside the output text.

  Add `boundary.input.media()` for inspecting canonical non-text input parts before provider
  normalization with fully inferred callback types and stable original indexes. Enforced `strip`
  decisions remove only the current part, while report-mode strips record intent without changing
  provider input; Project Index now records the exact media boundary on authored guardrails. Input
  media remains guardrail-only: constraints reject `boundary.input.media()` in TypeScript and fail
  closed on bypassed configurations.

  Add `guardrail.media()` as a declarative, provider-neutral attachment policy for MIME allowlists,
  byte limits, exact remote hosts, inline/provider-file categories, and URL userinfo/query posture.
  It inspects only caller-supplied metadata and local bytes, supports block or strip enforcement, and
  keeps locator and payload details out of decisions. Project Index now records complete literal
  guardrail helper strategy config through the bundled native Safety extractor and retains kind-only
  facts for dynamic config.

  Add `boundary.output.media()` and completed image Safety. Generated images now run output policies
  once after routing selects a result; enforce-mode strips preserve image order, reset the `image`
  alias, and block on the final image, while report mode preserves the result. Direct image-edit
  references and masks run input media policies before provider normalization with immutable
  write-back and a fail-closed retained-mask dependency. Canonical write-back preserves provider
  `raw` and metadata identities.

  Add completed speech Safety options and runtime coverage. Speech `text` and optional
  `instructions` now run through their exact input boundaries before provider normalization, and
  generated audio runs output-media policies before reporting or return. Enforced audio strip blocks
  because audio is required; report mode preserves it. Canonical audit write-back retains provider
  facts and works identically through direct bindings and provider runtimes.

  Add completed transcription Safety options and runtime enforcement. Prompt hints and required
  audio are guarded before normalization or materialization, while validated transcript text is
  guarded once before reporting or return. Enforced transcript rewrites clear timed segments and
  words without changing provider-native facts. Transcript constraints run exactly once with no
  provider retry: assert failures throw and suggest/report failures remain in canonical audit.

  Completed operations now validate every exact Safety binding against their primitive before
  provider work. Inapplicable call and prompt bindings fail closed, while global tuple members remain
  auditable as dormant without suppressing applicable members; duplicate IDs and invalid media tuning
  still fail before dormancy classification. Guarded completed-operation results expose canonical
  decisions through the new optional `result.safety` field and exported `SafetyAudit` type.

  Typed image prompts now merge prompt guardrails with global and call policies, guard resolved user
  and system text at their exact boundaries, and hand providers a direct prepared prompt without a
  second resolution. Routed prompts require one candidate-stable ordered policy set, lazily guard only
  attempted candidates, and treat candidate input Safety failures as terminal rather than eligible for
  fallback.

  Language generation now guards every provider-produced step before client tools, history append,
  observation, continuation, or public accumulation. The loop-runtime contract exposes an optional
  pre-client-tool transform capability with Core-owned indexed text/media edits; incapable runtimes
  fail before provider I/O when step policies apply. Core and AI SDK dialects preserve tool calls,
  raw/provider identities, and guarded step/envelope consistency across reasoning, media, structured
  validation, and constraint regeneration. Text-only language prompts reject local structured-output
  bindings before provider I/O while keeping equivalent global bindings auditable as dormant.

  Stream completion now guards buffered reasoning and media through one shared Core gate before
  completion resolves in both adapter dialects. Live text retains its existing staged stream Safety
  and is not re-guarded at completion; completion-only text is guarded once, stripped media is
  removed consistently from content and assistant messages, and buffered blocks may reject after
  already emitted safe text. Raw provider and SDK stream handles remain unchanged and explicitly
  unguarded.

  Project Index now recognizes output-media boundaries, ordered input/output media tuples, media
  strategy metadata, and completed-operation Safety policy/options references in both static lanes.
  The static cache namespace advances so existing checkouts cannot reuse facts produced before the
  expanded boundary vocabulary. Devtools Catalog renders those authored boundaries, strategy/action
  configuration, and operation attachments, while Runs explains privacy-safe model, origin, and
  required-media escalation evidence.

- Cache validated dense and sparse embedding bundles per source when an indexer
  uses `cache: true`, including dry-run reuse and cache modes for `indexChunks()`.
  Embedding instances now expose vector-semantic fingerprints, and provider
  helpers derive model/request identity while accepting an additional `version`
  for explicit invalidation.

  The first sync after an embedding identity change intentionally classifies
  unchanged source content as `indexChanged`; cached vectors are reused when the
  ordered chunk content remains compatible. In `appendOnly` mode that source is
  skipped without updating its index identity, so later append-only syncs keep
  reporting the same skip until a replace-mode sync accepts the change.

  Index results and source ledgers now include `embedding` stage records with
  `embeddingKind` and cache outcomes. Consumers that match stage objects by exact
  shape should accept these new records and field.

  Add native multimodal dense embeddings with declared, const-inferred
  `modalities`, typed text/image/audio/video/document inputs, and query/document
  roles. Google `gemini-embedding-2` maps those inputs natively and has a
  zero-config model-aware path; OpenAI and the installed AI SDK embedding surface
  remain explicitly text-only and reject media before provider I/O.

  Indexers can store media documents through `AssetStore`, stamp vectors with a
  SHA-256 embedding-space digest, and retrieve the same namespace with text or
  media while retaining `RetrieverHit.source.assetRef` attribution. Namespace
  guards reject incompatible model, dimension, normalization, modality, or task
  spaces before writes or search and require a full reindex or new namespace.
  Media bytes and provider locators never enter record/vector metadata, pipeline
  caches, observability artifacts, or retrieval traces.

  Breaking (pre-1.0 minor): custom dense provider batch functions now receive
  validated `NormalizedEmbeddingInput[]` plus `{ role }` instead of `string[]`.
  Embedding fingerprints now include modality/space semantics, invalidating old
  embedding and indexing cache entries once so they are safely re-embedded.

  Project Index now emits module-scoped embedding definitions, embedding-call
  facts, vector-indexer facts, and consumer-to-embedding relations. Semantic
  lints reject proven unsupported media modalities, sparse/media combinations,
  and exact embedding-identity mismatches within a shared vector namespace.

  The embedded Devtools catalog now shows each retriever and knowledge base's
  resolved embedding modalities and dense vector-space identity, with the new
  embedding lints presented through the standard Health view. Run Detail now
  presents embedding roles, modality counts, and space digests, plus byte-safe
  asset, media-type, and page/time attribution on media retrieval hits.

- Memory capture modes are now honored end to end, and Convex memory storage is records-only.

  Adapters previously awaited memory flush unconditionally, so `capture.mode: 'afterResponse'` and `'detached'` behaved like `'inline'` for prompt-bound memory. Adapters now only await capture when the mode is `'inline'`, or when it is `'afterResponse'` without a configured `capture.waitUntil` hook (the serverless-safe fallback). Adapters also forward each tool call to memory blocks' `captureToolEvent` hooks, so `episodes()` records tool activity, and the Convex agent lifecycle retains tool results and errors. Extractive blocks with `write: { mode: 'manual' }` no longer run their extract callback during capture.

  Breaking for `@use-crux/convex` (pre-1.0 minor): the bundled Convex vector path was unusable (no schema vector index, wrong search result hydration) and its same-key vector upsert corrupted memory records, so it has been removed, including the `vectorIndexName` and `semanticCache` profile-storage options, the `ConvexSemanticCacheOptions` type, and the store-doc dense-search contract types. `convexStorage()` and the ambient Convex runtime storage now provide records only; embeddings remain mirrored on records. Semantic memory blocks fall back to recency listing on Convex unless an explicit `VectorStore` (for example `upstashVectorStore()` from `@use-crux/upstash`) is configured, and `convexVectorStore()` now throws `unsupported_capability` with migration guidance. `memory({ records })` from `@use-crux/convex` no longer injects ambient runtime storage when explicit stores are passed.

- Make TUI input routing deterministic so focused filters consume text before
  workspace shortcuts, each key dispatches at most one action, and help plus pane
  footers show only executable actions. Derive optional Dataset support from the
  injected production client and keep unsupported screens out of navigation.
  Preserve exact record identities across Overview drills and restore logical
  route, pane focus, and stable selections when navigating Back.
  Cancel in-flight Overview and Runs fetches and actions when the owning dev
  command ends instead of leaving workflow work detached from shutdown.
  Keep Runs list and detail reads revision-aware and selection-owned, preserve
  complete observability detail when exporting, and reject late detail responses
  from a previously selected run.
  Keep the Runs list selection visible across paging, filtering, refresh, and
  terminal resize, with keyboard and mouse-wheel navigation gated by pane focus.
  Wrap and scroll long Runs span details with stable resize anchors, focused
  line/page navigation, and a visible document position indicator.
  Keep the selected Runs span visible while navigating or refreshing its
  hierarchy, with focused line/page movement independent from detail scrolling.
  Render a direct, diagnosis-oriented Runs detail with failure evidence,
  diagnostics, activity, artifacts, events, and exact definition references;
  keep complete raw observability records behind explicit inspect and export
  actions.
  Keep Runs readable across narrow, medium, and wide terminals using its actual
  Workbench body bounds, prioritize diagnosis at medium widths, and show an
  actionable resize message below the supported 60x20 terminal minimum.
  Keep Overview insight and run selections visible across paging, refresh, and
  resize; expose focused-pane actions and readable narrow navigation; and retain
  pane-scoped last-good data when independent summary, insight, run, or activity
  refreshes fail.
  Make Project Index definitions and structured source details independently
  scrollable, preserve exact selection and detail anchors across refreshes, and
  retain last-good index data with an explicit degraded state when refresh fails.
  Support tab-based pane traversal and control-key paging, sanitize indexed text
  before terminal rendering, and report definition exports with portable names
  without replacing usable Index data on export failure.
  Open exact runtime definition references from Runs with `d`: navigate directly
  for one destination or choose among multiple exact IDs in a bounded scrollable
  modal. Show missing references explicitly in Project Index, never substitute a
  same-named definition, and restore run, span, definition, pane, and viewport
  location when navigating Back.
  Select the interactive workbench only when stdin and stdout are capable
  terminals outside CI and `TERM=dumb`, while keeping plain output free of
  terminal control sequences. Browser launch is now explicit: use `--open` at
  startup or `o` inside the workbench; the legacy `--no-open` flag is removed,
  while `--tui` and `--no-tui` explicitly select a mode and reject conflicts.
  Route command input, JSON output, diagnostics, worker logs, and subprocess
  stderr through scoped injectable boundaries, propagating JSON write failures
  without mutating the process-wide logger.
  Unify dev-command, TUI, event-bridge, server, WebSocket, tunnel, watcher, and
  worker shutdown under one cancelable session with idempotent bounded cleanup.
  Clean `q` and raw TUI Ctrl+C exit `0`, process SIGINT exits `130`, and SIGTERM
  exits `143`; signal status wins
  over reported cleanup failures, expected cancellation stays silent, and a
  second signal terminates immediately.
  Render the TUI immediately after listener binding while runtime preflight,
  Project Index, and runtime-artifact warmup continue under owned cancellation.
  Replay typed startup diagnostics such as `RUNTIME_HOST_ONLY` in the workbench,
  buffer edits made during the initial index, retry a failed baseline on the next
  edit, and prevent delayed terminal capability replies from leaking into the
  shell. Preserve graceful cleanup and exit status through the npm launcher.
  Allow ordinary callable Evals and adapter-managed Evals to coexist without
  placement flags: Crux derives execution per Current/Variant arm, keeps
  coordinator-only Evals out of deployed host artifacts, and validates exact
  host requirements before paid work. Generate Runtime files through one
  preflighted, atomic, manifest-last pipeline with complete structured findings.
  Make `crux setup` dry-run generated-file freshness and make
  `crux setup --apply` re-inspect before safely refreshing files; `crux dev`
  continues serving while background generation reports and retries failures.
  Preserve existing Convex routers that already call `crux.bridge(...)`, with the
  bridge registering authenticated Eval routes automatically. The local Runtime
  artifact manifest moves to v2 while the authenticated host wire remains v1.
  Register those Eval routes as real default-runtime Convex HTTP actions and
  forward them across Convex's supported action boundary, so generated and
  existing routers deploy without invalid-module errors.
  Index Eval placement in a bounded runtime-rich pass for setup, one-shot
  generation, and watcher refreshes, and treat host-bound preflight as
  metadata-only instead of executing host-only functions from the local CLI.

- Add object-bound `FlowHandle.cancel(flowId)` with consistent idempotent behavior
  with and without a Runtime Engine. Runtime cancellation now atomically marks
  both durable work and its flow snapshot cancelled, including through
  `crux.flows.cancel()`, while leaving independently deferred or scheduled child
  work running.

  Correct missing-runtime guidance to use `handle.resume(flowId)` and document
  the positional, barrier-buffered durability contract for `flow.defer()` and
  `flow.after()`.

- `serverless()` now infers distinct Vercel production and preview Runtime Engine namespaces and records their provenance. Production serverless configurations without an explicit namespace, `CRUX_RUNTIME_NAMESPACE`, or supported Vercel signal now throw `NAMESPACE_AMBIGUOUS` at composition instead of silently using `local`; set `CRUX_RUNTIME_NAMESPACE=production` or pass `serverless({ namespace: "..." })`.

  Runtime setup and preflight now warn when a serverless definition legitimately falls back to `local` in development, and the `crux` CLI renders passing-setup warnings in `crux runtime generate` and `crux dev` preflight output.

- Export `detectSuspiciousPatterns` from `@use-crux/core` (alongside the existing
  `safe`, `escapeXml`, and other prompt-injection defense helpers) and export the
  `TaskCompleteArgs` type from `@use-crux/core/tasks`. Both were already documented
  in the reference but were not part of the public export surface.

  Also corrects the documentation URLs emitted in a few packages after the docs
  site reorganized its guide routes (`defer` → `background-work`, `runtime` →
  `durable-execution`).

### Fixes

- Restore observability configuration across bundled server module copies and
  reconcile abandoned activity without treating it as currently running.

  Also preserve provider model metadata and grounded prompt types, and make
  omitted Static Index configuration use the documented default. Reject malformed
  shared runtime registry ancestry and hook layers before duplicate module copies
  adopt them.

- Replace the pre-release Quality authoring, execution, CLI, storage, and
  Devtools model with Crux Evals V1. Applications now bind ordinary callable
  production tasks with `generate.task()` or `stream.task()`, define inert typed
  Cases and Variants through `@use-crux/core/eval`, run them with `crux eval`,
  reuse exact safe evidence automatically, and explicitly accept complete Eval
  run arms as Baselines. The old `@use-crux/core/quality` exports and
  `crux quality` commands are removed without compatibility aliases.

  Add `stableModel()` to attest a standard or custom AI SDK model's secret-free
  versioned identity for safe automatic Eval reuse. Unattested model objects keep
  working fresh and receive one actionable CLI and Devtools remedy.

  Reuse function-form prompt, system, and message renderers through their tracked
  literal-ESM source closure and an exact one-way fingerprint captured from the
  real normalized generate/stream request. The comparison projects only fields
  that can affect the provider request, excluding per-resolution observability
  IDs while retaining Context text and cache boundaries. Evidence candidates are locally
  re-rendered before reuse; mismatches execute fresh with actionable
  `nondeterministic_renderer` CLI and Devtools guidance, and raw prompt material
  never crosses the evidence boundary. Unresolved source dependencies remain
  fresh.

  Fingerprint callback-free Crux router, split, retry, fallback, and cascade
  trees by recursively projecting attested model leaves and structural options,
  then include the resolved model target in observed identity. `stableModel()`
  rejects whole route trees. Static contexts, inline skills, and schema-only
  tools can reuse exact evidence; dynamic context renderers/selectors, executable tools,
  function-produced tools, memoized or effectful context families execute fresh.
  Route-tree evidence remains fresh when its resolved target was not covered at
  planning.

  Fail closed for inline managed-task bindings and callback-bearing Variant
  prompt overrides, report the distinct `task_binding_untracked` remedy, and
  derive deployed Variant fingerprints from adapter semantic projections so
  schema-backed prompt changes cannot collide. Fingerprint Current and imported
  replacement task bindings independently so an unrelated candidate edit does
  not invalidate Current evidence.

  Add Runtime-hosted Eval execution with generated identity-only registries,
  strict offline and pre-spend planning, Node/serverless/Convex conformance, and
  the first-party `@use-crux/cloudflare` Durable Object host. Explicit fresh
  executions use a new durable admission identity while retries reconnect to the
  same admitted action. Strict offline runs load the generated data-only privacy
  policy without importing Runtime code or touching the network, and fail closed
  when that projection is missing or stale. Add awaited
  run-linked feedback through `@use-crux/core/feedback` and AI message metadata
  through `@use-crux/ai/feedback`, plus durable Review and explicit Add-to-eval
  workflows in Crux Local and Devtools.

  Add first-class Eval catalog and run views to Devtools, including same-origin
  run triggering, exact run comparisons, Baseline promotion, Eval search, reuse
  and invalidation reasons, cost and score evidence, feedback, and Review links.
  Keep the CLI coordinator protocol bounded by sending diagnostic run summaries
  instead of duplicating stored inputs and outputs over NDJSON.

  Keep durable result writes type-safe and bounded: reject non-JSON media before
  redaction, preserve supported structured values exactly, and omit oversized
  provider response envelopes from the stored run while retaining their linked
  trace references. Align privacy-policy fingerprints across TypeScript and Go,
  including HTML-sensitive keys and JavaScript UTF-16 key ordering.

  Make `--max-cost` fail closed on conservative per-call USD ceilings. Managed AI
  tasks, routing trees, bounded tool loops, and judges estimate from
  `experimental.eval.pricing`; unknown paths report missing model keys and an
  actionable remedy before any billable work.

- Reshape the `@use-crux/core` README (npm page) to orient rather than document:
  keep the intro, install, examples, subpaths table, and links, and route deep
  reference topics to the docs site. Also fix stale example APIs (guardrails and
  constraints now use the boundary-based `{ id, on, run }` shape; the retriever
  example uses the real `records` field).

- Safety input guardrail rewrites now fail closed on multimodal messages: a rewrite that cannot be
  faithfully re-applied to the message's text parts (mutated or spoofed media placeholders,
  media-only messages) throws `SafetyResultError` instead of being silently dropped or duplicating
  placeholder text into the prompt. `boundary.output.both()` guards now receive the parsed object
  alongside the output text.

  Add `boundary.input.media()` for inspecting canonical non-text input parts before provider
  normalization with fully inferred callback types and stable original indexes. Enforced `strip`
  decisions remove only the current part, while report-mode strips record intent without changing
  provider input; Project Index now records the exact media boundary on authored guardrails. Input
  media remains guardrail-only: constraints reject `boundary.input.media()` in TypeScript and fail
  closed on bypassed configurations.

  Add `guardrail.media()` as a declarative, provider-neutral attachment policy for MIME allowlists,
  byte limits, exact remote hosts, inline/provider-file categories, and URL userinfo/query posture.
  It inspects only caller-supplied metadata and local bytes, supports block or strip enforcement, and
  keeps locator and payload details out of decisions. Project Index now records complete literal
  guardrail helper strategy config through the bundled native Safety extractor and retains kind-only
  facts for dynamic config.

  Add `boundary.output.media()` and completed image Safety. Generated images now run output policies
  once after routing selects a result; enforce-mode strips preserve image order, reset the `image`
  alias, and block on the final image, while report mode preserves the result. Direct image-edit
  references and masks run input media policies before provider normalization with immutable
  write-back and a fail-closed retained-mask dependency. Canonical write-back preserves provider
  `raw` and metadata identities.

  Add completed speech Safety options and runtime coverage. Speech `text` and optional
  `instructions` now run through their exact input boundaries before provider normalization, and
  generated audio runs output-media policies before reporting or return. Enforced audio strip blocks
  because audio is required; report mode preserves it. Canonical audit write-back retains provider
  facts and works identically through direct bindings and provider runtimes.

  Add completed transcription Safety options and runtime enforcement. Prompt hints and required
  audio are guarded before normalization or materialization, while validated transcript text is
  guarded once before reporting or return. Enforced transcript rewrites clear timed segments and
  words without changing provider-native facts. Transcript constraints run exactly once with no
  provider retry: assert failures throw and suggest/report failures remain in canonical audit.

  Completed operations now validate every exact Safety binding against their primitive before
  provider work. Inapplicable call and prompt bindings fail closed, while global tuple members remain
  auditable as dormant without suppressing applicable members; duplicate IDs and invalid media tuning
  still fail before dormancy classification. Guarded completed-operation results expose canonical
  decisions through the new optional `result.safety` field and exported `SafetyAudit` type.

  Typed image prompts now merge prompt guardrails with global and call policies, guard resolved user
  and system text at their exact boundaries, and hand providers a direct prepared prompt without a
  second resolution. Routed prompts require one candidate-stable ordered policy set, lazily guard only
  attempted candidates, and treat candidate input Safety failures as terminal rather than eligible for
  fallback.

  Language generation now guards every provider-produced step before client tools, history append,
  observation, continuation, or public accumulation. The loop-runtime contract exposes an optional
  pre-client-tool transform capability with Core-owned indexed text/media edits; incapable runtimes
  fail before provider I/O when step policies apply. Core and AI SDK dialects preserve tool calls,
  raw/provider identities, and guarded step/envelope consistency across reasoning, media, structured
  validation, and constraint regeneration. Text-only language prompts reject local structured-output
  bindings before provider I/O while keeping equivalent global bindings auditable as dormant.

  Stream completion now guards buffered reasoning and media through one shared Core gate before
  completion resolves in both adapter dialects. Live text retains its existing staged stream Safety
  and is not re-guarded at completion; completion-only text is guarded once, stripped media is
  removed consistently from content and assistant messages, and buffered blocks may reject after
  already emitted safe text. Raw provider and SDK stream handles remain unchanged and explicitly
  unguarded.

  Project Index now recognizes output-media boundaries, ordered input/output media tuples, media
  strategy metadata, and completed-operation Safety policy/options references in both static lanes.
  The static cache namespace advances so existing checkouts cannot reuse facts produced before the
  expanded boundary vocabulary. Devtools Catalog renders those authored boundaries, strategy/action
  configuration, and operation attachments, while Runs explains privacy-safe model, origin, and
  required-media escalation evidence.

- Make portable application entrypoints verifiable in both source and staged npm
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

- Publish Linux and macOS `crux` and static-index worker binaries with executable
  permissions, and verify an installed platform tarball by running `crux --help`
  before stable or nightly publication. Keep the workspace/npm `crux.cjs`
  launcher executable as well, so pnpm workspace bins can invoke it directly.
  Successful automated nightlies are also listed as GitHub pre-releases.

## 0.5.0

### Highlights

- Promote `@use-crux/core/observability`, `@use-crux/otel`, and the local Go observability read model to stable beta, replacing process-local reliability assumptions with an explicit multi-invocation contract. See ADR 0002 for the full rationale.

  Cut the graph record wire/storage contract over to schema v2 only (`runId` for the logical operation, `traceId` for distributed correlation, and `segmentId`/`segmentSeq` for one physical process/isolate/invocation). There is no v1 compatibility window: on first startup against the new schema, the local Go backend transactionally discards pre-v2 observability rows, which carry no truthful execution-segment identity, and rebuilds automatically. Every other local table is untouched and no manual `.crux` deletion is required.

  Add explicit lifecycle ownership for suspend/resume: `run.suspend({ reason })` ends the current segment and returns a serializable `CruxPropagationCarrier`, and `observe.resumeRun(carrier, { reason })` opens a fresh segment on the same logical run and emits `run:resume` before any child record. `observe.withContext()` remains context-only and can no longer be mistaken for a resume/suspend/end mechanism. Flow suspension and Convex swarm turns now use this shape instead of persisting a captured context and calling an implicit end.

  Make delivery lossless and per-record. The transport now inspects an indexed disposition (`accepted`/`rejected`, with a `retryable` flag) for every sent record instead of trusting `response.ok`; a malformed or partial receipt retries every unaccounted-for record. `recordId` identifies immutable content: an exact duplicate is accepted idempotently, and a conflicting payload under the same id is rejected and diagnosed rather than silently overwriting the original.

  Add a framework-neutral host lifecycle port (context/defer/deadline) with first-party bindings: Node (`withNodeObservableInvocation`), generic serverless (`withObservableInvocation`), Cloudflare Workers (`withWorkersObservableInvocation` from the new `@use-crux/core/observability/workers` subpath, using `ExecutionContext.waitUntil` with no `nodejs_compat` requirement), and Convex (`createCruxConvex()`/`action`/`internalAction`/agent/swarm wrappers, bound automatically). Every wrapper reports a structured `ObservabilityFlushResult` (`status`, `delivered`, `rejected`, `remaining`, `deadlineExceeded`) instead of a boolean; pass `onDrain` to inspect it. The Convex default flush bound drops from 20 seconds to a fixed 3-second window, since Convex exposes no per-invocation deadline API — existing callers relying on the old window should inspect `onDrain` or pass an explicit timeout.

  Remove the stream-finalizer grace timer. Only a stream's own terminal signal (drain, early return, or throw) ends its span, immediately, with stream-derived metrics; a late or never-arriving provider completion attaches as a linked `usage.observed` event/artifact and can never reopen the span or change its recorded duration/status.

  Build a real active OTel execution bridge in `@use-crux/otel`: `withTelemetry()` now activates the SDK span around the actual instrumented callback (`trace.getActiveSpan()` resolves correctly inside real work, nested spans parent correctly), maps `run:suspend`/`run:resume` correctly instead of crashing the subscriber on those record types, and starts a fresh root span sharing the original `traceId` on resume rather than reopening a stale one. Add W3C `traceparent`/`tracestate` inject/extract helpers and an explicit `baggageAttributeAllowlist` (nothing copied by default). `observe.flush()`/`observe.shutdown()` now also force-flush the installed telemetry manager's exporter/processor work, bounded by the host lifecycle port above.

  Add one revisioned Go Runs read model (`/api/observability/runs/page`, `/api/observability/runs/delta`) that joins observability and Quality server-side through an explicit correlation field, bumping a monotonic revision per affected run inside the same ingest transaction it publishes after commit. The page envelope is the sole Runs list HTTP surface; web DevTools, Global Search, and local TUI/CLI clients all consume it instead of a separate bare-array route. Fix a duplicate-`recordId` conflict path that previously let a second, different payload overwrite immutable raw content, and fix a Quality/observability correlation bug that could key an unrelated run's feedback/score data onto the wrong run's `traceId`/`runId` collision.

  Move DevTools Runs and run detail onto that one read model: delete the client-side merge of a Quality-terminal row list and a separately-fetched observability-running row list, add truthful `suspended`/`incomplete`/`conflicted` status and `unknown`/`healthy`/`degraded` delivery-health rendering, and gate WebSocket invalidation on the published revision so a reconnect performs a bounded catch-up instead of an unconditional refetch or stale cache.

  Attach bounded `DefinitionRef[]` evidence to observability records so every directly-observed Project Index definition kind joins directly to its canonical definition without stack or name guessing: prompt, context, tool, agent, flow, retriever, blackboard, and composition, plus routing (`router`/`split`/`retry`/`cascade`/`fallback`), skill, guardrail, constraint, task, workspace, memory, and the retrieval `rag.recipe`/`rag.reranker` families. A closed `DirectlyObservedKind → DefinitionRefRole` map is checked against the coverage manifest at compile time, so a new directly-observed kind cannot ship without a canonical ref. Anonymous or non-authored spans omit the ref rather than guess. Composition APIs already require an authored `id`; the random per-execution `compositionId` remains a separate execution identity.

  Extend that join to canonical runtime contributors and executed children: knowledge bases, tool policies, flow steps, parallel branches, recipe steps, and authored scorers now attach their own role-specific refs when the runtime genuinely holds their authored identity. Other structural children use explicitly parent-derived Catalog activity—“parent ran; this child is not independently observed”—while static-only kinds remain truthful zero-runtime states. No identity is inferred from a display name.

  Make recipe reranking authored-id-required so `rag.reranker` runtime evidence is truthful and collision-free: `rerank()` now takes a required, named `engine` (there is no anonymous default-model judge path), and `judgeReranker()` requires a `name`. Build the engine with `judgeReranker({ name, model })` or an adapter `reranker()` and pass it to `rerank({ engine })`. The engine's `name` is the canonical `rag.reranker:<name>` identity.

  Project those references transactionally into a rebuildable local runtime-activity overlay and add revision-aware Runs filtering by canonical definition id. The overlay follows run deletion and retention, reuses the existing observability revision stream, and never stores a denormalized Project Index snapshot.

  Normalize completed generation outcomes across `@use-crux/openai`, `@use-crux/anthropic`, `@use-crux/google`, and `@use-crux/ai` into closed `CruxFinishReason` and `CruxProviderError` / `CruxAdapterError` shapes (`kind` / namespaced `code` / `retryable` / optional redacted `message`). Stream completion failures surface instead of silent missing metadata; completed tool calls are assembled for both `generate()` and `stream()`; progressive tool-call argument deltas are not exposed. Abort and budget timeouts classify as `aborted` / `timeout`. `retryable` is classification only — SDK clients keep their own network retries.

  Finish Catalog Observability sections and View Runs for every definition kind via the coverage manifest, add Run Detail → Catalog links for all `DefinitionRef`s (including unresolved since-deleted ids), and share one delivery-health presentation (`unknown` / `healthy` / `degraded`) with plain-language status copy for `suspended` / `incomplete` / `conflicted`. Quality signal capture follows nested `triggered` child runs so flow step matchers are not falsely uncaptured under an `eval.case` cell.

  Keep Catalog activity truthful for runtime-observed primitives that do not yet carry authored definition identity. Deferred work, media operations, and ingest sources remain visible in Runs and Run Detail, while their per-definition Catalog sections explicitly report that runtime evidence is not joined and never fabricate activity counts or View Runs links.

  See ADR 0003 for the durable definition↔runtime join and adapter-outcome decision record.

- Stabilize model routing around `router()`, `split()`, `retry()`, `fallback()`, and `cascade()` wrappers with routing receipts, generate/stream support boundaries, and updated adapter docs.

  Breaking routing API changes: router `.with()` and `.select()` are removed in favor of call-site `routing` and `route` options; variadic `fallback(a, b, opts)` is replaced by `fallback([models], opts)`; `_meta.router` / `_meta.cascade` / `_meta.fallback` are replaced by `result.routing`; native OpenAI, Anthropic, Google, and Convex model options now type-reject routing wrappers instead of accepting unsupported values.

  Extend Project Index routing facts, static extraction, native semantic parity, relation policies, and index lints to cover split routes, retry targets, array-form fallback, call-profile model targets, and RouteArgs callback source refs.

  Surface canonical routing receipts in local devtools run detail and Project Index views, including router defaults, split buckets, retry/fallback attempts, cascade budgets, and receipt-backed Turn Decision Report chips.

  Project Index now shows required `RouteArgs` context types and literal route call-profile parameters. Run Detail renders receipt TTFT, bounded attempt errors, and cascade tier note/budget from the same canonical `routing.report` preview.

  Run Detail now accepts the canonical JSON-safe receipt when unavailable routing costs are serialized as `null`, including nested retry, fallback, and cascade cost fields.

  OpenTelemetry span naming now covers all five canonical `routing.*` primitives and no longer treats the `fallback.attempt` edge/name as a primitive.

- Promote `@use-crux/core/runtime` and its store-adapter contract to stable beta while Crux remains pre-1.0.

  Remove unused Runtime Engine dead port exports, validate `crux.flows.signal()` against the durable flow snapshot before emitting, warn once when a durable target name is re-registered with a different definition, and make production `createRuntimeHandler()` fail closed unless wake request verification is configured explicitly or supplied by the wake adapter.

  Embed delivered event payloads in runtime flow snapshots so flow replay no longer scans the event log after delivery. Store adapters must persist the `payload` field passed to `state.markSnapshotDelivered()`.

  Add Runtime Engine retention config and bounded maintenance pruning for events, terminal work, terminal snapshots, confirmed outbox rows, idempotency keys, settled timers, and settled waiters. The memory, Postgres, and Convex runtime stores implement the new prune contract and conformance coverage.

  Fence Runtime Engine wake commits with lease tokens and heartbeat leases while target code runs. Stale workers now exit cleanly with `LEASE_LOST` instead of retrying, dead-lettering, or overwriting a reclaimed worker's result.

  Add named Runtime Engine composite commits and the optional store-adapter `runComposite(kind, input)` override. Core keeps the default `transact()` runner, and the Convex runtime component now routes composites through one mutation for atomic host-bound commits.

  Run the shared composite conformance cases against Convex's component-backed `runComposite` path, and encode composite Date payloads with Convex-valid object keys.

  Use Convex-compatible filenames for internal Runtime Engine component modules so Convex codegen and deployment can discover them.

  Make `config()` lifecycle-safe by installing one hook layer per active config, replacing the previous active config on repeat calls, and keeping independent layers such as imperative devtools intact when a config is disposed.

  Hard-rename the global hook-store API from the runtime family to the hooks family: `CruxHooks`, `getHooks()`, `setHooks()`, `updateHooks()`, `resetHooks()`, and `mergeHooks()`. The old hook-store names are removed with no deprecated aliases so Runtime Engine terminology can stay unambiguous.

  Rename the Runtime Engine task target factory from `task()` to `durableTask()` and remove the dead task output generic. Project Index runtime target discovery and lint guidance now recognize `durableTask()` declarations. Remove `createConvexRuntimeBridge` from the public `@use-crux/convex` root and package subpath; use `createCruxConvex().run()`, `.storage()`, and `.bridge()` as the single Convex entry point.

  Add `createTestRuntime()` on `@use-crux/core/runtime/testing` for app-level Runtime Engine tests. The harness installs an in-memory runtime hook layer, provides a controllable clock for `flow.after()` and suspend timeouts, and exposes bounded `tick()`/`settle()` helpers without real timers.

  Runtime Engine store adapters now honor the runtime clock when pending work is requeued, keeping `createTestRuntime()` timers deterministic even when the injected clock differs from wall time.

  Bound Runtime Engine outbox dispatch to eight concurrent deliveries by default, add `RuntimeOutboxPort.listByWork()` for targeted orphan recovery, remove shared-counter event append hot spots and the unused `runtimeCounters` table from the Convex runtime component, require namespaces for maintenance scans, and remove `eval.run` plus stale bridge manifest fields from the runtime bridge command contract. Orphan requeue now treats any same-namespace pending wake for the work id as live, even when its idempotency key was refreshed.

  Disable Runtime Engine lease heartbeat timers for Convex host bindings while preserving lease fencing, and make the default heartbeat scheduler a no-op when timer APIs are unavailable.

  Remove unused exported idempotency helpers `flowSignalResumeKey()` and `watchDeliverKey()` from `@use-crux/core/runtime`.

- Adopt parsed Zod input throughout prompt resolution, run `sanitize` before top-level auto-escape, warn when nested string input cannot be auto-escaped, and collect nested `when()`/`match()`/contributor schemas consistently for prompt input validation.

  Split context resolver memoization from provider cache hints: dynamic contexts now use `memo: { ttl }` for app-side memoization and `cache: true` only for provider cache breakpoints. Prompt definitions now reject duplicate statically reachable entry ids, context memoization requires a dynamic `id`-bearing context, and dynamic context callbacks receive only their declared input fields.

  Provider system adaptations now participate in the typed system block model. In prompt mode, `prependSystem`/`appendSystem` produce `systemBlocks` with `source: "adaptation:<key>"`; prepend adaptations land after the stable cached prefix so provider cache boundaries stay byte-stable. Messages-mode prompts fold the final adapted system text into `messages` without returning parallel `system` or `systemBlocks` fields.

  Tool-name collisions now throw consistently across prompt-time tool sources, with both owners attributed. Skill, context, contributor, blackboard, and prompt-level tools must use unique names; call-site `generate()`/`stream()` tools remain the intentional override path.

  `compilePrompt().inspect()` now runs with quiet observability, instrumentation, and diagnostics ports: it still executes the shared resolver pass and memo-cache path, but emits no spans, artifacts, diagnostics, or cache instrumentation events.

  Harden prompt authoring types for the stable beta surface: `messages` mode is now compile-time exclusive with `system`/`prompt`, `when()` wrapper predicates receive partial context input, `match()` branch input keys are included as optional merged input fields, concrete prompts preserve literal `hasOutput`, and heterogeneous `AnyPromptConfig` remains assignable from precise prompt configs.

  Consolidate custom prompt composition on `contributor()`: remove the public `injectable()` factory and related `InjectableConfig`/`InjectableEntry`/`PromptInjection` exports, rename `ContributorContribution` to `Contribution`, rename `AdapterMap` to `ProviderAdaptations`, and keep primitive-family attribution internal to first-party factories.

  Add portable tool-loop controls to `GenerationSettings`: `toolChoice`, `stopWhen`, `maxSteps`, and the `maxSteps()` / `hasToolCall()` helpers. Core-step adapters honor neutral stop conditions, OpenAI/Anthropic/AI SDK adapters map neutral tool choice to provider-native request fields, and provider-specific tool-control variants move to each adapter's typed `extra` option.

  Make provider prompt caching a stable-prefix contract: cached context blocks now compose before the uncached tail, token budgets can drop only uncached blocks, prompt-level static system text can join the provider cache prefix, `SystemBlock.cacheBoundary` marks the single native breakpoint, and `prompt.budget` artifacts report `prefixOverflow` when the stable prefix exceeds the requested budget.

  Add freshness record metadata for resolved contexts: inspect parts and `context.contribution` artifacts now report live-vs-memo provenance, original resolution time, memo-hit age, and optional segment source facts (`observedAt` / `sourceVersion`) when primitives such as retrievers already provide them.

  Tighten adapter parity and trust behavior: usage metadata no longer fabricates zero-token counts when providers omit usage, forged or mismatched tool approval responses become model-visible denial results instead of thrown errors, agent tool composition avoids prompt type widening, AI SDK call settings pass through to gateway calls, AI SDK structured streams report dropped tool observability through each request's diagnostics, and provider cache boundary conformance now runs across OpenAI, Anthropic, Google, and AI SDK adapters.

  Add adapter contract harness scaffolding for the pre-launch API cleanup: target type assertions, a canonical result validator for shared conformance tests, canonical options fixtures, and headless equivalence TODO rows for the handle/transport phases.

  Nest normalized generation usage details under `inputTokenDetails` and `outputTokenDetails`, preserving no-fabricated-zero usage semantics while exposing cache-read/cache-write/reasoning token classes consistently. Add the portable `GenerationSettings.reasoning` hint and map it across AI SDK, Anthropic, OpenAI, and Google adapters.

  Replace generation `timeoutMs` with structured `timeout` budgets: `totalMs` for the whole managed call, `stepMs` for provider attempts, `chunkMs` for stalled streams, and `toolMs`/`tools[name]` for tool execution. Crux timeouts now reject with typed `TimeoutError`, and loop-runtime step observers use `onStepEnd`.

  Return canonical native adapter result envelopes from `generate()` and `stream()`: accumulated `text`, optional complete `usage`, optional `cost`, `steps`, `finalStep`, provider-neutral `messages`, typed `.raw`, and retained `_meta` for observability. Native streaming now returns `{ textStream, raw, completion }`, with `completion` resolving to the same canonical envelope fields.

  Bring `@use-crux/ai` into the same adapter contract: portable AI SDK call settings now use canonical Crux fields, SDK-native request controls live under `extra`, `generate()` and `stream()` return canonical envelopes with typed `.raw`, and stateless UI-message helpers bridge canonical stream results to AI SDK `useChat` responses.

  Move tool approval policy to composition layers: declare `toolApproval` on contexts, prompts, or call options; tool definitions no longer carry approval policy. Approval resolution now preserves exact-over-wildcard precedence, call-site/prompt/context provenance in inspect output, and the existing suspend/resume token hardening across native and AI SDK adapters.

  Document the `@use-crux/core` stable beta contract in `packages/core/STABILITY.md`, add the `0.4.0-beta.0` changelog entry, and align prompt/context/adapter docs with the stabilized composition, caching, freshness, and tool-control surfaces.

  Add typed per-tool execution context: tools can declare `contextSchema`, callers supply validated `toolsContext` keyed by tool name, and shared `runtimeContext` now threads through tool execution, middleware, and approval-policy callbacks across core and AI adapter calls.

  Expose public adapter codecs and the first headless call handle: all adapters now export `toParams()`/`fromResponse()` translation helpers, and `@use-crux/anthropic` supports `prepare()`/`step()`/`finish()` over the same executor path as managed `generate()`.

  Complete the headless ladder across first-party generation adapters: Anthropic, OpenAI, Google, and AI SDK expose `prepare()` handles, `generate()` accepts typed `transport` callbacks, managed/handle/transport equivalence is covered by adapter tests, and `stream()` with `transport` now fails explicitly with `CruxTransportStreamUnsupportedError`.

  Raise all Crux workspace packages to a Node.js 22 ESM-only contract: package exports no longer include CommonJS `require` conditions, and local skill file loading moved from `@use-crux/core/skill` to the explicit Node-only `@use-crux/core/skill/node` subpath. Replace `import { skill } from '@use-crux/core/skill'` with `import { skill } from '@use-crux/core/skill/node'` anywhere you call `skill.fromFile()`.

  Keep quality signal capture independent from a previously configured observability transport: evaluation cells still capture trace records synchronously, but a stale or hanging forwarding transport no longer stalls quality runs or inflates cell durations.

  Introduce the canonical multimodal message vocabulary: `Message.content` now accepts strings or readonly `ContentPart[]`, `ToolModelOutput` rich content uses `ContentPart[]`, and the old `ToolContentPart`/`media` part surface is removed. Core now exposes the final `text | image | file` content union, `MediaSource`, `textPart`, `contentText`, `messageText`, and `hasMediaParts`; media parts put bytes, URLs, `Asset`, or `Blob` values directly on `source`.

  Make native transcript codecs content-aware beneath the existing public `toParams()`/`fromResponse()` ladder. Anthropic now encodes canonical image and PDF content through one exhaustive part table for messages and tool results, decodes assistant media back into canonical message content, and rejects unsupported media before provider I/O.

  Retire the AI SDK adapter's blind content-array passthrough for recognizable parts: canonical multimodal messages now encode to AI SDK text/image/file parts, native AI SDK `ModelMessage[]` from `convertToModelMessages()` reaches the AI SDK loop without lossy Crux media conversion, and SDK control parts move into `Message.metadata` for canonical result history. The pre-launch v6 `media` compatibility decoder is removed.

  Add native multimodal part tables for OpenAI and Google. OpenAI chat now encodes image, audio, and file data through provider content parts, decodes assistant/user media back into canonical content, and no longer flattens rich tool results with raw base64 text. Google now encodes inline and URI-backed media through `inlineData`/`fileData`, decodes assistant inline media into canonical content, and requires `mediaType` before sending URI-backed parts natively.

  Route guardrails, compaction, memory capture, semantic cache keys, resolver system folding, Convex memory persistence, and OTel message-content export through the canonical `messageText()` projection. Multimodal message previews now use bounded placeholders instead of `[object Object]` or raw base64, and `@use-crux/convex` re-exports the core multimodal content helpers.

  Document the multimodal message layer across the core README, core architecture notes, docs guide, core reference, adapter references, and Convex reference, including the adapter capability matrix and strict/degrade behavior.

  Close multimodal adapter edge cases found during review: AI SDK tool and assistant transcripts now preserve rich content instead of dropping it, Anthropic strict mode applies to tool-result content, OpenAI degrades unsupported audio formats, and tool-result text fallbacks use bounded placeholders rather than raw base64.

  Harden multimodal follow-up edges: AI SDK malformed media parts now warn before being dropped, encode-path unknown parts use request diagnostics, response tool results preserve structured content arrays, large media text descriptors avoid full payload hashing, capture policy redacts reference-only artifacts in off mode, inline data URLs sanitize consistently, and OTel message-content fallbacks continue past empty structured content.

  Introduce the public Asset/AssetStore foundation for multimodal persistence: data, URL, and provider-file assets now share one discriminated union, `inMemoryAssetStore()` provides explicit local persistence, and storage bundles can carry an optional `assets` capability.

  Migrate workspace persistence from the removed byte-store surface to `AssetStore`: `Storage` now uses `assets`, workspaces persist oversized/binary content as data assets, Convex exposes `convexAssetStore()`/`ConvexAssetStoreConfig`, Project Index/devtools storage facts use `storage.assetStore` plus `uses_asset_store` relations, local storage warnings use asset vocabulary, and Project Index cache identities are bumped for the new read model.

  Add safe media-boundary error contracts for the multimodal input pipeline: `InvalidMediaSourceError` reports malformed media source values before provider I/O, and `UnsupportedCapabilityError` aggregates adapter/model capability failures with safe message paths and remediation.

  Activate the final direct message input grammar across core and first-party consumers. `ContentPart` is now the readonly `text | image | file` union with media on `source`; removed helper factories, source-specific variants, degradation settings, and the competing content error no longer ship. Sliding-window persistence now accepts one `Storage` bundle and saves media as asset refs before its message record.

  Lower OpenAI chat media at the shared per-turn request boundary. Managed generation, streaming, call handles, custom transports, and later tool turns now receive equivalent native image/file payloads; OpenAI image detail, MIME, filenames, and provider file IDs are preserved. Known unsupported model/media combinations fail with safe exact paths before any provider request.

  Harden the multimodal boundary before release: data URLs are decoded with bounded allocation, Blob-backed assets remain directly usable, corrective generation repeats the same per-call normalization, OpenAI provider-file audio stays in native file-ID form, ordinary observability emits only private media descriptors, persisted media records are semantically validated, and sliding-window summary plus messages commit atomically.

  Complete direct media input parity for Anthropic and Google language calls. Anthropic now lowers URL/data image and PDF input, preserves supported media cache-control options, and rejects unsupported stable-SDK file IDs before I/O; Google now lowers URL/data/provider-file media to `fileData`/`inlineData`, preserves MIME, filenames, and media-resolution options, and reports selected-model media failures before any provider request.

  Preserve Convex Agent as the media lifecycle owner for `@use-crux/convex`: profile-backed Agent calls now pass native AI SDK image/file parts to Convex Agent, reuse stored Convex file URLs without duplicate Crux asset writes, defer inline media autosave to the installed Agent threshold, and redact media URLs/storage identifiers from memory and observability previews.

  Validate canonical media through provider-owned, side-effect-free hooks after prompt resolution and before native I/O. First-party direct adapters, AI SDK, and Convex Agent now share semantic conformance cases while keeping model support knowledge private to each integration; omitted extensions and capability discovery remain absent from public runtime types and records.

  Sanitize multimodal observability recursively before serialization. Message, tool, result, and error capture now retain only bounded media descriptors with safe scalar facts; raw bytes, Blob contents, base64/data URLs, filenames, bearer references, provider file IDs, and signed URL details cannot reach local transports or OTel message-content attributes.

  Apply the same descriptor allowlist defensively when Crux Local ingests old or untrusted artifact previews, before general retention caps. Devtools recognize retained image/file descriptors and render compact accessible fact labels instead of expandable JSON or raw media viewers.

  Complete OpenAI's native stateless media surface: speech generation now returns immediately usable audio bytes through the shared bounded-operation lifecycle, and supported English audio translation routes to the native translations endpoint. Unsupported speech and transcription controls still fail before provider I/O.

  Add native Google speech generation with typed single- and multi-speaker voices. The operation returns the provider's audio bytes through the shared bounded lifecycle and rejects portable controls Google cannot honor without prompt emulation.

  Expose AI SDK speech as a direct unbound operation alongside image generation and transcription. Custom speech models continue through AI SDK-owned dispatch while Crux preserves native warnings, response metadata, provider metadata, and immediately usable audio bytes.

  Re-export AI SDK image, transcription, and speech operations by exact identity from Convex while leaving the Convex Agent loop, file autosave, thread persistence, and useChat lifecycle unchanged.

  Finalize Anthropic's stable-SDK multimodal boundary: image and PDF input plus rich tool results remain native, audio/video and provider file IDs fail before I/O, and image generation, transcription, and speech remain structurally absent.

  Harden completed-operation option ownership: OpenAI completed speech excludes SSE and translation forwards only translation-native fields; Google keeps Imagen and Gemini extras isolated, defers unknown model IDs to native validation, and requires provider audio MIME; AI SDK speech prevents native extras from shadowing portable fields.

  Make OpenAI transcription and translation extra namespaces mutually exclusive and task-aware at runtime, so an inactive endpoint namespace always fails before provider I/O.

  Account for media in internal message budgeting and compaction metrics without changing the public synchronous text tokenizer. Direct adapters estimate from provider/model identity and already-known asset facts only; unknown media uses a deterministic conservative fallback, invalid provider estimates fail before I/O, and reported provider usage remains authoritative.

  Apply the same private media budgeting path to AI SDK generation and streaming from stable provider/model identity, with a safe fallback reason for custom identities and no direct-adapter dependency. Convex Agent continues to own its native loop and usage accounting without a second rule set or extra model/storage action.

  Define the flat provider-neutral image generation contract: typed Crux prompts lower through the shared resolver, language-only features fail together before provider I/O, native successes normalize to immediately usable ordered data assets, and malformed or empty successes receive a tagged no-image error.

  Add `openai.generateImage()` as one native OpenAI Images API operation, with typed OpenAI controls, native edit support for byte assets, ordered data-asset results, raw response preservation, and unchanged transport errors.

  Expose stateless AI SDK image generation through the injectable gateway, bound `CruxAi`, provider runtime extension, and package-level `generateImage()`, preserving native files, warnings, usage, response metadata, provider metadata, and the raw result without entering the language loop.

  Add `google.generateImage()` through the native Google GenAI `generateImages()` surface, with package-local model/control support declarations, safe preflight rejection, ordered byte results, safety warnings, request metadata, and unchanged provider errors.

  Map Imagen data-asset references and portable masks to Google’s native `editImage` endpoint, expose collision-free `extra.edit` controls, and reject unsupported Gemini masks before provider I/O.

  Complete five-adapter image-operation parity: Convex Agent exactly re-exports the AI SDK function without Agent or storage behavior, Anthropic omits the operation structurally, and tested internal support fixture data projects the OpenAI, AI SDK, Google, Convex, and Anthropic bindings into adapter docs.

  Make conversation compaction media-aware by describing each media part through the configured native generation path before summarizing an ephemeral text-only copy. `GenerateTextFn` now accepts either a prompt or canonical messages plus an output bound, and core sliding windows and Convex compaction share the same optional media controls.

  Define flat provider-neutral transcription contracts with always-present seconds-based segments, tagged semantic-empty failures, storage-free source normalization, and strict result validation. Node adapters share an explicit `@use-crux/core/transcription/node` HTTPS downloader with bounded streaming, redirect and DNS safety, and pinned validated resolutions, while root and neutral transcription entrypoints remain isolate-safe.

  Replace ingest OCR hooks with a readonly application-owned media operations port. File and URL sources now detect common image formats, image files derive ordinary text through one bound generation call, visual-only PDF pages use the same operation with one-page instructions while native text pages remain model-free, and explicitly identified Assets can enter the existing file source pipeline without provider dependencies.

  Add `openai.transcribe()` as one bound native Audio API operation. Crux reuses its storage-free source normalization and secure downloader, maps portable language/prompt controls plus typed OpenAI extras, validates common text and seconds-based segments, warns when timing is absent, and preserves native results and transport failures.

  Expose stateless AI SDK transcription through the injectable gateway, provider runtime extensions, bound `CruxAi`, and package-level `transcribe()`. URL audio always receives Crux's bounded secure downloader, unsupported common mappings fail before I/O, and native segments, warnings, response metadata, provider metadata, raw results, and errors remain intact.

  Complete five-adapter transcription parity: Google uses one composed `generateContent()` call with audio and a fixed transcript-only instruction, returns empty timing arrays, and rejects timestamp requests rather than presenting model-invented timing; Convex Agent exactly re-exports the AI SDK operation; Anthropic remains structurally absent; and an internal all-five fixture locks native, composed, delegated, and absent support expectations.

  Derive ingest documents from MP3, WAV, M4A, OGG, FLAC, and WebM audio through the existing media operations port. Each source invokes transcription once, emits ordinary text parts with explicit seconds locations when timing is valid, preserves only safe language/duration/warnings and StoredAsset refs, strips signed URL data, and carries time provenance into core indexing without retaining audio or provider payloads.

  Complete explicit media derivation in ingest: rename the application-bound semantic operation from `generate` to `describe` with no alias, migrate transcription to the final interval contract, and derive video from caller-supplied visual description, soundtrack transcription, or both. Video evidence records its exact derivation mode, never samples frames implicitly, and preserves soundtrack seconds through indexing and retrieval.

  Extend the existing Quality judge to `JudgeContent` (`string | Asset | readonly ContentPart[]`) while keeping structured outputs selector-driven. Media reaches the bound judge as normal canonical message content, binary outputs are never written implicitly to cassettes or output caches, and media-aware cassette/output identity epochs invalidate stale entries.

  Preserve streamed text in canonical completion content when a provider reports an empty content array, so text, steps, messages, and final-step projections remain lossless.

  Harden Quality media persistence: cell, experiment, and failure snapshots project media to safe descriptors; unknowable Blob identity disables synchronous cache reuse; and both generation and whole-value cassette paths refuse implicit binary or locator-bearing media.

  Preserve allowlisted media source facts through ingest and indexing. Documents and chunks can retain safe HTTPS/path/AssetRef/media-type facts plus validated page or seconds locations, while vector metadata remains source-detail-free and source lifecycle identity remains `sourceId`.

  Replace the pre-v1 flat retrieval-hit `sourceId`/`sourceUrl`/`sourcePath` fields with readonly `source: { id, url?, path?, assetRef?, mediaType?, location? }`. Indexed retrieval, custom retrievers, recipes, rerankers, tools, citations, Quality signals, workspaces, Convex, observability, and devtools now use one structured attribution value without media hydration on retrieval paths.

  Publish the final progressive multimodal guide and fixture-generated five-adapter matrix for chat media, image generation, transcription, explicit AssetStore persistence, media ingest, and attributed retrieval. The public story keeps provider/model support checks adapter-owned and exposes no runtime capability registry or automatic persistence path.

  Make mixed generation output lossless: `GenerateResult.content` is now the authoritative ordered assistant output, `text` is its text-only projection, `steps` exposes ordered step facts, and stream completion buffers exact media, reasoning, tool-call, warning, metadata, and message content without adding live media delta events.

  Unify bounded media operation contracts before provider migration: image generation, transcription, and speech now share required warnings, provider metadata, native/composed execution facts, raw results, cancellation, and total/step timeout vocabulary. Image edits enforce reference-mask and size/aspect-ratio laws, transcription exposes honest segment/word/speaker intervals, generated URLs remain usable without hidden downloads, and the new speech seam returns one explicit data asset.

  Run bounded media operations through one immutable functional lifecycle for normalization, private support preflight, native invocation, result validation, and descriptor-only reporting. Known unsupported routed candidates fail before provider I/O, unknown models reach native validation, total and per-attempt deadlines compose with cancellation, retry/fallback/router/split preserve call counts and original failures, and completed operations remain outside the language/tool loop.

  Index authored media operations and ingest sources through backend-neutral Project Index contracts. Static TypeScript extraction records only proven modalities and allowlisted authored options, preserves named and nested operation structure plus compiler-owned relations, and excludes prompts, locators, references, filenames, provider identifiers, and arbitrary provider options.

  Match those authored media facts exactly in the Rust/Oxc static frontend, including nested ownership and ingest relations. Static cache epoch `static-parse-v61`, Oxc projection identity `crux_native_group3.8`, and native primitive manifest v11 prevent pre-media output from being reused.

  Resolve authored media operations through backend-neutral semantic evidence, including imported and local aliases, routing relations, deterministic misuse findings, and discarded outputs. The TypeScript backend now consumes the shared source profile without rereading local closure files, and semantic cache epoch `semantic-facts-v27` prevents pre-media facts from being reused.

  Match authored media evidence exactly in the TypeScript-Go backend through the complete shared analyzer. Native backend identity `tsgo-native-preview-v2` and runtime identity `native-preview-v2` prevent cached pre-media native evidence from being reused.

  Expose all seven deterministic media lint contracts and preserve safe authored media facts through shared events and the Go Project Index read model. Semantic cache epoch `semantic-facts-v27`, authored media manifest v2, native backend/runtime v3, and Go snapshot epoch 33 prevent stale pre-lint projections after restart.

  Correct Project Index media extraction to follow public `generate(prompt, options)` and `stream(prompt, options)` calls, derive adapter identity only from resolved package/binding provenance, preserve prompt/model-routing relations, and index transcription `task`. Static TS/Rust and semantic TS/native backends now prove exact parity from real package-resolved fixtures; native primitive manifest v11 and defer compiler projection v2 invalidate their structured compiler identities.

  Normalize authored transcription tasks in Project Index and Catalog to `task: 'transcribe' | 'translate'`, including object-form translation requests, without retaining target language or media locators. Bump the Go Project Index snapshot cache to epoch 33.

  Migrate OpenAI, Google, and AI SDK image generation and transcription onto that shared lifecycle without changing their native endpoint ownership. Specialized results now expose the common warnings, provider metadata, execution, and raw tail; provider errors remain unchanged, Convex keeps exact AI SDK re-exports, Anthropic keeps structural omission, and adapter authors can bind future speech definitions without adding persistence or a second loop.

  Preserve provider-native multimodal continuation without leaking opaque state into text or observability: Anthropic redacted thinking, Google thought signatures and assistant media, and OpenAI generated-audio IDs now survive tool loops. OpenAI audio output supports WAV, AAC, MP3, FLAC, Opus, and PCM16 with honest MIME types; AI SDK output accepts every documented media data shape; safety-transformed stream text retains the provider's mixed-content slot ordering.

  Instrument completed media operations with the closed media observability vocabulary (`media.generate_image`, `media.transcribe`, `media.generate_speech`, `media.describe`), allowlisted `media.report` artifacts, and canonical `derived.from` lineage. The shared completed-operation runner emits exact provider/model/execution/call facts, nests composed children such as `generation.call`, and never retains raw media under any capture mode. Safe descriptor `sourceCategory` is the closed union `data | url | provider-file | asset-ref | bytes | blob | unknown` across core, OTel, local retention, and Devtools Runs (data URLs project as `data`; arbitrary tokens become `unknown`). Ingest describe/transcribe derivation links under those primitives; OTel maps media spans to documented `gen_ai.operation.name` values (`generate_image`, `transcribe`, `generate_speech`, `generate_content`) with production text off by default. Devtools Catalog and Runs gain purpose-built media projections, filters, descriptor cards, attempt/composition timelines with provider/model, transcript timelines, complete input→operation→output→ingest/index/retrieval lineage with relationship edges and page/time attribution, and Catalog joins without thumbnails, players, locators, or raw media.

  Publish the complete progressive v1 documentation and fixture-checked five-adapter matrix for every message modality, mixed assistant media, image generation, transcription, and speech. Adapter references and package READMEs now state exact native/composed/structurally absent boundaries, explicit persistence, safe observability, Project Index linting, and framework-owned AI SDK/Convex behavior without adding a runtime capability API.

  Restore Crux Local startup Runtime preflight by validating the complete operation vocabulary in the embedded worker, and move cross-plane injection-state and judge-report presentation into shared Devtools modules so feature dependency boundaries remain enforceable.

  Harden final media privacy edges: Devtools Catalog join labels never derive from `definitionId` (including suffix stripping) and fall back to a fixed generic label when no safe display name is recorded; local retention reconstructs audio/video descriptors with the same allowlist and `sourceCategory` normalization as image/file; Convex Agent message previews emit canonical descriptor-shaped media facts (`kind` + `sourceCategory`) so data URLs stay `data` and never re-enter Core as fake `url` markers.

- Add request-scoped `defer(callback)` with bounded host-lifetime execution, the
  explicit `@use-crux/core/defer/node` HTTP integration, and Runtime-backed named
  target staging through `await defer(target, input)`. Postgres and Convex Runtime
  stores now persist named deferred intents and recover their release through the
  existing transactional outbox. Public `defer()` is rejected during replayable
  flow execution, and the Runtime snapshot field for replay-visible child work is
  hard-renamed from `scheduledEffects` to `scheduledWork` with no compatibility
  field or read path.
  Inline callbacks now isolate nested named commits per callback and report late
  commit failures without stopping sibling cleanup.
  Project Index now discovers public inline and named scheduling sites as stable
  `deferred-work` definitions, resolves their task and enclosing-definition
  relations, and reports replay-unsafe, floating-promise, missing-scope, and
  explicitly missing-Runtime diagnostics.
  Public deferred work emits `defer.scheduled` and `defer.run` observability
  spans with causal `triggered` edges, one lightweight grouped run when no
  originating Crux run exists, and quiet diagnostics-only internal composition.
  Inline retained tasks flush only after their full graph closes. Named wakes use
  fresh same-trace runs and segments with a causal edge, then flush only after the
  durable outcome commits.
  Devtools Catalog and Runs surface deferred-work kinds, lifecycle states, and
  honest handler-returned streaming notes.
  Provider-neutral serverless hosts live at `@use-crux/core/defer/serverless`
  (injected `waitUntil` / `after` / named-only). `@use-crux/next` binds Next.js
  `after()` as response-finished. Convex bridge runs install a named-only lifetime
  so inline callbacks fail with `DEFER_CAPABILITY_MISSING` while named Runtime work
  remains supported.
  Docs cover host reliability boundaries, completion classes, strict named commit,
  at-least-once edges, cancellation limits, and the distinction from
  `flow.defer()` / future Effects.

  The defer setup contributor now participates in `crux setup`, reporting host
  integration and named Runtime durability readiness without redefining the
  shared `@use-crux/core/setup` contract.
  Deferred intent stores now preserve the first terminal state across memory,
  Postgres, and Convex, and setup distinguishes inline host wrapping from literal
  named-work `durableFinalization: true` capability.

- Stabilize the Quality beta API and experiment record contract: `ctx.score()` becomes `ctx.recordScore()`, post-score callbacks are now `afterScores`, retrieval recipe targets use `target.retrievalRecipe()`, decision-report assertions use the singular `decisionReport` namespace, and experiment records now write schema-version 2 `cells` with ordered assertion `outcomes` only.

  Harden Quality determinism by adding explicit cache identity epochs, including structured-output schemas and tool parameter schemas in cassette keys, including case input, prompt, params, dataset content, and scorer identity in output-cache/baseline fingerprints, failing loudly on corrupt committed baselines, and rejecting invalid scorer values instead of aggregating them.

  Make Quality artifact writes atomic and safer under concurrent runs: cassette recording now single-flights duplicate misses, flushes merge with on-disk entries under a lock, timed-out cells quarantine late trace/cassette writes, and local read-model records write via temp-file rename.

  Harden judge-backed scoring by pinning judge generation settings, framing untrusted output/reference/context in judge prompts, stamping judge provenance on score metadata and baseline identity, and adding human-label plus judge-report tooling for judge-vs-human agreement.

  Structured judge inputs are serialized before prompt framing, so Safety's judge-backed constraints can evaluate object-shaped outputs without losing fields or throwing during escaping.

  Harden the Quality local pipeline by making `crux quality run --json` emit a single run summary object, adding worker/core protocol version checks and run-scoped event ids, surfacing worker crashes as structured exit-2 failures, fixing live read-model collisions and source-frame path containment, reporting skipped legacy records, and requiring an explicit devtools promotion variant.

  Quality observability capture now uses an observability-owned hook registry, preserving run-scoped trace capture without importing Node-only Quality internals into platform-neutral runtime bundles.

  Add the Quality machine contract surface: `@use-crux/core/quality/schemas` exports validation schemas and JSON Schema generation for records and CLI JSON, experiment records embed agent-readable `failures` artifacts, and `crux quality diff <expA> <expB> --json` compares saved experiment records through core-owned diff policy.

  Add the Quality adoption path: `crux quality init` scaffolds first evals for uncovered prompt definitions, `crux quality import-traces` converts retained local traces into JSONL dataset rows, and dataset-backed failures now surface dataset path plus content fingerprint in persisted records, run summaries, failure artifacts, and experiment diffs.

  Add the Quality agent loop: `crux quality run` now supports `--failed`, deterministic `--sample`/`--seed`, `--max-cost`, and `--changed-since` subsets, `crux quality mcp` exposes list/run/show/diff/evidence/judge-report/label tools over MCP, and `crux quality init` scaffolds a local Quality skill for coding agents.

  Declare Quality beta: the authoring surface, experiment/manifest schemas, CLI JSON outputs, and exit codes are stable within 0.x minors; future breaking changes require a minor bump and migration note while the first-party runner facade remains internal.

  Finish Quality Project Index parity for beta: native static extraction now treats `afterScores` assertions as evaluation-level `ctx.expect()` sites, evaluation definitions expose catalog facts for devtools chips, spec experiment records enrich `evaluation:*` and covered definitions in the local read model, and `crux quality init` discovers uncovered targets from Project Model evidence before falling back to config exports.

  Complete Quality observability coverage by removing the unused `quality.snapshot` artifact kind, emitting `baseline.promotion` artifacts on successful promotion, emitting diff-mode `comparison.report` artifacts from core experiment diffs, and forwarding `quality diff` events into local activity.

  Make the Quality machine contract operable from the UI: devtools serves `GET /api/quality/judge-report/{evaluationId}` and `GET /api/quality/experiments/diff?a=&b=` (the latter runs the core diff op in a worker), the experiment read model surfaces core-owned `failures` artifacts, and the workbench renders fix-surface chips that deep-link to the covered definition, a Failure Artifact panel with dataset provenance and cassette id, Pass/Fail cell labeling, a judge-trust panel (agreement, confusion matrix, kappa, disagreements), and an experiment Compare picker with a per-score/per-case diff and a drift banner. The TUI shows fix-surface letters on failing cells, the dataset fingerprint, and a CLI hint for the judge-report and diff views.

- Promote Safety to its stable beta boundary model. Guardrails and constraints now author through `{ id, on, run }` with typed `boundary.*` targets, duplicate policy ids fail fast, `safety.tune` controls per-call posture, structured-output rewrites keep returned text/object synchronized, and Safety audit/error/observability records are safe-by-default.

  Streaming guardrails now protect ordinary output streams by default through sentence-gated checks, explicit final/disabled modes, bounded hold behavior, and the AI SDK stream bridge preserves policy-terminal completion errors without unhandled rejections.

  Add the provider-agnostic Safety strategy pack (`guardrail.pii`, `guardrail.secrets`, `guardrail.injection`, `guardrail.classifier`, `constraint.judge`, `constraint.citations`, and `toolPolicy.*`), Project Index Safety facts/lints, Devtools Safety intervention surfacing, and updated docs with migration notes plus beta roadmap RFC links.

- Add the provider-neutral `@use-crux/core/setup` contributor and planner contract
  and the aggregate `crux setup` check/apply/JSON workflow. Runtime setup now
  participates as a contributor through that single setup command.
  Unhealthy reports exit nonzero, contributor failures remain isolated and
  privacy-safe, and apply reports retain planning and adapter-reported failures.

- Add runtime-backed `workspace.watch()` subscriptions for durable create, update, delete, and rename events, including cursor polling, unsubscribe, and transaction-aware event emission.

  Classify `workspace.watch()` as read-style Project Index data access and bump local/indexer cache identities so existing snapshots do not mask the new facts.

  Update local devtools workspace read models so deleted files are removed from the tree and observed rename/move operations update the visible destination path.

  Render `watch` as a recognized read-style Project Index data-access operation in the devtools intelligence panel.

- Harden indexer untrusted-input handling: source-only static syntax planning no longer imports project config, extension loading verifies resolved package identity and containment before import, and source-map disk reads are contained to the project root.

  Preserve semantic source-profile completeness across worker streams so incomplete profiles are not reused through the semantic facts cache, and split Project Index worker transport limits so multi-line fact/artifact streams can exceed the per-line cap without failing.

  Harden Project Index correctness and determinism across patch merging, native/static syntax parity, record-lane extraction, stale provided-record handling, extension diagnostics, and rejected cache reads so cached, incremental, and native-backed runs preserve the same read-model facts.

  Improve Project Index watch latency and live updates with lower save-path debounce windows, exported-interface source hashes that stop body-only edits from cascading to dependents, per-file WebSocket index deltas, cancellable background semantic waves, and watch-run fallback/status telemetry in local devtools. Source rows now include source and interface hash evidence so incremental planning can safely preserve single-file leaf edits across restarts.

  Freeze the indexer stable-beta public surface: `ExtractContext` and extension manifest authoring types now have type-level guards, root syntax-record projection options no longer expose host-only worker controls, host static-index helpers carry those controls through explicit `ForHost` APIs, runtime `use` target matching is data-driven, and docs now mark root/testing/source-resolver/contracts as stable-beta surfaces while keeping extensions experimental and host subpaths Crux-owned.

  Finish stable-beta indexer housekeeping: bump the static, semantic, and Go Project Index cache epochs, store Go snapshot fact caches under epoch-specific directories, align Crux Indexer and Project Index terminology/config docs, and promote the documented stable-beta Index Lint rule set while keeping the remaining rules preview.

  Improve the Rust/Oxc static syntax frontend with `oxc_semantic`-backed scope visibility so match-local initializer resolution respects declaration order and nested shadowing instead of leaking later same-scope bindings. Import-qualified call interests now also resolve through Oxc symbol references so local shadowing cannot be misclassified as a first-party import call. Function return records now resolve direct identifier returns through Oxc binding evidence at record-production time, and the static parse cache epoch is bumped to `static-parse-v53` for the output change.

  Add first-party static golden checks so Rust/Oxc output is compared against the captured Rust-owned golden, and scale the local Rust/Oxc static-index worker pool default to `GOMAXPROCS` while preserving `CRUX_STATIC_INDEX_WORKER_POOL_SIZE` as the explicit tuning override.

  Retire the legacy TypeScript first-party static parser, bundled extractors, bundled lint evaluator, and root in-process project indexing APIs. `@use-crux/indexer` is now the extension-authoring SDK plus Project Index record contracts; bundled first-party extraction and linting are Rust-only binary features owned by Crux Local and the CLI. The TypeScript host remains only for third-party extension contributions and host/config/semantic support lanes.

  Remove the monolithic `compileProjectIndex` host pipeline and syntax-record patch RPC from the TypeScript worker path. Runtime artifact generation now projects supplied native Project Index definitions instead of parsing source in-process, and no-config Quality prompt-test collection no longer falls back to TypeScript source projection.

  Make root/host `createStaticExtraction()` require an explicit syntax frontend, while keeping the TypeScript syntax-record producer as the documented `/testing` fixture default. Fixture traces now report the syntax producer identity used for the run.

  Ship Crux Local platform packages with an enforced Rust/Oxc static-index worker sibling: staged release validation now rejects platform tarballs that omit `bin/crux-static-index-worker` or carry mismatched `os`/`cpu` metadata. The staged `@use-crux/local` manifest injects platform packages as optional dependencies, while committed workspace manifests are guarded against platform optional dependencies so workspace and Karyla installs stay local-path based.

  Run semantic enrichment as shard-local work when the Project Index source graph proves complete shard and dependency evidence. Crux Local now fans semantic requests across a lazy worker pool and merges shard semantic patches without invalidating AST/source facts.

  Move Crux Local incremental watch reindexing onto the production Go to Rust/Oxc Static Index compiler path and remove the TypeScript bundled fallback path. The production watch benchmark now enforces the Tier-A leaf p95 budget on the shipping path.

  Keep source/interface hash evidence consistent across TypeScript and Rust/Oxc static records, including constructor signatures, and bump the static parse cache epoch to refresh stale source-row cache entries.

  Tighten Project Index transport contracts by keeping WebSocket index messages and Rust source snippets on typed payload shapes instead of untyped JSON values.

  Prefer the packaged Rust/Oxc static-index worker for `/testing` fixture extraction when the matching platform package is resolvable, and fully flip the native AST gate to Rust-vs-golden validation with no TypeScript bundled baseline comparison.

  Update Crux Local native build baselines to Go 1.26.4 and Rust 1.96.1, and refresh the Rust/Oxc static syntax frontend dependency identity to Oxc 0.139.

  Align native and semantic definition identity with runtime observability joins: composition definitions now require and use their authored `id`, canonical ids remain byte-identical to the runtime `DefinitionRef` builders, and missing composition ids no longer fall back to a misleading local variable name.

### Fixes

- Promote Safety to its stable beta boundary model. Guardrails and constraints now author through `{ id, on, run }` with typed `boundary.*` targets, duplicate policy ids fail fast, `safety.tune` controls per-call posture, structured-output rewrites keep returned text/object synchronized, and Safety audit/error/observability records are safe-by-default.

  Streaming guardrails now protect ordinary output streams by default through sentence-gated checks, explicit final/disabled modes, bounded hold behavior, and the AI SDK stream bridge preserves policy-terminal completion errors without unhandled rejections.

  Add the provider-agnostic Safety strategy pack (`guardrail.pii`, `guardrail.secrets`, `guardrail.injection`, `guardrail.classifier`, `constraint.judge`, `constraint.citations`, and `toolPolicy.*`), Project Index Safety facts/lints, Devtools Safety intervention surfacing, and updated docs with migration notes plus beta roadmap RFC links.

- Harden indexer untrusted-input handling: source-only static syntax planning no longer imports project config, extension loading verifies resolved package identity and containment before import, and source-map disk reads are contained to the project root.

  Preserve semantic source-profile completeness across worker streams so incomplete profiles are not reused through the semantic facts cache, and split Project Index worker transport limits so multi-line fact/artifact streams can exceed the per-line cap without failing.

  Harden Project Index correctness and determinism across patch merging, native/static syntax parity, record-lane extraction, stale provided-record handling, extension diagnostics, and rejected cache reads so cached, incremental, and native-backed runs preserve the same read-model facts.

  Improve Project Index watch latency and live updates with lower save-path debounce windows, exported-interface source hashes that stop body-only edits from cascading to dependents, per-file WebSocket index deltas, cancellable background semantic waves, and watch-run fallback/status telemetry in local devtools. Source rows now include source and interface hash evidence so incremental planning can safely preserve single-file leaf edits across restarts.

  Freeze the indexer stable-beta public surface: `ExtractContext` and extension manifest authoring types now have type-level guards, root syntax-record projection options no longer expose host-only worker controls, host static-index helpers carry those controls through explicit `ForHost` APIs, runtime `use` target matching is data-driven, and docs now mark root/testing/source-resolver/contracts as stable-beta surfaces while keeping extensions experimental and host subpaths Crux-owned.

  Finish stable-beta indexer housekeeping: bump the static, semantic, and Go Project Index cache epochs, store Go snapshot fact caches under epoch-specific directories, align Crux Indexer and Project Index terminology/config docs, and promote the documented stable-beta Index Lint rule set while keeping the remaining rules preview.

  Improve the Rust/Oxc static syntax frontend with `oxc_semantic`-backed scope visibility so match-local initializer resolution respects declaration order and nested shadowing instead of leaking later same-scope bindings. Import-qualified call interests now also resolve through Oxc symbol references so local shadowing cannot be misclassified as a first-party import call. Function return records now resolve direct identifier returns through Oxc binding evidence at record-production time, and the static parse cache epoch is bumped to `static-parse-v53` for the output change.

  Add first-party static golden checks so Rust/Oxc output is compared against the captured Rust-owned golden, and scale the local Rust/Oxc static-index worker pool default to `GOMAXPROCS` while preserving `CRUX_STATIC_INDEX_WORKER_POOL_SIZE` as the explicit tuning override.

  Retire the legacy TypeScript first-party static parser, bundled extractors, bundled lint evaluator, and root in-process project indexing APIs. `@use-crux/indexer` is now the extension-authoring SDK plus Project Index record contracts; bundled first-party extraction and linting are Rust-only binary features owned by Crux Local and the CLI. The TypeScript host remains only for third-party extension contributions and host/config/semantic support lanes.

  Remove the monolithic `compileProjectIndex` host pipeline and syntax-record patch RPC from the TypeScript worker path. Runtime artifact generation now projects supplied native Project Index definitions instead of parsing source in-process, and no-config Quality prompt-test collection no longer falls back to TypeScript source projection.

  Make root/host `createStaticExtraction()` require an explicit syntax frontend, while keeping the TypeScript syntax-record producer as the documented `/testing` fixture default. Fixture traces now report the syntax producer identity used for the run.

  Ship Crux Local platform packages with an enforced Rust/Oxc static-index worker sibling: staged release validation now rejects platform tarballs that omit `bin/crux-static-index-worker` or carry mismatched `os`/`cpu` metadata. The staged `@use-crux/local` manifest injects platform packages as optional dependencies, while committed workspace manifests are guarded against platform optional dependencies so workspace and Karyla installs stay local-path based.

  Run semantic enrichment as shard-local work when the Project Index source graph proves complete shard and dependency evidence. Crux Local now fans semantic requests across a lazy worker pool and merges shard semantic patches without invalidating AST/source facts.

  Move Crux Local incremental watch reindexing onto the production Go to Rust/Oxc Static Index compiler path and remove the TypeScript bundled fallback path. The production watch benchmark now enforces the Tier-A leaf p95 budget on the shipping path.

  Keep source/interface hash evidence consistent across TypeScript and Rust/Oxc static records, including constructor signatures, and bump the static parse cache epoch to refresh stale source-row cache entries.

  Tighten Project Index transport contracts by keeping WebSocket index messages and Rust source snippets on typed payload shapes instead of untyped JSON values.

  Prefer the packaged Rust/Oxc static-index worker for `/testing` fixture extraction when the matching platform package is resolvable, and fully flip the native AST gate to Rust-vs-golden validation with no TypeScript bundled baseline comparison.

  Update Crux Local native build baselines to Go 1.26.4 and Rust 1.96.1, and refresh the Rust/Oxc static syntax frontend dependency identity to Oxc 0.139.

  Align native and semantic definition identity with runtime observability joins: composition definitions now require and use their authored `id`, canonical ids remain byte-identical to the runtime `DefinitionRef` builders, and missing composition ids no longer fall back to a misleading local variable name.

- Stabilize model routing around `router()`, `split()`, `retry()`, `fallback()`, and `cascade()` wrappers with routing receipts, generate/stream support boundaries, and updated adapter docs.

  Breaking routing API changes: router `.with()` and `.select()` are removed in favor of call-site `routing` and `route` options; variadic `fallback(a, b, opts)` is replaced by `fallback([models], opts)`; `_meta.router` / `_meta.cascade` / `_meta.fallback` are replaced by `result.routing`; native OpenAI, Anthropic, Google, and Convex model options now type-reject routing wrappers instead of accepting unsupported values.

  Extend Project Index routing facts, static extraction, native semantic parity, relation policies, and index lints to cover split routes, retry targets, array-form fallback, call-profile model targets, and RouteArgs callback source refs.

  Surface canonical routing receipts in local devtools run detail and Project Index views, including router defaults, split buckets, retry/fallback attempts, cascade budgets, and receipt-backed Turn Decision Report chips.

  Project Index now shows required `RouteArgs` context types and literal route call-profile parameters. Run Detail renders receipt TTFT, bounded attempt errors, and cascade tier note/budget from the same canonical `routing.report` preview.

  Run Detail now accepts the canonical JSON-safe receipt when unavailable routing costs are serialized as `null`, including nested retry, fallback, and cascade cost fields.

  OpenTelemetry span naming now covers all five canonical `routing.*` primitives and no longer treats the `fallback.attempt` edge/name as a primitive.

- Add runtime-backed `workspace.watch()` subscriptions for durable create, update, delete, and rename events, including cursor polling, unsubscribe, and transaction-aware event emission.

  Classify `workspace.watch()` as read-style Project Index data access and bump local/indexer cache identities so existing snapshots do not mask the new facts.

  Update local devtools workspace read models so deleted files are removed from the tree and observed rename/move operations update the visible destination path.

  Render `watch` as a recognized read-style Project Index data-access operation in the devtools intelligence panel.

- Stabilize the Quality beta API and experiment record contract: `ctx.score()` becomes `ctx.recordScore()`, post-score callbacks are now `afterScores`, retrieval recipe targets use `target.retrievalRecipe()`, decision-report assertions use the singular `decisionReport` namespace, and experiment records now write schema-version 2 `cells` with ordered assertion `outcomes` only.

  Harden Quality determinism by adding explicit cache identity epochs, including structured-output schemas and tool parameter schemas in cassette keys, including case input, prompt, params, dataset content, and scorer identity in output-cache/baseline fingerprints, failing loudly on corrupt committed baselines, and rejecting invalid scorer values instead of aggregating them.

  Make Quality artifact writes atomic and safer under concurrent runs: cassette recording now single-flights duplicate misses, flushes merge with on-disk entries under a lock, timed-out cells quarantine late trace/cassette writes, and local read-model records write via temp-file rename.

  Harden judge-backed scoring by pinning judge generation settings, framing untrusted output/reference/context in judge prompts, stamping judge provenance on score metadata and baseline identity, and adding human-label plus judge-report tooling for judge-vs-human agreement.

  Structured judge inputs are serialized before prompt framing, so Safety's judge-backed constraints can evaluate object-shaped outputs without losing fields or throwing during escaping.

  Harden the Quality local pipeline by making `crux quality run --json` emit a single run summary object, adding worker/core protocol version checks and run-scoped event ids, surfacing worker crashes as structured exit-2 failures, fixing live read-model collisions and source-frame path containment, reporting skipped legacy records, and requiring an explicit devtools promotion variant.

  Quality observability capture now uses an observability-owned hook registry, preserving run-scoped trace capture without importing Node-only Quality internals into platform-neutral runtime bundles.

  Add the Quality machine contract surface: `@use-crux/core/quality/schemas` exports validation schemas and JSON Schema generation for records and CLI JSON, experiment records embed agent-readable `failures` artifacts, and `crux quality diff <expA> <expB> --json` compares saved experiment records through core-owned diff policy.

  Add the Quality adoption path: `crux quality init` scaffolds first evals for uncovered prompt definitions, `crux quality import-traces` converts retained local traces into JSONL dataset rows, and dataset-backed failures now surface dataset path plus content fingerprint in persisted records, run summaries, failure artifacts, and experiment diffs.

  Add the Quality agent loop: `crux quality run` now supports `--failed`, deterministic `--sample`/`--seed`, `--max-cost`, and `--changed-since` subsets, `crux quality mcp` exposes list/run/show/diff/evidence/judge-report/label tools over MCP, and `crux quality init` scaffolds a local Quality skill for coding agents.

  Declare Quality beta: the authoring surface, experiment/manifest schemas, CLI JSON outputs, and exit codes are stable within 0.x minors; future breaking changes require a minor bump and migration note while the first-party runner facade remains internal.

  Finish Quality Project Index parity for beta: native static extraction now treats `afterScores` assertions as evaluation-level `ctx.expect()` sites, evaluation definitions expose catalog facts for devtools chips, spec experiment records enrich `evaluation:*` and covered definitions in the local read model, and `crux quality init` discovers uncovered targets from Project Model evidence before falling back to config exports.

  Complete Quality observability coverage by removing the unused `quality.snapshot` artifact kind, emitting `baseline.promotion` artifacts on successful promotion, emitting diff-mode `comparison.report` artifacts from core experiment diffs, and forwarding `quality diff` events into local activity.

  Make the Quality machine contract operable from the UI: devtools serves `GET /api/quality/judge-report/{evaluationId}` and `GET /api/quality/experiments/diff?a=&b=` (the latter runs the core diff op in a worker), the experiment read model surfaces core-owned `failures` artifacts, and the workbench renders fix-surface chips that deep-link to the covered definition, a Failure Artifact panel with dataset provenance and cassette id, Pass/Fail cell labeling, a judge-trust panel (agreement, confusion matrix, kappa, disagreements), and an experiment Compare picker with a per-score/per-case diff and a drift banner. The TUI shows fix-surface letters on failing cells, the dataset fingerprint, and a CLI hint for the judge-report and diff views.

## 0.4.0-beta.0

### Core stable beta

- Promote `@use-crux/core` composition and adapter contracts to stable beta, documented in `packages/core/STABILITY.md`.

### Breaking changes

- Prompt input now uses parsed Zod output throughout resolution. Defaults and transforms are visible to contexts, gates, tools, memo keys, and prompt callbacks.

  ```ts
  // Before: callbacks could see undefined/raw values after Zod parsing.
  const p = prompt({
    input: z.object({ tone: z.string().default("friendly") }),
  });

  // After: callbacks receive the parsed output.
  p.resolve({ input: {} }); // tone is "friendly"
  ```

- Context resolver memoization and provider prefix caching are separate fields.

  ```ts
  // Before
  context({
    id: "brand",
    system: loadBrand,
    cache: { ttl: 300_000, providerCache: true },
  });

  // After
  context({
    id: "brand",
    system: loadBrand,
    memo: { ttl: 300_000 },
    cache: true,
  });
  ```

- Messages-mode provider adaptations no longer return parallel `system` or `systemBlocks` fields. Adapted system text is folded into `messages`.

  ```ts
  // Before: resolved.system could reappear in messages mode.
  // After: resolved.system is undefined; resolved.messages contains the final system text.
  ```

- Prompt-time tool names must be unique across skills, contexts, contributors, blackboards, and prompt config. Call-site `generate()` / `stream()` tools remain the only override path.

  ```ts
  // Before: some prompt-time tools silently overwrote earlier tools.
  // After: resolution throws and names both owners; pass the override at the call site instead.
  ```

- Prompt content modes are now a compile-time union. `messages` cannot be combined with `system` or `prompt` in typed code.

  ```ts
  // Before
  prompt({ system: "You are concise.", messages: ({ input }) => [] });

  // After
  prompt({
    messages: ({ input }) => [{ role: "system", content: "You are concise." }],
  });
  ```

- Custom prompt composition is consolidated on `contributor()`. The public `injectable()` factory, `InjectableConfig`, `InjectableEntry`, `PromptInjection`, and `ContributorEntry.inject()` are removed. `ContributorContribution` is renamed to `Contribution`, and `AdapterMap` is renamed to `ProviderAdaptations`.

  ```ts
  // Before
  injectable({ id: "account", inject: async () => ({ tools }) });

  // After
  contributor({ id: "account", contribute: async () => ({ tools }) });
  ```

- Portable tool controls now live in `GenerationSettings`. Provider-native AI SDK variants moved to `extra`.

  ```ts
  // Before
  generate(promptDef, { model, stopWhen: aiStopWhen });

  // After, portable
  generate(promptDef, { model, stopWhen: hasToolCall("lookup") });

  // After, AI SDK-native escape hatch
  generate(promptDef, { model, extra: { stopWhen: aiStopWhen } });
  ```

- Provider-cache blocks now form a stable prefix before the uncached tail. Token budgets only drop uncached blocks, and `SystemBlock.cacheBoundary` marks the single native provider-cache breakpoint.

  ```ts
  // Before: priority could drop or reorder any context under budget pressure.
  // After: prompt system -> cached contexts -> uncached contexts; only the tail drops.
  ```

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
