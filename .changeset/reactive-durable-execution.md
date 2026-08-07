---
"@use-crux/core": minor
"@use-crux/indexer": minor
"@use-crux/local": minor
"@use-crux/postgres": minor
"@use-crux/convex": minor
"@use-crux/ai": minor
"@use-crux/otel": minor
---

Add typed process-local Signals with Standard Schema normalization, predicate
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
`nextCursor` only after the full batch is durably accepted. Optional
`PollResult.more` skips `intervalMs` once after acceptance; poll failures keep
the previous cursor and a safe `lastErrorCode`. Competing supervisors
coordinate through Runtime leases; worker stop aborts in-flight polls and
releases binding leases. Project Index discovers `polling()` with static/native
parity and rejects live `poll` fields on inert bindings. SSE, WebSocket, and
generic stream adapters remain follow-on #340 children on the same lifecycle
seam. Channel exclusive conversation ownership remains #302.

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
