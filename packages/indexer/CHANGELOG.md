# @use-crux/indexer

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

- 9418f19: Add provider-neutral model capacity profiles, conservative unknown-model
  fallbacks, and an optional authoritative token-counting adapter port. All
  first-party language adapters can report the context window, default output
  reserve, and counting confidence used for whole-request budget derivation.

  Plan every Core-owned language request against model capacity before dispatch.
  Add per-call `inputBudget` settings, typed pre-dispatch composition failures,
  and linked JSON-safe request receipts with redacted token breakdowns on
  generation and stream steps. Adapters may report transport retries for the
  same sealed request so live receipt inspection can expose the retry count.

  Apply the same measure-plan-seal contract to every semantic provider call in
  AI SDK-owned loops, including tool steps, structured retries, and streams.
  Loop runtimes now declare and invoke an awaited per-step planning boundary.

  Remove the narrow `tokenBudget` resolver and adapter option. Migrate managed
  calls to `inputBudget`, which measures the complete provider request and never
  silently drops exact context contributions. Prompt resolution now retains all
  exact contexts; representation wrappers authorize future lossy alternatives.
  Resolver-only Convex lifecycle budget fields are removed as well.

  Add stateless, causal-group-safe `history.recent()` projection for complete
  caller-owned transcripts across Core-owned and SDK-owned language loops.
  Message and token caps retain leading system directives, keep Tool lifecycles
  atomic, and receipt soft-cap boundary adjustments. Bare exact history now
  warns predictively near its optimization watermark and points to
  `history.recent()` or managed `history()` before an oversized request is
  dispatched.

  Remove the stateful MemoryBlock `recentMessages()` API and the stateful
  `createSlidingWindow()` compaction helper. Use `history.recent()` for a
  stateless exact-history suffix; managed summary artifacts will be provided by
  the context-planning history surface. The Convex memory profile mirrors the
  MemoryBlock removal.

  Add type-safe request representation ladders with `prefer()`, `summarizable()`,
  `offloadable()`, and terminal `droppable()` composition. Authored alternatives
  now participate in deterministic two-tier whole-request selection, retain the
  canonical source's capabilities, remain monotonic within a concrete-model
  epoch, and expose every selected alternative or omission in request receipts.
  Generated-summary and exact-recovery rungs fail explicitly until their backing
  artifacts are prepared.
  Contributor-backed representation sources now preserve their input schema for
  authored alternatives, and malformed Contributor-tagged wrapper inputs fail at
  construction.

  Add managed `history()` with derived recent-history defaults, adaptive,
  regenerating, rolling, and hierarchical summary strategies, content-addressed
  summary artifacts, concurrent preparation deduplication, stale-while-revalidate
  reuse, and explicit inline, recent-only, or fail miss behavior. Summary
  maintenance uses the configured request-retention host without delaying the
  accepted response, every bounded support call is linked through receipt
  inspection, and `providerNative: false` forces portable Core lowering.

  Remove the `@use-crux/core/compaction` subpath and its legacy
  `summarizeMessages()`, `compactConversation()`, `createBudgetManager()`, and
  `extractKeyFacts()` helpers. Use managed `history()` for adaptive conversation
  projection and provider-neutral generation function types from
  `@use-crux/core`. The Convex package no longer mirrors
  `compactConversation()`.

  Activate generated-summary and exact-recovery rungs for non-history sources.
  `summarizable()` now uses content-addressed derived artifacts, while
  `offloadable()` and forced `offload()` publish opaque owner-scoped references
  with a required, budgeted retrieval Tool. Tool definitions may declare
  `output: offloadable({ aboveTokens })` so large canonical results are retained
  exactly while execution evidence distinguishes the application output from
  the model-facing reference. Persistence configuration may provide an existing
  asset store so already-addressable asset bytes are reused.

  Add `prepareStep` to managed language generation and Agent definitions. Each
  semantic provider call can inspect immutable input, transcript, Tool history,
  minimal honest usage statistics, prior request evidence, and declared
  `workingState()` or Blackboard resources before returning a constrained
  boundary-local contributor, Tool, model, or input-budget amendment. Accepted
  decisions are committed with redacted resource revision evidence before
  dispatch and reused by exact transport retries.

  Add `prepareInvocation` to Pipeline, Parallel, Consensus, and Swarm
  compositions. Each managed child receives a fresh composition-typed,
  resource-pinned preparation boundary whose amendment becomes the child
  baseline beneath per-provider-call `prepareStep` decisions. Composition
  results expose a causal tree of ordered child request receipts, and
  operation-narrowed amendment types reject language-only facets for other
  managed operation families.

  Add observational `preview()` for Prompt and Agent requests. Preview reports
  `fits`, `over-limit`, or `unknown` with redacted prospective adaptations and
  never executes providers, Tools, representation preparation, publication,
  maintenance, or canonical-state writes. Executed request receipts now retain
  complete redacted contribution, candidate, token, artifact, support-call, and
  linked-request evidence through `receipt.inspect()`; recently serialized
  receipts can be inspected with `inspectRequest()`.

  Remove the public `prompt.inspect()` method. Use `preview(prompt, options)`
  before execution, `prompt.resolve()` for resolved Prompt arguments, and
  request-receipt inspection for evidence about the exact request that was sent.
  The context-planning migration guide documents all removed budget, history,
  compaction, and inspection surfaces and their semantic replacements.

  Project authored history ownership, representation-ladder boundaries,
  definition and invocation budgets, and preparation hooks into the Project
  Index with matching TypeScript and native semantic output. Local request
  preview responses now expose the redacted fit result and required, sticky, or
  elastic contribution map used by Devtools, with restart-safe cache invalidation
  and conclusive diagnostics for duplicate history projections or invalid wrapper
  order.

  Emit content-free executed request-planning evidence as `request.plan`
  artifacts on the canonical observability spine. Local retains and projects
  receipt identities, representation boundaries, selected adaptations, and
  omissions into run detail so Devtools explains the exact request and counts
  budget drops. Configured observability destinations can now serve retained
  inspection to `inspectRequest()` after receipt serialization or across
  processes.

  Migrate the published memory, request-debugging, and silent-truncation articles
  to caller-owned history, whole-request `inputBudget`, explicit representation
  ladders, `preview()`, and executed request receipts.

  Named Agent tool maps may now include direct child Agents as awaited foreground
  Tools. Object inputs project their object schema directly, no-input children
  project an empty object, and non-object inputs project through an `input` field.

  Project Index now distinguishes direct Agent tools with an `agent.uses_agent_tool`
  relation while retaining `agent.uses_tool` for ordinary Tools.

  Each invocation now appears in Local Run Detail and Devtools as a distinct
  privacy-safe child Agent beneath its ordinary Tool call in the parent trace.

  Wrap a child Agent with `backgroundable()` to let the model start process-local
  joinable Work. Background-enabled runs receive one owner-scoped `work` control
  Tool and capped, result-free status context only at safe provider boundaries.

  Classify request composition `REQUEST_TOO_LARGE` failures as `input_limit` for
  routing. Fallback moves to the next candidate by default, cascade tiers can opt
  into `escalateOn: ["input_limit"]`, and retry never repeats the same model for
  capacity failures.

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

