# @use-crux/otel

## 0.8.0

### Minor Changes

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

- 226aa70: Add qualified execution evidence authoring and active-scope inspection, with
  five fixed roles, explicit supersession and conflicts, capture-safe canonical
  graph projection, local idempotent retries, and a provider-neutral readable
  destination query contract. Extend observability schema V5 with protected
  evidence producer provenance, versioned durable content identity, strict
  coverage facts, bounded delivery-conflict correlation, readable payload
  unavailability reasons, terminal-acceptance provenance, and evidence-aware
  transport composition.

  Add a required destination-derived status for every evidence role so complete
  authorized durable summaries remain truthful across unselected roles,
  pagination, payload hydration, and history selection.
  Add the exact complete active relationship count to the same role summary, and
  add bounded positional Local subject-summary and retained-provenance navigation
  reads used by Devtools and agent-facing Local clients.

  Add durable Local evidence inspection, payload and relationship retention,
  coverage projection, restart-safe idempotency, and explicit privacy deletion.
  Late evidence that references explicitly deleted private state is permanently
  rejected without restoring relationships, payloads, staging candidates, or
  coverage.
  Startup now backfills reconstructable approval-artifact privacy selectors and
  converts legacy identity-only retained state into private resurrection guards,
  so delayed approval retries fail closed without restoring retained-out data.

  Discover canonical authored `evidence.record()` calls in the Project Index
  without retaining private authored values, diagnose invalid literal evidence
  kinds, and publish an exhaustive generated primitive evidence-coverage audit.

  Add first-party native evidence bindings that reuse privacy-processed
  observability artifacts through a package-private capability. Delivery retries
  of one artifact relationship retain one evidence identity; separate native
  artifact occurrences remain separate claims unless their domain defines an
  explicit stable occurrence identity. Native Workspace, Memory, Plan, and Task
  mutations now author exact change evidence, while capture-safe tool arguments
  author intent for their exact tool call. Tool approval requests and valid final
  decisions author authority evidence with explicit supersession and exact
  attempt/resume provenance. Native producers do not infer verification or
  recovery.

  Custom Effects now contribute receipt-safe intent and change evidence
  automatically. Recovery attempts contribute their own receipt evidence and
  link recovery outcomes to the original receipt without exposing execution or
  recovery state.

  Project qualified evidence to dedicated closed OpenTelemetry events. Evidence
  relationships, coverage, and coverage conflicts export only approved bounded
  correlation fields; payloads, graph endpoints, producer identity, digests,
  supersession, markers, and raw custom evidence kinds never enter generic OTel
  edge, artifact, or event projections.

  Add an execution-evidence Devtools view and Catalog authoring presentation over
  the same canonical Local read model, including complete five-role status,
  conflicts, history, late provenance, payload availability, related-subject
  counts, and retained producer/source navigation. Document automatic versus
  custom authoring, Local retention and privacy behavior, exact OTel allowlists,
  and every user-visible evidence error or delivery disposition.

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

### Minor Changes

- 69564b7: Memory capture now follows the active execution lifecycle automatically.

  Capture modes are now `inline | deferred`, with `deferred` as the default. Deferred capture uses the shared `config({ host })` retention binding; when retention is unavailable, Crux safely captures inline and emits one development warning instead of losing work. Retained failures remain observable through `memory.flush()`.

  Adapters submit one completed turn and leave mode selection, deterministic tool-event fan-out, settlement, and block flushing to memory. Catalog exposes the effective configured mode, while Runs records one payload-free `memory.capture` lifecycle inside the owning generation Run with the actual inline, fallback, retained, or Eval-captured disposition.

  Migrate `afterResponse` to `deferred`, replace `detached` with `deferred`, and remove memory-specific `capture.waitUntil` in favor of a shared host binding.

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

### Minor Changes

- e24f46c: Add portable MCP tool sources over Streamable HTTP and stdio. MCP tools now
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

### Patch Changes

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

- 37ebe22: Promote `@use-crux/core/observability`, `@use-crux/otel`, and the local Go observability read model to stable beta, replacing process-local reliability assumptions with an explicit multi-invocation contract. See ADR 0002 for the full rationale.

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

- 58edfa9: Adopt parsed Zod input throughout prompt resolution, run `sanitize` before top-level auto-escape, warn when nested string input cannot be auto-escaped, and collect nested `when()`/`match()`/contributor schemas consistently for prompt input validation.

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

### Patch Changes

- 64a716b: Stabilize model routing around `router()`, `split()`, `retry()`, `fallback()`, and `cascade()` wrappers with routing receipts, generate/stream support boundaries, and updated adapter docs.

  Breaking routing API changes: router `.with()` and `.select()` are removed in favor of call-site `routing` and `route` options; variadic `fallback(a, b, opts)` is replaced by `fallback([models], opts)`; `_meta.router` / `_meta.cascade` / `_meta.fallback` are replaced by `result.routing`; native OpenAI, Anthropic, Google, and Convex model options now type-reject routing wrappers instead of accepting unsupported values.

  Extend Project Index routing facts, static extraction, native semantic parity, relation policies, and index lints to cover split routes, retry targets, array-form fallback, call-profile model targets, and RouteArgs callback source refs.

  Surface canonical routing receipts in local devtools run detail and Project Index views, including router defaults, split buckets, retry/fallback attempts, cascade budgets, and receipt-backed Turn Decision Report chips.

  Project Index now shows required `RouteArgs` context types and literal route call-profile parameters. Run Detail renders receipt TTFT, bounded attempt errors, and cascade tier note/budget from the same canonical `routing.report` preview.

  Run Detail now accepts the canonical JSON-safe receipt when unavailable routing costs are serialized as `null`, including nested retry, fallback, and cascade cost fields.

  OpenTelemetry span naming now covers all five canonical `routing.*` primitives and no longer treats the `fallback.attempt` edge/name as a primitive.

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
