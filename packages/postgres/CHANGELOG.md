# @use-crux/postgres

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

- c090b22: Add the `@use-crux/core/effect` surface for typed effects, immutable receipts,
  individual recovery, automatic and delayed rollback, honest ambiguity
  reconciliation, receipt-safe evidence, and canonical observability records.

  Persist Effect receipts, scopes, recovery units, attempts, and envelopes through
  a Runtime store Effects port. Restart-safe reconstruction rebuilds the exact
  reverse recovery plan and stable recovery idempotency keys. Crash windows
  surface prepared work for reconciliation, project interrupted running work as
  unknown, and reject stale fenced writers so only one concurrent terminal
  transition commits. The external Runtime worker now discovers interrupted
  rollback scopes, acquires expiring fenced claims, and executes the exact
  store-reconstructed plan with stable recovery idempotency keys. A replacement
  worker can reclaim work after process loss without allowing a superseded holder
  to settle stale writes.

  Declare immutable Effect recovery targets on `createRuntimeProgram({
effectTargets })`. Generated Next, Convex, and Cloudflare hosts bind those
  targets. Missing or version-mismatched cold targets settle as
  `handler_unavailable`. A recoverable Effect without a program declaration stays
  callable and recovers through its live definition in the same process.
  Worker recovery resolves handlers only from this immutable program table and
  does not silently retry crash-ambiguous recovery attempts.

  Ship PostgreSQL and Convex durable Effects adapters behind a shared conformance
  matrix. Convex supports per-operation atomicity, crash fencing, and
  reconstruction, and declares multi-operation `transact()` callbacks unsupported.
  Bounded `effectEnvelopes` retention expires recovery envelopes while keeping
  receipt and audit metadata. Sealed request and tool-outcome linkage attach only
  in journaled contexts.

  Discover Effect definitions in the Project Index and surface their authored
  identity and recovery configuration in Catalog, alongside receipt, outcome,
  recovery-link, and ambiguity evidence in Devtools Runs. Report
  `effect.recovery_not_runtime_addressable` when an unexported recoverable Effect
  is statically visible at a required recovery boundary under Runtime-backed
  configuration, and
  `effect.irreversible_in_required_boundary` when an irreversible Effect is
  certainly called inside a required-recovery `rollbackOnError()` boundary.

  Make exported Effect definitions eligible for the language server's generic
  completion candidate pipeline while retaining kind-generic hover titles and
  duplicate-identity diagnostics.

  Make flow runs and pipeline, agent, and composition roots passive rollback
  boundaries. Their results expose Effect scope references, and flows can
  explicitly recover completed units through `flow.rollback()`.

  Work and Session turn Effect scopes keep the admission identity through
  execution. `work.cancel()` and ownership detach fence execution without
  rolling back completed external Effects; recovery stays an explicit
  `rollback()` / `recover()` / worker policy choice. Detached ownership
  (`explicit` or `owner-ended`) preserves receipts and recovery access without
  reparenting the Effect scope, and ambiguous outcomes remain reconcilable.

  Add an internal audit-first native Effect contract so first-party domains can
  contribute receipts, evidence, and Effect facets on their existing spans while
  reporting unavailable or irreversible recovery honestly.

  Export Effect spans through the OpenTelemetry adapter with the canonical
  `crux.effect.run` span name.