- 7c3eaba: Make the Next build wrapper loadable from TypeScript Next configs, accept declared
  Next config values with a nullable Webpack hook, and omit unused Eval capability
  bindings from generated entries without deployable Evals.

  Resolve authored config imports through project `tsconfig` and `jsconfig` path
  aliases with cache-safe extended-config tracking, and make `crux setup --apply`
  ensure project-local `.crux/` state is ignored by Git.

- 5d33890: Make Local CLI lookup and output behavior consistent: accept trace and run IDs, support bare and kind-prefixed Catalog IDs, filter Index kind aliases, align cost reports with observability stats, resolve nested package roots correctly, provide global and Eval JSON output, use Index-specific chrome, and standardize invalid lint options as usage errors.

  Restore runtime-discovered Eval execution and timeout facts across bundled Core boundaries, distinguish them from static-only Eval calls, and invalidate pre-fix Local Project Index snapshots.

  Share Eval definition identity across independently loaded `@use-crux/core` copies so discovered Evals can be recognized and inspected by the coordinator using a different Core module instance.

  Make `crux runtime generate` report progress and fail with a bounded timeout instead of hanging silently.

  Improve Local CLI error quality and output hygiene: make connection hints command- and port-aware, keep one-shot worker lifecycle logs quiet, explain non-project roots, lead Runtime errors with their actionable diagnostic, validate config/check inputs before work begins, suppress non-interactive spinners and Eval color warnings, and add actionable argument, lookup, import, live-stream, and Stats help guidance.

  Make monorepo Eval listing skip test-fixture trees and scope duplicate Eval ids to their owning package, bound offline server connection attempts, distinguish config-import counts from the full Project Index, keep forced-color stderr pipes free of spinner frames, and honor stored-rollup-only observability list reads.

  Report real Project Index definition counts from a matching live server or a bounded static discovery pass during `config inspect`, and explain explicitly when those counts are unavailable. Cross-reference the live Index finding count after bare `crux lint` output when the server is reachable, with an actionable live-mode hint otherwise.

- ac4be3f: Give compiler-proven callback PromptText—including canonical `md` nested inside
  interpolation callbacks—the same syntax-exact editor insights as direct
  PromptText. Keep Local watch indexing incremental when a newly added source is
  absent from the previous source graph.
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

- 70a8520: Add eagerly executing, replayable `streamImage()` and `streamSpeech()` bounded
  operations with provider-neutral events, final-result identity, cancellation,
  deadlines, routing commitment, observability, and input/output Safety.

  OpenAI uses genuine Images API previews and Speech API response-body chunks.
  Google uses current Interactions image deltas and finite Generate Content TTS
  PCM chunks. Unsupported models and controls fail before provider I/O; Crux
  never synthesizes progressive events from a completed artifact or persists
  media implicitly.

  Project Index now recognizes both operations as authored media work with
  static, semantic, native, and Local read-model parity. Catalog classifies them
  as bounded streams with safe modality/support/source facts. Runs separates one
  logical operation from its physical attempts and presents payload-free
  progress, route commitment, timing, terminal, and output-media Safety facts.

  `@use-crux/google` now requires `@google/genai` 2.x. This peer migration is a
  breaking install change because the removed 1.x Interactions event schema is no
  longer accepted.

- 69564b7: Memory capture now follows the active execution lifecycle automatically.

  Capture modes are now `inline | deferred`, with `deferred` as the default. Deferred capture uses the shared `config({ host })` retention binding; when retention is unavailable, Crux safely captures inline and emits one development warning instead of losing work. Retained failures remain observable through `memory.flush()`.

  Adapters submit one completed turn and leave mode selection, deterministic tool-event fan-out, settlement, and block flushing to memory. Catalog exposes the effective configured mode, while Runs records one payload-free `memory.capture` lifecycle inside the owning generation Run with the actual inline, fallback, retained, or Eval-captured disposition.

  Migrate `afterResponse` to `deferred`, replace `detached` with `deferred`, and remove memory-specific `capture.waitUntil` in favor of a shared host binding.

- be06e40: Add authored Eval and Case timeout policies, task-scoped cancellation context,
  and automatic signal and nested-budget propagation for managed AI tasks.
  Timed-out tasks now produce structured complete Run outcomes with comparable
  Baseline coverage, while versioned local and remote readers preserve existing
  artifacts and quarantine late evidence or result publication. Project Index
  and the hydrated Eval catalog expose effective and inherited policy, while Eval
  Runs and normal Runs show structured timeout causes and counts.
- 3140e0b: Add materialized Workspace subtree snapshots through
  `workspace.snapshot.create/list/restore/delete`, including exact-tree restore and
  independent asset ownership. Index authored snapshot usage and present observed
  snapshot operations with privacy-safe, snapshot-aware Local Devtools views.