- d172b05: Add typed process-local Signals with Standard Schema normalization, predicate
  and recursive match identities, idempotent publication, isolated callbacks,
  and explicit process-local acceptance receipts. Declared Flow Signal sources
  now support typed `flow.waitFor(signal)` suspension, capability-gated durable
  acceptance, atomic occurrence/delivery commits, restart recovery, stable
  at-least-once delivery identity, and payload-safe idempotent replay after
  consumer completion. Runtime adapters remain source-compatible through an
  optional Signal-record port; durable bindings reject capability preflight when
  that port or a durable storage declaration is absent. Flow delivery retries now
  rotate replay/observability snapshots atomically with the retry work and outbox.

  Harden durable delivery against concurrent manual resumes and predicate
  evaluation races. Manual resume now arbitrates atomically with armed waiters
  and timers, busy in-process wakes remain retryable, predicate waits retain one
  durable binding with a FIFO occurrence queue, and retry snapshots preserve
  newly observed replay fingerprints and concurrently accepted candidates.
  Persist Signal payloads through a lossless codec that preserves negative zero
  and returns detached, deeply frozen occurrences. Eval execution rejects
  durable reactive dispatch before allocation while retaining process-local
  publication. Reactive adapter conformance now requires deterministic
  transaction-abort injection and verifies rollback across every write boundary,
  including multiple required deliveries.

  Signal-driven Flow resumes retain the same in-process Effects scope reference
  across suspension snapshots without claiming cross-process Effects recovery.

  Document the shipped surface with a progressive Signals guide, copy-pasteable
  current-API recipes, exact Signal and Flow-wait reference pages, public JSDoc,
  and provider-neutral architecture guidance. The documentation distinguishes
  process-local acceptance, certified durable delivery, consumer completion,
  and a persisted Effect scope reference from restart-safe recovery.

  Require cryptographically secure occurrence identities for durable
  publication while retaining a process-local fallback, isolate mutable
  acceptance timestamps across receipts, records, and listeners, and trim the
  Runtime Signal adapter contract to the occurrence and Flow-delivery surface
  actually shipped. Add an exact adapter reference for records, payload codecs,
  named composites, durability declarations, and required reactive conformance.

  Complete the pre-launch alpha Runtime Engine queue-record migration. Use
  `RuntimeWorkItem` for queue records and `RuntimeWorkState` for their lifecycle;
  `WorkItem` and `WorkStatus` are removed. Adapter declaration merging targets
  `RuntimeWorkItem` directly through `@use-crux/core/runtime`.

  Add inert Runtime managed-transport declarations and pure validation for
  provider-neutral bindings and accepted envelopes.

  Add immutable `RuntimeProgram` construction with canonical manifest hashes,
  shared Runtime target normalization, and managed-binding resolution and
  compatibility diagnostics for generated and hand-written hosts. Agent
  definitions are first-class immutable program targets resolved by the same
  worker target path as Flows and tasks.

  Generate a freshness-bound Runtime program and add `crux runtime worker` for
  one configured Node/PostgreSQL execution worker with durable ownership and
  bounded signal shutdown.

  Write the generated Next.js Runtime entry to `crux/generated/next.ts` so
  framework-facing generated source uses a conventional directory hierarchy.

  Ensure an interrupted Runtime worker exits cleanly even while its configured
  host is still loading.

  Give Runtime worker ownership conflicts and shutdown timeouts distinct public
  error codes. PostgreSQL workers now reject undersized pools, terminate when
  their advisory-lock connection is lost, and verify that lock release succeeds.

  Add the canonical public, Flow-targeted Work contract with exact input/result
  inference, string Work IDs, result-generic handles, safe readonly lifecycle
  snapshots, typed terminal errors, and canonical control and observability
  types. The typed `spawn()` and `getWork()` factories accept only exported Flow
  targets. `createWorkHost({ runtime, program })` binds generated immutable target
  metadata to application requests and atomically accepts memory-backed Work,
  its initial Flow snapshot, pinned normalized input and definition, result
  obligation, and wake outbox row. Compatible idempotent retries reconnect the
  same Work, conflicting input rejects, target namespaces remain independent,
  and `getWork()` validates the exported target. Process-local Agent Work uses
  the shared safe lifecycle and control types privately without promoting its
  retained-owner registry to storage.

  Execute accepted application Flow Work through the generated Runtime worker
  and publish its canonical write-once result reference with the existing fenced
  terminal commit. `WorkHandle.result()` now joins the exact inferred output from
  both original and reconnected handles, duplicate wakes retain one terminal
  result, Runtime Flow suspension preserves the pinned definition/result
  obligation through resume, and terminal Work failures persist only safe public
  summaries. Durable Work now supports bounded latest progress, cooperative
  idempotent cancellation, ownership-only detachment, safe cursor-resumable event
  streams, and restart-safe owner-scoped statistics through the existing Runtime
  state machine, cancellation composite, durable event port, and statistics
  ledger.

  PostgreSQL Runtime storage now persists the pinned Work result obligation and
  content-addressed terminal result, safe control metadata, and statistics ledger
  export. Independent application hosts can reconnect
  after worker restart and read the exact typed Flow result. Referenced payloads
  survive retention pruning; missing payloads raise `WorkResultExpiredError`
  without re-enqueuing or re-executing Work.

  Convex Runtime storage now persists the pinned Work definition and result
  obligation with content-addressed terminal results and safe Work control
  metadata. Independent application
  hosts reconnect after worker restart, duplicate wakes preserve the first result,
  and expired payloads raise `WorkResultExpiredError` without re-executing Work.

  Persist a canonical accepted-input digest across Memory, PostgreSQL, and Convex
  snapshots. Runtime inspection and Devtools now show safe Work identity,
  definition and Effect scope, ownership, result lineage, statistics, progress,
  and bounded lifecycle events without exposing input or result payloads.

  Add the provider-neutral `GenerationModel` contract and adapter-authoring
  construction seam. Agents now retain their exact model type, while Sessions
  require a bound model only when the Agent does not already carry one and reject
  statically proven capability gaps without excluding broad preflight evidence.

  Add `@use-crux/ai`'s `aiSdk(native)` binding: one argument produces a frozen
  adapter-bound `GenerationModel` with secret-free definition identity, complete
  capability evidence, and an opaque runtime port that constructs an
  `AgentExecutor` through the existing AI provider runtime without global config.
  Same-adapter routers may be bound once. `stableModel()` is removed with no
  alias or deprecation layer; Eval identity now projects bound GenerationModel
  values.

  Sessions now preserve every accepted Agent input and handle independently while
  claiming the longest cursor-consecutive compatible prefix into one canonical
  activation Work. `sendMany()` retains atomic cursor order, coalesced handles
  resolve their shared Work through `work()`, and all joined inputs reconnect to
  the same exact terminal result or failure. A bound Session override must be
  declared by the RuntimeProgram or fails before mutation with
  `GENERATION_MODEL_NOT_STATIC`; missing bindings and capability preflight retain
  their existing distinct errors.

  Session turns now retain restart-safe execution checkpoints, allowing safe
  recovery across owner Thread publication without rerunning generation. Session
  diagnostics expose structured, payload-safe failures alongside compact status
  and bounded lifetime turn statistics. Compatible input accepted during a model
  step is independently resolved and enters the next real provider boundary
  before `prepareStep`; terminal-step ingress begins a new activation through an
  atomic lost-wake fence. Inspection reports bounded per-input claim, delivery,
  shared Work, checkpoint, and exact Thread basis evidence without payloads.
  Session input admission dispatches through the provider-neutral
  `session.inputs.accept` composite so adapters can validate keyed identity,
  append ordered ingress, reserve one canonical Work, and persist its wake in one
  transaction.

  Expose the provider-neutral Session step-boundary hook through adapter authoring.

  Export a provider-neutral Session conformance factory from
  `@use-crux/core/runtime/testing` so storage adapters can prove the same keyed
  identity, ordered Work linkage, checkpoint replay, exact terminal result,
  bounded inspection, and structured capability laws.

  Expose the internal Session-store statistics ledger helpers for durable Runtime
  adapters.

  Expose payload-safe Session identity, state, bounded turn-to-Work lineage,
  Thread revision, checkpoint/recovery evidence, and lifetime statistics through
  the existing Runtime Bridge and `session.turn` observability records. The
  embedded Devtools Catalog shows authored Session target/key evidence, while Run
  details render the same operational projection without execution payloads.

  PostgreSQL Runtime storage now persists normalized Session identity, ordered
  ingress, activation linkage, delivery evidence, prepared execution checkpoints,
  and bounded lifetime statistics through the same atomic Runtime composites as
  memory. Independent hosts and workers can reconnect through one database
  namespace, replay owner-Thread publication without duplicate receipts, and
  retain prepared Session evidence during unreferenced-result pruning.

  Convex Runtime storage now persists the same normalized Session contract in its
  atomic component transactions. Reconstructed hosts and workers retain exact
  results, replay checkpointed owner-Thread publication without duplicate
  receipts, and preserve Session evidence during result pruning.

  Project Index now records authored Session identity, literal key, source, and
  resolved Agent target evidence with matching static and semantic backend
  output.

  Project Index and Local editor diagnostics now reject unproven Session
  identity and Agent targets, ambiguous construction, non-owner Thread mutation,
  and accidental concrete-Agent Thread tenancy with structured evidence.

  Generated Runtime Programs now import exported Agent definitions and pin their
  Project Index fingerprints through the existing Runtime target authority.

  Add provider-neutral Signal provider webhook authoring through
  `webhook({ handle })` and `signalProvider({ id, transport, signals, onEvent })`
  on `@use-crux/core/signal/transport` and `@use-crux/core/signal/provider`. Live
  definitions stay frozen process code; inert
  `RuntimeManagedTransportBinding` projections never capture credentials, live
  clients, Requests, or callbacks. Durable transport envelope acceptance is
  idempotent by Runtime namespace plus provider/account/event identity, conflicts
  on digest mismatch, and is safe to acknowledge only after commit. Restart-safe
  normalization claims accepted envelopes, scopes provider `signals.publish` to
  the accepted provider/account/event identity when an explicit idempotency key is
  omitted so crash recovery after publication cannot create a second logical
  delivery, runs provider `onEvent` through the existing Signal publication path,
  completes idempotently, dead-letters after bounded retry, and returns
  dead-lettered envelopes to accepted state on explicit replay. Memory and
  PostgreSQL Runtime stores implement the transport port with shared conformance.
  RuntimeProgram validation treats Signal transport targets as Signal ids rather
  than Agent/Flow/task targets. Normalization is restart-safe through the shared transport kernel. The existing
  Runtime worker now claims a bounded batch of accepted envelopes on each
  maintenance tick and invokes provider `onEvent` through that kernel using
  explicitly imported executable providers on `RuntimeProgram` (`providers`),
  resolved by one deterministic stable provider/adapter/binding identity rule
  shared with program validation. When those identity keys resolve to different
  executable providers, construction and worker start reject the ambiguity rather
  than silently choosing an order. Inert
  `RuntimeManagedTransportBinding` declarations and the program manifest hash
  remain secret-free: no Request, credential, client, socket, callback, or live
  provider object is stored in bindings. Missing or mismatched provider
  identities, and programs that declare managed transports against a store without
  the optional transports capability, fail before worker start with Runtime
  diagnostics. Provider-event-scoped publication
  idempotency is preserved so crash recovery after publish cannot create a second
  logical delivery. Hosts may still call the normalization runner directly; no
  second worker, queue, daemon, scheduler, effect scope, or transport lifecycle is
  introduced. Provider Signal maps use a structural member bound plus a
  self-constraint so concrete `Signal<literal, schema>` values keep exact per-key
  payload inference across TypeScript 5.5+, 6.0, and TypeScript-Go preview without
  accepting non-Signal map values.

  Project Index now discovers authored `signal()`, `webhook()`,
  `signalProvider()`, and `managedTransportBinding()` declarations with
  config-ref and Signal-target lineage, and generates one Runtime program that
  statically imports executable providers plus inert bindings into
  `createRuntimeProgram({ targets, generationModels, providers, transports })`.
  Local worker loading rejects non-empty transports without matching generated
  provider authority before worker start. Built-in diagnostics reject unstable
  provider or binding identities and explicit live Request/client/credential/
  socket/callback fields on inert bindings. Devtools Catalog surfaces provider
  and transport-binding evidence without credentials or raw payloads.

  Complete the Signal tooling contract with canonical provider, transport, and
  Signal lineage across both static frontends, partial Signal identity evidence,
  executable lint parity fixtures, and selectable Devtools lineage. Runtime
  artifact manifests now use schema version 3 so older generated manifests fail
  with an explicit incompatibility diagnostic, while generated imports and worker
  transport authority remain exact under path escaping and source drift.

  Close out Signal provider operations with restart-safe bounded transport
  statistics on the shared statistics ledger (`transport` owner; exact totals and
  first-64 structured adapter/binding attribution), bounded Signal occurrence
  lineage on normalized envelopes with a payload-free truncation indicator,
  privacy-safe `projectTransportEnvelope()` and `transportStatistics()` APIs, and
  terminal envelope retention through existing Runtime maintenance
  (`transportEnvelopes`, default `7d`). Memory and PostgreSQL persist statistics
  and lineage with the transport port; PostgreSQL serializes namespace statistics
  updates and reports prune `truncated` only when eligible rows remain. Document
  the webhook path with a progressive provider guide, operator recipes, exact
  providers/transports reference, and ARCHITECTURE internals.

  Add the first managed-transport supervision vertical for polling: `polling()`
  authoring beside `webhook()`, `signalProvider` transport union, durable binding
  cursor checkpoints on the transport store (Memory + PostgreSQL), and single
  Runtime worker acquisition that leases each polling binding, polls once per
  tick, accepts events through the existing envelope kernel, and checkpoints
  `nextCursor` only after the full batch is durably accepted. Checkpoint writes
  are lease-fenced: `putBindingCheckpoint` requires the active binding lease
  owner/token and returns `accepted` or `rejected`; Memory and PostgreSQL
  atomically reject stale, incorrect, or expired fences (including when no
  checkpoint row exists), and supervision drops the held lease when a write is
  rejected. Optional `PollResult.more` skips `intervalMs` once after acceptance;
  poll failures keep the previous cursor and a safe `lastErrorCode`. Managed
  polling treats `TransportEnvelopeConflictError` as progressable only when the
  shared envelope store still holds durable identity evidence for that event
  (accepted/claimed/normalized/dead-letter), so a conflicting redelivery cannot
  poison the provider cursor; other accept failures retain fail-without-checkpoint
  semantics and no parallel dead-letter store is introduced. Competing
  supervisors coordinate through Runtime leases; worker stop aborts in-flight
  polls and releases binding leases. Project Index discovers `polling()` with static/native
  parity and rejects live `poll` fields on inert bindings. Generic stream, managed SSE, and managed
  WebSocket authoring ship below on the same lifecycle seam. Channel exclusive
  conversation ownership remains #302.

  Add managed stream transport supervision beside polling: author `stream({ open })`
  on `@use-crux/core/signal/transport`, accept it from `signalProvider`, and let the
  single Runtime worker own connection fibers, bounded reconnect, accept-before-
  checkpoint cursor law, config-ref invalidation, and durable faulted/disabled
  status on binding checkpoints. Memory and PostgreSQL implement lease-fenced
  checkpoint fields (`configRef`, `status`) with multi-worker exclusivity.
  Project Index discovers `stream()` with static/native parity and rejects live
  `open` on inert bindings. Managed SSE (`sse({ open })`) and WebSocket
  (`websocket({ open })`) ship as thin adapters over this seam below. Stream
  envelope validation detaches immutable
  payload and routing snapshots; digest conflicts never advance stream cursors;
  checkpoint timestamps use a fresh clock at each write; and supervision faults
  after consecutive top-level rejected stream fibers with
  `TRANSPORT_STREAM_EXHAUSTED` without unhandled rejections.

  Add first-party managed SSE transport authoring as a thin adapter over the
  existing stream supervision seam: `sse({ open })` freezes a distinct
  `kind: "sse"` definition with `lastEventId` item vocabulary, pure
  `classifySseHttpStatus` / `sseHttpStatusErrorCode` helpers for connect failures,
  and Runtime lowering onto the managed stream fiber (same lease, checkpoint,
  reconnect, fault, abort, and accept-before-cursor laws). Project Index and
  Devtools Catalog project `transportKind: "sse"`; live `open` on inert bindings
  stays rejected. This is provider-ingress SSE only — distinct from
  `@use-crux/react` browser `createSSETransport` / `cruxSSEHandler`.

  Add first-party managed WebSocket transport authoring as a thin adapter over the
  same stream supervision seam: `websocket({ open })` freezes a distinct
  `kind: "websocket"` definition, pure close-code helpers, and
  `createBoundedPushBuffer` so push sockets never silently drop (overflow closes
  and reconnects from the durable cursor). Optional process-local
  `acknowledge` on envelope items runs only after durable #337 accept and cursor
  checkpoint; ack failure is observable (`TRANSPORT_ACK_FAILED` / safe provider
  code) and transient, and never rolls back acceptance or clears the cursor.
  Project Index and Devtools Catalog project `transportKind: "websocket"`; live
  `open` on inert bindings stays rejected.

  Document durable Agent Sessions with a progressive guide, copy-pasteable
  recipes, exact Session and GenerationModel API reference pages, Session
  structured error pages, AI adapter `aiSdk(native)` binding docs, Runtime program
  `generationModels` reference, and Core architecture internals. Docs distinguish
  durable Agent Sessions from overloaded "session" vocabulary elsewhere and
  require PostgreSQL Runtime storage plus the Session-owned Thread RecordStore on
  the same database.

  Extend durable Sessions to first-party Flow targets with exact
  Agent-versus-Flow conditional typing for `session()` / `getSession()`, pinned
  Flow definition metadata, and optional GenerationModel only for Agent Sessions.
  Flow Session activation reuses the canonical `flow.resume` Work spine, owner
  Thread registration, and Work result handles. Durable Signal subscriptions are
  idempotent Session-owned transitions reconstructed from storage and participate
  in Signal publication fan-out with restart-safe per-subscription delivery
  identities. Session-owned Flow waiters receive durable Signal delivery only when
  a matching active Session subscription also matches the payload; non-Session
  Flow waiters remain an independent consumer. Memory, PostgreSQL, and Convex use
  one canonical subscription match-key codec for upsert idempotency and delivery
  matching, including key-order-invariant match data.

  Add production Session lifecycle controls on the same Thread owner registry and
  Runtime Work spine: joinable `close()` that deactivates Signal subscriptions at
  the barrier and drains currently represented pending-input/work/activation
  obligations (not a full nested causal Work tree), fenced `kill()` that revokes
  claim/checkpoint/start and closed-owner Thread commit authority, retention-safe
  `delete()` that unregisters owners only after closed/killed tombstones, and
  `fork()`/`clone()` that register the child owner/head pin before the Session
  fork record. Keyed recreation after delete is rejected. Memory, PostgreSQL, and
  Convex implement the lifecycle ports and shared conformance laws.

  Complete dynamic Signal ingress for Agent Sessions on the existing Session
  input lane, preparation journal, and one Runtime worker: durable Agent
  `subscribe()`/`subscriptions()`, independent fan-out with
  Session-subscription delivery identity deduplication, parked-turn activation
  and mid-turn deferral until the next declared safe boundary, cursor-resumable
  bounded `session.stream()` state/event records with stable expired-cursor
  snapshots, and restart-safe owner `session.stats()` aggregates that extend the
  shared statistics ledger with exact accepted/deduplicated/delivered/resumed/
  dropped totals plus first-64 identity coverage linked to canonical Work stats.
  Missing Agent targets on temporary publish dispatchers requeue
  `session.signal-ingress` Work with outbox backoff (no terminal idempotency);
  the program worker settles once. Boundary settlement lists pending ingress via
  targeted `listWork({ kind, sessionId })` so unrelated Work cannot starve a
  Session (Memory, PostgreSQL, and Convex). Concurrent worker and step-boundary
  settlement is atomic via delivery compare-and-set (`pending → leased →
terminal`) and idempotent `acceptInputs` for stable `inputIds` (no double
  cursor/pending/stats; PostgreSQL uses `ON CONFLICT DO NOTHING`). Boundary
  scans prefer pending Session deliveries and retire residual ingress Work after
  terminal deliveries so the settle budget is not spent on already-settled rows.

  Complete Session tooling, observability, and documentation on the same runtime
  facts: Project Index static and semantic evidence for Agent/Flow Session
  targets, Signal subscription lineage, and observed public method usage with
  exact JS/native parity and cache-epoch migration; LSP/lint copy that accepts
  resolved Agent or Flow targets; Devtools Catalog and `session.turn` detail for
  targets, subscriptions, fork lineage, and bounded ingress statistics via the
  existing Runtime Bridge read model; progressive user guides, recipes, exact API
  reference, and Core architecture internals that distinguish shipped Session
  behavior from future managed transport and Channel work.

  Close managed-transport observability on the same durable Runtime facts:
  `transportBindingHealth()` projects a bounded (max 64), secret-free per-binding
  health snapshot from program identity, binding checkpoints, and the existing
  transport statistics ledger without a second worker, registry, or metrics store.
  Coverage markers report last-owner lease diagnostics, cursor presence/age,
  fault/reconnect exhaustion when durable, and explicitly unavailable live
  reconnect backoff, provider lag, and shutdown outcome. Accept/normalize emit
  payload-free envelope lineage through the existing observability transport for
  Devtools Run detail; Runtime status provides transport-health data when a
  generated program is present, and Devtools renders that data in a Transports
  tab. Progressive guides, recipes, API reference, and architecture docs cover
  statistics and health semantics for operators, including troubleshooting
  coverage markers, shutdown/recovery, and Convex's honest rejection of
  managed-transport accept/checkpoint capabilities.

  Add process-local Agent Work handles with Agent-only `send()` on the shared
  Work lifecycle. `createAgentWorkHost({ executor })` and `spawn(agent, input)`
  return `AgentWorkHandle` without claiming cross-request durability. Agent-tool
  occurrence identity reconnects provider/adapter retries instead of double-
  starting children, and conflicting reuse rejects. Steering accepts canonical
  string or multimodal content, is ordered and payload-safe in identity records,
  and delivers only at the next semantic provider-step boundary without changing
  tools or guardrails. The automatic model-facing `work` tool gains `send` for
  Agent children only while retaining a stable schema.

### Patch Changes

- 306b205: Preserve the original backend cause on PostgreSQL storage `StorageError`s.
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

### Minor Changes

- 0c3ba08: Add request-scoped `defer(callback)` with bounded host-lifetime execution, the
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

- 74f27bf: Promote `@use-crux/core/runtime` and its store-adapter contract to stable beta while Crux remains pre-1.0.

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