- 9b4d06e: Add `crux lsp`, a stdio language server that publishes Project Index lint
  diagnostics, keeps ranges aligned with unsaved edits, explains findings on
  hover, offers suppression and safe allowlisted companion-command actions, and
  moves between an attached `crux dev` read model and its own watcher without
  clearing diagnostics during handover. Add index-backed go-to-definition,
  references, document and workspace symbols, definition context on hover,
  finding-count inlay hints and code lenses, Devtools definition links, and
  live editor settings for hints, lenses, and inline-decoration opacity. Publish
  the lockstep VSIX, six native CLI archives, and checksums on stable and nightly
  GitHub Releases; discover trusted project-local npm CLI shims on Unix and
  Windows, and provide npm-first plus direct-download installation guidance.
  Add Project Index-aware semantic completion for supported first-party prompt,
  context, MCP, tool, agent, handoff, and routing dependency slots. Completion
  uses a bounded, private unsaved-document overlay, safe named-import edits, and
  the existing persistent compiler in both attached and own modes. Cross-file
  items require compiler-proven direct named-export evidence. This additive
  Project Index metadata advances the static, semantic, and local snapshot cache
  identities, so upgrades automatically reindex instead of reusing an older
  snapshot.

  Add PromptText-aware editor support for canonical Core `md` templates. One
  bounded Rust analysis now drives theme-aware Markdown-role highlighting,
  folding, heading symbols, safe literal links, static preview, semantic
  diagnostics, and versioned quick fixes while preserving native TypeScript
  behavior inside interpolations. Identity-sensitive results fail closed against
  saved semantic generation and source hashes; transient source and preview
  content never enter Project Index, caches, logs, or broadcasts.

  The VS Code extension adds explicit static preview, runtime exact preview, and
  latest-Run commands. Exact preview discovers a currently configured Prompt,
  requires confirmation, and invokes `Prompt.inspect()` without model
  generation, tool calls, or Run creation. Latest Run resolves current ownership
  and SQLite ordering at click time, with no cached selection or automatic
  navigation. The embedded Devtools routes are bounded, no-store, cancellation
  aware, and keep preview inputs/results in memory only.

  Distribute the editor extension as a checksum-verified, lockstep GitHub Release
  asset for Visual Studio Code and Cursor. `crux editor install vscode|cursor`
  downloads the VSIX matching the running CLI version, verifies `SHA256SUMS`, and
  installs only into the explicitly selected editor; `--download-only` supports
  managed environments. Release builds now embed that same stable or nightly
  version in every native CLI, and release reconciliation shares the validated
  asset set so the VSIX, six native archives, and checksums cannot disappear
  after a successful staging pass.

- 0e52c7d: Make Rust/Oxc the required Static Index path, remove the obsolete
  `experimental.indexer.nativeAst` option and TypeScript static-plan worker
  artifact, and advance Project Index worker events to protocol v3. Configured
  third-party static extractors continue to run through the trusted JavaScript
  host.

  Lint suppressions now remain in Project Index snapshots as materialized
  evidence instead of deleting matched findings. `IndexLintFinding` is a strict
  active/suppressed union: suppressed rows require directive source, scope, and
  optional reason metadata, while canonical active rows omit suppression state.
  Default lint/check views remain active-only, `--include-suppressed` exposes the
  retained rows, and suppressed findings never fail a gate.

  Devtools Index and Catalog Health now report active and suppressed totals
  separately while retaining complete directive evidence for audit. Crux Local
  run-detail reads correlate observed definition references with current Project
  Index findings, and Devtools presents that non-historical context as Current
  project health with links back to Catalog. This read-time context never changes
  run status or creates suppression telemetry.

- 2b50f9d: Normalize structured response and tool-input schemas through provider capability
  profiles. Crux now compiles provider-compatible wire schemas, decodes transport
  sentinels before Safety, validates once with the authored schema, and exposes the
  parsed output consistently across native, AI SDK, generate, and stream routes.

  Structured outputs are now always validated. `validationRetry` controls whether
  another attempt is made; without it, invalid structured output throws instead of
  being returned. Adapter authors must declare their structured-output
  capabilities and use the prepared `outputSchema` supplied to request builders.
  AI SDK and provider adapters now accept `@use-crux/mcp` 0.7 peers.

  ## Provider-neutral media classification

  Add `guardrail.mediaClassifier()` for per-part image, audio, video, and
  file/document classification through any `GenerateObjectFn`. Caller-authored
  categories, inclusive thresholds, capability handling, input/output media
  boundaries, report mode, and strip escalation share one provider-neutral
  contract.

  `GenerateObjectFn` now accepts either a text prompt or canonical messages so
  structured media reaches provider adapters without flattening. Native OpenAI,
  Anthropic, and Google object helpers bind only their client; callers pass the
  model per invocation. Existing two-argument helper construction must migrate
  to `createGenerateObjectFn(client)` plus `{ model, ... }` on each call.

  Guardrail findings now survive callback collection into audits, terminal
  decisions, privacy-safe report artifacts, and Devtools Run Detail. Project
  Index and Catalog expose only complete literal classifier-safe configuration;
  telemetry retains bounded counts rather than category or media details.

  ## Boundary-driven streaming Safety

  An `assert` constraint is transactional on a stream: it gates release, and a failed
  attempt is discarded without publishing bytes and re-streamed with corrective feedback
  under the shared `maxSteps` budget. A positive `validationRetry.maxRetries` installs the
  same commit gate for schema validation. Buffering is attributable through a content-free
  `bufferedBy` reason and `generation.stream.attempt` spans, and constraint settlement is
  occurrence- and value-precise, so a settled `constraint.judge()` is not re-run at
  completion.

  Streaming Safety holds an occurrence until every downstream transformation that could
  change it has completed: an object assertion that passes while a text guard can still
  rewrite the represented JSON is provisional and cannot release bytes, and it is
  re-evaluated against the final value before anything is published. Object-only pipelines
  keep progressive release.

  `stream()` on `@use-crux/ai` now honors `validationRetry`, which it previously discarded.
  Adapters report the model steps an SDK invocation actually consumed while core enforces
  the shared `maxSteps` budget; when consumption is unknown or settled tool rounds cannot be
  resumed safely, Crux fails closed instead of risking duplicate tool side effects.

  Rejected candidates are evidence-only on public terminal errors: `ValidationExhaustedError`
  and `ConstraintViolationError` expose size and hash, never a preview of output the caller
  was not allowed to see. Constraint feedback and metadata no longer reach telemetry (only a
  feedback length and a metadata count), and `ValidationExhaustedError` no longer exposes
  custom Zod issue messages or model-controlled record keys — use its new `issues` summary
  for stable `{ path, depth, code }` diagnostics.

  Structured-output compilation fails closed rather than risking silent corruption: an
  optional property is rejected at compile time when its encoding cannot be proven
  reversible — inside a recursive schema, a union branch, an intersection or tuple, or when
  the property is literally named `"*"`.

  ## Managed logical streams

  `stream()` now returns one Crux-owned logical stream with the same shape on every route:
  `{ runId, _meta, textStream, fullStream, partialOutputStream, completion, cancel }`. A
  logical stream may use several physical provider attempts, but provider framing, discarded
  attempts, and the provider stream object are never observable. All three streams project
  one shared append-only event log, so they can be read concurrently, a surface first read
  late replays from logical `start`, and retention never delays publication — `completion`
  settles without any stream being drained. A terminal failure now reaches every surface with
  the same normalized error object rather than only rejecting `completion`.
  `result.cancel(reason?)` aborts the whole operation, including the active provider attempt.

  For a structured prompt, `textStream` carries canonical serialized `z.input` JSON, and
  `partialOutputStream` is a parsed projection of that same published text — so a partial can
  only ever describe committed output. `completion.object` remains the single
  authored-schema-validated `z.output`.

  Logical `usage` and `cost` are scalar aggregates across every BILLABLE physical attempt,
  discarded ones included — the caller paid for each provider call. Everything else in the
  envelope still describes the accepted attempt alone, so logical `usage` deliberately stops
  equalling the sum of `steps[].usage` once a policy retry occurred. If any billable attempt
  did not report a figure the total is omitted rather than under-reported; on the AI SDK route
  a rejected attempt reports no usage at all, so a retried SDK stream omits logical usage.

  The local runtime accepts the new `generation.stream.attempt` primitive, so coordinated
  streams keep their buffering attribution in Devtools instead of being dropped as unknown.

  `onChunk`, `onFinish`, and `onError` are logical: they observe the published sequence and
  the logical completion, and no caller callback is installed on a physical attempt, so a
  discarded attempt invokes none of them. `@use-crux/ai` adds `toUIMessageStream(result)` and
  `createTextStreamResponse(result)`, and its existing UI-message helpers are now built from
  `fullStream`, which makes a discarded attempt unrepresentable in their input.

  ## Breaking removals

  Streamed `result.raw` is removed on every adapter. A provider stream resolves before
  terminal Safety and describes only one attempt, so exposing it bypassed guardrail holds,
  structured occurrence gating, commit gates, and validation retry. Provider-specific request
  options are unchanged, and provider-specific terminal facts remain on
  `completion.providerMetadata`. Replace `result.raw.partialObjectStream` with
  `result.partialOutputStream`, `result.raw.fullStream` with `result.fullStream`, and
  `result.raw.toUIMessageStream(...)` with `toUIMessageStream(result)`. `generate()` results
  keep `.raw` unchanged. The public `StreamResult` type parameters change from
  `StreamResult<TRawStream, TOutput>` to `StreamResult<TOutput, TPartial>`, and the
  `TextStreamResult`/`ObjectStreamResult` aliases are removed.

  Guardrail streaming configuration moved onto the boundary: `GuardrailConfig.stream`, the
  `stream` tune field, `ConstraintConfig.onChunk`, and `onHoldLimit: 'release'` are removed in
  favor of
  `boundary.output.text().sentences() | .lines() | .deltas() | .complete() | .segments()`.
  The curried `boundary.output.path<T>()('a.b')` spelling is replaced by
  `boundary.output.object<T>().path('a.b')`.

- f5c5da3: Add optional Markdown-oriented prompt composition with `md`, the opaque
  `PromptText` type, and explicit `md.json()` snapshots. Existing strings remain
  fully supported. Resolution still yields provider-neutral plain text;
  `.inspect()` retains structural provenance for PromptText, and Project Index
  records compiler-proven `md` regions with exact source ranges and
  direct-versus-callback lifecycle metadata.

  Export `configure`, `ConfigureOptions`, and `PromptRegistry` from the Core root
  and let that explicit registry lifecycle publish a revisioned Prompt catalogue
  for local exact inspection. Explicit preview dispatch invokes
  `Prompt.inspect()` only; it creates no provider generation, tool invocation,
  ordinary Run, or observability record. Trusted authored callbacks may still
  perform their own side effects.

  Project Index PromptText evidence now classifies every canonical source as an
  owner, named fragment, or anonymous fragment, retains exact semantic fragment
  joins, and emits conservative diagnostics for invalid interpolations, inline
  sequences, and `md.json()` calls proven to return no text. JavaScript and
  native semantic backends produce the same backend-neutral evidence.

  `prompt.prompt` stays synchronous: callbacks return `string | PromptText`.
  Runtime now rejects Promise results from untyped or cast async callbacks instead
  of awaiting this unsupported shape, matching the existing synchronous public
  type. An unconfigured user prompt stays absent through provider adaptations.
  Context staticness follows `systemKind`, so inputless dynamic callbacks are
  neither executed nor classified static during serialization or indexing.
  Direct `ContextSystemContent` and `PromptText` use the static provider-cache
  lifecycle, like direct strings.

  Devtools now presents PromptText compiler evidence and hard diagnostics in
  Catalog, shows structured exact-preview composition and validation, and keeps
  PromptText segment provenance plus token attribution in ordinary captured Runs
  when input capture policy permits it. Local persists that evidence through the
  existing messages artifact; malformed or unavailable provenance falls back to
  the ordinary plain-text Run Detail presentation.

### Patch Changes

- 42419b1: Unify model-input Safety around semantic text, media, and instruction boundaries
  for caller, tool, retrieval, memory, blackboard, handoff, and retry-feedback
  content. Add provider-visible authored/discovered tool boundaries and managed
  memory commit guardrails; raw tool execution controls remain in `toolPolicy`.

  Guard rejected output and corrective feedback before every eligible retry.
  Semantic-cache hits now pass through current output guardrails, one authored
  schema parse, and constraints before publication, with safe live fallback for
  expected content rejections.

  Deprecate `boundary.validation.feedback()` in favor of
  `boundary.input.text({ from: "feedback" })`; the compatibility boundary remains
  operational for validation feedback.

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

- efbed7f: Replace the pre-release Quality authoring, execution, CLI, storage, and
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

- aa067eb: `serverless()` now infers distinct Vercel production and preview Runtime Engine namespaces and records their provenance. Production serverless configurations without an explicit namespace, `CRUX_RUNTIME_NAMESPACE`, or supported Vercel signal now throw `NAMESPACE_AMBIGUOUS` at composition instead of silently using `local`; set `CRUX_RUNTIME_NAMESPACE=production` or pass `serverless({ namespace: "..." })`.

  Runtime setup and preflight now warn when a serverless definition legitimately falls back to `local` in development, and the `crux` CLI renders passing-setup warnings in `crux runtime generate` and `crux dev` preflight output.

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

- 4d51ecf: Make TUI input routing deterministic so focused filters consume text before
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
- 21bba63: Cache validated dense and sparse embedding bundles per source when an indexer
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

### Patch Changes

- d943c41: Safety input guardrail rewrites now fail closed on multimodal messages: a rewrite that cannot be
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

- ed6626b: Restore observability configuration across bundled server module copies and
  reconcile abandoned activity without treating it as currently running.

  Also preserve provider model metadata and grounded prompt types, and make
  omitted Static Index configuration use the documented default. Reject malformed
  shared runtime registry ancestry and hook layers before duplicate module copies
  adopt them.

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

- fd6edcc: Harden indexer untrusted-input handling: source-only static syntax planning no longer imports project config, extension loading verifies resolved package identity and containment before import, and source-map disk reads are contained to the project root.

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

- 64a716b: Stabilize model routing around `router()`, `split()`, `retry()`, `fallback()`, and `cascade()` wrappers with routing receipts, generate/stream support boundaries, and updated adapter docs.

  Breaking routing API changes: router `.with()` and `.select()` are removed in favor of call-site `routing` and `route` options; variadic `fallback(a, b, opts)` is replaced by `fallback([models], opts)`; `_meta.router` / `_meta.cascade` / `_meta.fallback` are replaced by `result.routing`; native OpenAI, Anthropic, Google, and Convex model options now type-reject routing wrappers instead of accepting unsupported values.

  Extend Project Index routing facts, static extraction, native semantic parity, relation policies, and index lints to cover split routes, retry targets, array-form fallback, call-profile model targets, and RouteArgs callback source refs.

  Surface canonical routing receipts in local devtools run detail and Project Index views, including router defaults, split buckets, retry/fallback attempts, cascade budgets, and receipt-backed Turn Decision Report chips.

  Project Index now shows required `RouteArgs` context types and literal route call-profile parameters. Run Detail renders receipt TTFT, bounded attempt errors, and cascade tier note/budget from the same canonical `routing.report` preview.

  Run Detail now accepts the canonical JSON-safe receipt when unavailable routing costs are serialized as `null`, including nested retry, fallback, and cascade cost fields.

  OpenTelemetry span naming now covers all five canonical `routing.*` primitives and no longer treats the `fallback.attempt` edge/name as a primitive.

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

- 089ba6f: Add the provider-neutral `@use-crux/core/setup` contributor and planner contract
  and the aggregate `crux setup` check/apply/JSON workflow. Runtime setup now
  participates as a contributor through that single setup command.
  Unhealthy reports exit nonzero, contributor failures remain isolated and
  privacy-safe, and apply reports retain planning and adapter-reported failures.

### Patch Changes

- cd3e235: Stabilize the Quality beta API and experiment record contract: `ctx.score()` becomes `ctx.recordScore()`, post-score callbacks are now `afterScores`, retrieval recipe targets use `target.retrievalRecipe()`, decision-report assertions use the singular `decisionReport` namespace, and experiment records now write schema-version 2 `cells` with ordered assertion `outcomes` only.

  Harden Quality determinism by adding explicit cache identity epochs, including structured-output schemas and tool parameter schemas in cassette keys, including case input, prompt, params, dataset content, and scorer identity in output-cache/baseline fingerprints, failing loudly on corrupt committed baselines, and rejecting invalid scorer values instead of aggregating them.

  Make Quality artifact writes atomic and safer under concurrent runs: cassette recording now single-flights duplicate misses, flushes merge with on-disk entries under a lock, timed-out cells quarantine late trace/cassette writes, and local read-model records write via temp-file rename.

  Harden judge-backed scoring by pinning judge generation settings, framing untrusted output/reference/context in judge prompts, stamping judge provenance on score metadata and baseline identity, and adding human-label plus judge-report tooling for judge-vs-human agreement.

  Structured judge inputs are serialized before prompt framing, so Safety's judge-backed constraints can evaluate object-shaped outputs without losing fields or throwing during escaping.

  Harden the Quality local pipeline by making `crux eval run --json` emit a single run summary object, adding worker/core protocol version checks and run-scoped event ids, surfacing worker crashes as structured exit-2 failures, fixing live read-model collisions and source-frame path containment, reporting skipped legacy records, and requiring an explicit devtools promotion variant.

  Quality observability capture now uses an observability-owned hook registry, preserving run-scoped trace capture without importing Node-only Quality internals into platform-neutral runtime bundles.

  Add the Quality machine contract surface: `@use-crux/core/eval/schemas` exports validation schemas and JSON Schema generation for records and CLI JSON, experiment records embed agent-readable `failures` artifacts, and `crux eval diff <expA> <expB> --json` compares saved experiment records through core-owned diff policy.

  Add the Quality adoption path: `crux eval init` scaffolds first evals for uncovered prompt definitions, `crux eval import-traces` converts retained local traces into JSONL dataset rows, and dataset-backed failures now surface dataset path plus content fingerprint in persisted records, run summaries, failure artifacts, and experiment diffs.

  Add the Quality agent loop: `crux eval run` now supports `--failed`, deterministic `--sample`/`--seed`, `--max-cost`, and `--changed-since` subsets, `crux eval mcp` exposes list/run/show/diff/evidence/judge-report/label tools over MCP, and `crux eval init` scaffolds a local Quality skill for coding agents.

  Declare Quality beta: the authoring surface, experiment/manifest schemas, CLI JSON outputs, and exit codes are stable within 0.x minors; future breaking changes require a minor bump and migration note while the first-party runner facade remains internal.

  Finish Quality Project Index parity for beta: native static extraction now treats `afterScores` assertions as evaluation-level `ctx.expect()` sites, evaluation definitions expose catalog facts for devtools chips, spec experiment records enrich `evaluation:*` and covered definitions in the local read model, and `crux eval init` discovers uncovered targets from Project Model evidence before falling back to config exports.

  Complete Quality observability coverage by removing the unused `quality.snapshot` artifact kind, emitting `baseline.promotion` artifacts on successful promotion, emitting diff-mode `comparison.report` artifacts from core experiment diffs, and forwarding `quality diff` events into local activity.

  Make the Quality machine contract operable from the UI: devtools serves `GET /api/quality/judge-report/{evaluationId}` and `GET /api/quality/experiments/diff?a=&b=` (the latter runs the core diff op in a worker), the experiment read model surfaces core-owned `failures` artifacts, and the workbench renders fix-surface chips that deep-link to the covered definition, a Failure Artifact panel with dataset provenance and cassette id, Pass/Fail cell labeling, a judge-trust panel (agreement, confusion matrix, kappa, disagreements), and an experiment Compare picker with a per-score/per-case diff and a drift banner. The TUI shows fix-surface letters on failing cells, the dataset fingerprint, and a CLI hint for the judge-report and diff views.

- 2ab4bd9: Promote Safety to its stable beta boundary model. Guardrails and constraints now author through `{ id, on, run }` with typed `boundary.*` targets, duplicate policy ids fail fast, `safety.tune` controls per-call posture, structured-output rewrites keep returned text/object synchronized, and Safety audit/error/observability records are safe-by-default.

  Streaming guardrails now protect ordinary output streams by default through sentence-gated checks, explicit final/disabled modes, bounded hold behavior, and the AI SDK stream bridge preserves policy-terminal completion errors without unhandled rejections.

  Add the provider-agnostic Safety strategy pack (`guardrail.pii`, `guardrail.secrets`, `guardrail.injection`, `guardrail.classifier`, `constraint.judge`, `constraint.citations`, and `toolPolicy.*`), Project Index Safety facts/lints, Devtools Safety intervention surfacing, and updated docs with migration notes plus beta roadmap RFC links.

- aa37b64: Add runtime-backed `workspace.watch()` subscriptions for durable create, update, delete, and rename events, including cursor polling, unsubscribe, and transaction-aware event emission.

  Classify `workspace.watch()` as read-style Project Index data access and bump local/indexer cache identities so existing snapshots do not mask the new facts.

  Update local devtools workspace read models so deleted files are removed from the tree and observed rename/move operations update the visible destination path.

  Render `watch` as a recognized read-style Project Index data-access operation in the devtools intelligence panel.

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
