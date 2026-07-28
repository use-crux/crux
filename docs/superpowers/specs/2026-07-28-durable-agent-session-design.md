# Durable Agent Session Design

Status: **proposed**

Related designs:

- [Canonical Thread](./2026-07-24-thread-design.md)
- [Standalone Signals](./2026-07-23-standalone-signals-design.md)
- [Joinable Background Work](./2026-07-23-joinable-background-work-design.md)
- [Whole-Request Context Management](./2026-07-27-whole-request-context-management-design.md)
- existing Agent, Runtime Engine, Storage, host, adapter, observability, and
  effect contracts

This design supersedes provisional Session API examples and deferred Session
integration assumptions in the related Thread, Signal, and Background Work
designs. Their standalone contracts remain unchanged.

## Summary

Crux should provide a durable `session()` primitive for long-lived,
addressable Agent ownership:

```ts
const chat = await session(chatAgent, {
  key: `support:${customerId}`,
})

const sent = await chat.send('Check the tests.')
const turn = await sent.result()

await chat.close()
```

A Session is not one long model request. It is a durable serialized owner of:

- one Agent identity;
- one canonical Thread head;
- cursor-ordered ingress;
- pending attached Work;
- repeated finite Agent activations;
- typed completed turns;
- lifecycle state; and
- a resumable activity stream.

Creating a Session does not run its Agent. Input, a subscribed Signal, or
completion of attached Work wakes a parked Session. An active Session accepts
new ingress immediately and presents it at the next model-step boundary:

> Session ingress may enter mid-turn but never mid-step.

The common public API stays small. Actor-like ownership, mailbox mechanics,
leases, fencing, cursor claims, and wake coalescing remain internal.

Sessions require honest durable runtime capabilities. They reuse Crux's
existing Runtime Engine, Storage, host composition, Agent target resolution,
Thread, Signal, Work, context planning, and observability. Users do not
configure a Session registry, Session store, provider, or separate persistence
layer.

## Product principles

1. **The common path is small.** Create or retrieve, send, await or stream, and
   close.
2. **A Session is ownership, not one endless run.** It coordinates repeated
   finite Agent activations behind one durable address.
3. **Acceptance is immediate and durable.** Work may continue asynchronously,
   but accepted ingress is never process-local wishful thinking.
4. **Steering is cooperative.** Ingress enters between complete steps and
   never mutates an in-flight provider request or incomplete Tool lifecycle.
5. **Thread remains conversation truth.** Session state, typed outputs,
   Signals, timers, failures, and Work lifecycle do not become fake messages.
6. **Opportunity batching is the default.** Concurrent conversational input is
   presented at the next safe opportunity without debounce timers or queue-mode
   switches.
7. **Lifecycle is explicit.** Agent completion parks; applications close.
8. **Durability must be honest.** Missing required capabilities fail before
   creation. Explicit reduced modes say exactly which guarantees are absent.
9. **Definitions evolve between activations.** Compatible Agent changes apply
   without forcing users to version every prompt edit.
10. **Configure infrastructure once.** Session composes with standard Runtime,
    Storage, and host adapters.
11. **Replay follows durable facts.** Claims, delivery positions, frozen
    provider requests, commits, and terminal transitions are deterministic
    across retries and crashes.
12. **Every important decision is inspectable.** Users can explain acceptance,
    batching, delivery, retries, blocking, and lifecycle transitions.

## Goals

V1 should provide:

- durable parked Session creation for inert Agent definitions;
- optional application-owned get-or-create keys;
- reconnection through opaque Session IDs;
- typed Agent input acceptance and reconnectable send handles;
- deterministic opportunity batching;
- cooperative mid-turn steering between model steps;
- canonical Thread ownership and typed Session turns;
- resumable Session-wide and input-scoped streams;
- explicit durable Signal subscriptions;
- automatic ownership of background Work spawned inside Session execution;
- graceful close, closed-only deletion, and committed-boundary forks;
- automatic compatible Agent-definition upgrades between activations;
- clean failure isolation and actionable blocked states;
- required-capability preflight and predictive development diagnostics;
- provider-neutral Core semantics across Crux-owned and AI SDK loops;
- Project Index, observability, Devtools, and Eval evidence; and
- fault-injection and concurrency verification for durable correctness.

## Non-goals

V1 does not define:

- a Session target other than Agent;
- a reusable Session definition or Session policy object;
- Session-level `use[]`;
- generic application `session.state.get/set/update`;
- arbitrary public mailbox or actor APIs;
- per-input priority, preemption level, debounce, or queue mode;
- automatic broadcast from every Signal in `agent.use` to every Session;
- a permanent raw-token event log;
- arbitrary merge or rebase between forked Sessions;
- explicit user-authored Agent versions or migrations;
- a destructive `session.kill()` contract;
- rollback guarantees for cancellation of external effects;
- externally steering a running Work item;
- channel integrations such as Telegram, WhatsApp, or Teams; or
- hosted Crux infrastructure as a requirement.

`spawn(agent, input)` remains the one-job primitive. A future inert Swarm may
become another Session target after its own execution contract is designed.

## Terminology

### Session

A long-lived durable owner that serializes mutation of one Agent execution
history, one Thread head, ingress, attached Work, and lifecycle.

### Session handle

The typed value returned by `session()` or `getSession()`. It is a client
handle, not the worker or execution itself.

### Activation

One finite execution segment using one pinned Agent-definition fingerprint and
one compatible claimed ingress group. It finishes, fails, blocks, or parks.

### Turn

One committed typed Agent result produced by an activation. A turn links its
accepted inputs, exact canonical messages, inferred output, usage, and
completion evidence.

### Step

One model request plus the foreground Tool execution, approvals, and effect
completion required to leave a provider-valid message sequence. A provider
retry of the same frozen request is not a new step.

### Ingress

A durable ordered occurrence delivered to a Session. V1 occurrence kinds
include typed Agent input, Signal occurrence, attached-Work lifecycle, and
internal lifecycle control.

### Safe boundary

The point after a complete step and immediately before a possible next model
step. Session ingress may become model-visible only at this boundary or as the
first input of a new turn.

### Acceptance cursor

An opaque, server-assigned monotonic position in one Session's ingress order.
It represents durable acceptance order, not client send time.

### Delivery cutoff

The accepted high-water mark atomically claimed for one processing
opportunity.

### Activation-policy fingerprint

The identity of resolved non-turn execution policy for one Agent input,
including model, system/context, capabilities, contracts, settings, and other
execution-relevant configuration.

### Parked

Open, durable, and inactive. Parked does not mean completed or closed.

### Blocked

Open but unable to continue without application or operator action.

## Architectural choice

V1 models a Session as one durable serialized owner.

Internally this resembles an actor with one ordered log and one active mutation
lease. That vocabulary is not public. Users work with `session()`, `send()`,
streams, and lifecycle operations.

Two alternatives were rejected:

1. **Chained durable Agent runs.** Coordination for Signals, Work, batching,
   forks, close, and recovery would leak across independent run records.
2. **A Thread-driven Agent watcher.** It would conflate canonical
   conversational truth with structured input, Signals, timers, Work
   completions, and lifecycle control.

The Session coordinator owns execution ordering. Thread owns canonical
messages. Storage owns durable records. Runtime owns target resolution and
wake execution. Adapters own provider lowering. None of those layers replaces
another.

## Public API

The following interfaces are conceptual TypeScript. Exact internal generic
names may follow existing Crux conventions without changing the contract.

### Create or get by application key

```ts
const chat = await session(chatAgent)
```

Without a key, each call creates a fresh parked Session.

```ts
const chat = await session(chatAgent, {
  key: `support:${customerId}`,
})
```

With a key, `session()` is an atomic durable get-or-create operation:

- the first compatible call creates the Session;
- later compatible calls return that same Session;
- retrieval never activates or wakes the Agent;
- the key is scoped to the effective runtime namespace and `agent.id`;
- the key is application identity, not authorization;
- conflicting immutable setup rejects;
- a closed Session remains closed when retrieved; and
- deletion retains a minimal tombstone so the key cannot silently resurrect a
  deliberately ended lifecycle.

Calling `session(agent, { key })` for a tombstoned key rejects with a typed
`SessionDeleted` outcome carrying the retired Session ID. Creating another
logical episode requires another application key, such as
`support:${customerId}:${episodeId}`. Crux never guesses when a closed or
deleted lifecycle should be replaced.

`key` is preferred over `idempotencyKey` because the contract includes durable
lookup, not only retry deduplication.

### Reconnect by opaque ID

Every Session also receives an opaque durable `session.id`.

```ts
const chat = await getSession(chatAgent, sessionId)
```

Supplying the Agent:

- preserves input, output, history, and turn types;
- validates the stable Agent identity;
- validates caller expectations against the currently deployed definition; and
- avoids a public global Agent registry.

`getSession()` reconstructs a handle. It does not wake the Session. Missing,
deleted, unauthorized, or target-mismatched IDs reject with typed errors.
Runtime target resolution, not the caller's in-process object, remains
authoritative for execution after restart.

### Session options

V1 options are deliberately narrow:

```ts
interface SessionOptions {
  readonly key?: string
  readonly thread?: Thread
}
```

There is no Session-level `use`, model, Tool, memory, context, host, Storage,
provider, queue, or background-Work option.

### Send typed Agent input

```ts
const sent = await chat.send(input)
```

`input` uses the Agent's existing declared input type. Session defines no
second schema and no chat-only contract.

`send()` resolves after durable acceptance and wake intent, not after model
execution:

```ts
interface SessionInputHandle<Turn> {
  readonly id: string
  readonly cursor: SessionCursor
  readonly acceptedAt: Date

  result(): Promise<Turn>
  stream(): AsyncIterable<SessionInputEvent>
}
```

The accepted input ID and cursor remain distinct even when several handles
share one activation and turn.

After reconnecting:

```ts
const sent = await chat.getInput(inputId)
```

reconstructs the same logical handle.

Calls made through one Session handle are submitted FIFO in JavaScript
invocation order even when their returned promises are not awaited. Calls from
different handles or processes are ordered only by the server-assigned
acceptance cursor.

For callers that need one atomic ordered acceptance group:

```ts
const [first, second] = await chat.sendMany([
  'Check the tests.',
  'Also inspect concurrency.',
])
```

`sendMany()` validates the complete array before mutation and either accepts
all inputs in array order or accepts none. Every input still receives its own
ID, cursor, timestamp, handle, and result. Compatible inputs share an
opportunity; incompatible activation policies still split into consecutive
activations rather than being forced together.

### Status and inspection

```ts
await chat.status()
```

returns a compact snapshot:

```ts
interface SessionStatus {
  readonly state:
    | 'parked'
    | 'running'
    | 'blocked'
    | 'closing'
    | 'closed'

  readonly acceptedCursor?: SessionCursor
  readonly processedCursor?: SessionCursor
  readonly pendingInputs: number
  readonly pendingWork: number
}
```

Lease, retry, wake, worker, blocker, delivery, and diagnostic detail belongs in
`session.inspect()` and Devtools rather than the common status shape.

`pendingInputs` counts every accepted non-terminal input, including input
claimed by an activation but not yet committed. A stale handle used after
deletion receives the typed `SessionDeleted` outcome; deletion is not another
live status value.

## Thread ownership

Every Session owns one position in one canonical Thread:

1. reuse the Agent's one statically declared Thread when present;
2. otherwise use explicit `session(agent, { thread })`;
3. otherwise create a Thread atomically with the Session.

Supplying a Thread different from the Agent's declared Thread rejects. Multiple
Sessions may own independent positions in the same Thread.

A concrete Thread declared by an Agent is therefore an explicit shared
conversation-tree choice. Distinct keyed Sessions receive independent heads
but still share that Thread's tree, retention, redaction, and inspection
boundary. Applications wanting one Thread per Session omit the concrete Thread;
`session()` creates and binds it automatically. Project Index and development
diagnostics should call out a concrete Agent Thread reused by several
independent keyed Sessions because it is often an accidental tenant-boundary
mistake, without overriding the explicit choice.

`session.thread` is a head-bound read-oriented view:

```ts
session.thread.id
await session.thread.read()
```

It does not expose ordinary `append()` or `select()`, because those operations
could bypass the Session ingress log and mutation lease. Advanced applications
may retain or reconstruct the standalone Thread handle for deliberate
Thread-level branching, editing, redaction, or deletion.

Thread redaction remains authoritative after publication. Session turn
projection returns redaction tombstones in place of removed entries and never
re-exposes redacted content from duplicated Session records. A caller that
already received content before redaction cannot be made to forget it.

Redaction is conservative at the Session-turn boundary. If any Thread entry
linked to a turn is redacted, that whole Session turn becomes `redacted`.
Crux removes every typed input payload, the typed output, cached model-facing
projections, retained stream deltas, and completed-output snapshots for that
turn from Session-owned records. It retains only payload-free identities,
cursors, timestamps, usage, and structural message tombstones. The standalone
Thread remains authoritative at entry granularity, so unrelated Thread entries
and every unrelated Session turn remain available.

Crux deliberately does not attempt semantic leak detection. An output may
repeat or paraphrase a redacted input or Tool result, so preserving it would
make the redaction guarantee misleading.

Whole-Thread deletion rejects while any non-deleted Session still owns a
position in that Thread, including a closed readable Session. Applications
delete the linked Sessions first. This preserves Session history and prevents
an active owner from losing its canonical source beneath it.

A Session automatically binds its Thread as Agent history. The Agent's
explicit history projection remains authoritative:

- bare Thread means exact canonical history;
- `history.recent(...)` applies the explicit recent projection;
- `history()` applies managed adaptive history; and
- no Session-specific implicit window or summary is added.

Exact history is the deliberate zero-option default. Open-ended conversational
Sessions should normally declare `history()` on the Agent; it automatically
projects the Session-bound Thread and needs no Session option. A bare exact
Thread emits the whole-request design's early predictive optimization warning
and fails before provider dispatch if it eventually cannot fit. Crux never
silently turns Session durability into authorization for summarization.

V1 adds no Session-level `use[]`. Stable context, Tools, Skills, constraints,
guardrails, and history policy belong to the Agent. Dynamic context continues
to resolve from typed Agent input and existing Crux composition.

## Canonical inputs, messages, and turns

The validated Agent input occurrence is canonical durable ingress. The Agent's
existing prompt/input machinery resolves it into model-facing content.

A conversational Agent may accept text or canonical message content. A task
Agent may accept a structured object. Signal and Work occurrences remain their
own typed kinds rather than pretending to be public Agent input.

### Session ingress projection

Session execution does not change the Agent's public input type to an array and
does not turn non-message occurrences into fake messages.

Every accepted Agent input is resolved independently into:

- one canonical turn-content/message group;
- one resolved non-turn activation policy; and
- one typed ingress occurrence.

The first compatible Agent input is the activation's primary input. Additional
compatible inputs contribute their own canonical turn-content groups in cursor
order. They are never merged into an invented `TInput[]`. If a Prompt cannot
separate input-specific turn content from non-turn policy, its inputs are not
compatible for coalescing and run as ordered separate activations.

Model-visible ingress has explicit policy anchoring:

- an Agent input constrains delivery to its resolved activation-policy
  fingerprint;
- a Work completion constrains delivery to the stored baseline of the
  activation that spawned it; and
- a Signal occurrence does not introduce a competing policy baseline.

This distinction lets heterogeneous ingress compose without inventing policy
for a Signal or resuming Work under whichever input happened to arrive nearby.

Provider-neutral `StepContext` preserves the primary `input` and adds typed
delivered ingress metadata:

```ts
prepareStep({
  input,
  ingress,
})
```

Conceptually:

```ts
type SessionStepIngress<Input> =
  | {
      kind: 'input'
      id: string
      cursor: SessionCursor
      input: Input
    }
  | {
      kind: 'signal'
      id: string
      cursor: SessionCursor
      occurrence: SignalOccurrence<unknown>
    }
  | {
      kind: 'work'
      id: string
      cursor: SessionCursor
      work: WorkEvent
    }
```

`ingress` contains occurrences newly delivered at that boundary. It is
immutable metadata, not permission to replace raw provider messages.

Crux also contributes one internal exact Session-event context projection for
Signal and Work occurrences. It is available for the remainder of the
receiving turn, participates in whole-request planning, and is replayed from
the durable Session log after a crash. It expires from automatic model context
after that turn. Applications deliberately preserve longer-lived facts through
Thread, Memory, or application Storage.

An Agent with unsatisfied required caller-only input cannot begin a parked
activation from a Signal alone; subscription preflight rejects that binding.
A Work completion resumes from the stored originating Session execution
baseline rather than inventing another public Agent input.

Thread stores canonical model-safe messages. Session stores completed or
redacted typed turns:

```ts
type SessionTurn<Input, Output> =
  | CompletedSessionTurn<Input, Output>
  | RedactedSessionTurn

interface CompletedSessionTurn<Input, Output> {
  readonly id: string
  readonly status: 'completed'
  readonly inputs: readonly {
    status: 'available'
    id: string
    cursor: SessionCursor
    value: Input
  }[]
  readonly messages: readonly ThreadEntry[]
  readonly output: Output
  readonly usage: Usage
  readonly completedAt: Date
}

interface RedactedSessionTurn {
  readonly id: string
  readonly status: 'redacted'
  readonly inputs: readonly {
    status: 'redacted'
    id: string
    cursor: SessionCursor
  }[]
  readonly messages: readonly {
    status: 'redacted'
    id: string
  }[]
  readonly usage: Usage
  readonly completedAt: Date
  readonly redactedAt: Date
}
```

For a completed turn, `turn.messages` contains the exact committed user,
assistant, and Tool entries. If any linked entry is later redacted, the
Session projection atomically changes to the payload-free redacted variant.
Structured output remains linked typed execution evidence while the turn is
completed; Crux does not fabricate it into a Thread message.

An input handle obtained before redaction may already have disclosed its
result. After redaction, a reconstructed or unresolved `sent.result()` rejects
with typed `SessionTurnRedacted` instead of returning erased evidence.

```ts
await session.thread.read()
```

returns model-safe canonical history.

```ts
const { turns } = await session.history()
```

returns completed and redacted typed Session turns. V1 history is paginated
through the same snapshot-page pattern as other durable reads; callers are not
required to load an indefinitely long Session into memory.

Failures are not fake turns. They remain visible through input handles,
activity, observability, and inspection.

## Acceptance and wake semantics

Acceptance is one atomic durable mutation:

1. validate the Agent input schema;
2. assign a Session-scoped input ID and acceptance cursor;
3. append the canonical input occurrence;
4. record or coalesce retained wake intent; and
5. return the accepted handle.

Cursor order is server acceptance order. Crux does not attempt to reconstruct
client wall-clock order.

A parked Session receives a wake. A running Session needs no concurrent second
activation; its terminal transition observes the newer accepted high-water
mark.

Wake delivery may be at-least-once. Leases, fencing, conditional commits, and
idempotent claim identities make duplicate wake execution safe.

## Opportunity batching

Session is an interactive long-lived owner, not a background task queue.
Opportunity batching is therefore the only V1 default:

```ts
const first = chat.send('Check the tests.')
const second = chat.send('Also inspect concurrency.')

await Promise.all([first, second])
```

At the next opportunity, the Session atomically claims every accepted
occurrence through a durable cursor cutoff. Inputs accepted after the cutoff
wait for the next opportunity.

FIFO submission guarantees the order of these same-handle calls. It does not
pretend two independent acceptances cannot straddle a worker cutoff. When one
atomic group is required, callers use `sendMany()`; Crux introduces no hidden
debounce or timing window.

Every input remains independently:

- validated;
- identified;
- cursor-ordered;
- resolved;
- observable; and
- reconnectable.

Inputs are never merged, deduplicated, rewritten, or summarized merely because
they share an activation.

Crux partitions model-visible ingress within the cutoff using an anchored-prefix
rule:

1. An active turn's pinned activation policy is the initial anchor.
2. Otherwise, Crux scans from the earliest cursor to the first
   policy-constraining occurrence. Its required policy becomes the anchor.
3. If the claimed prefix contains only unconstrained Signal occurrences, the
   Agent's current compatible execution baseline becomes the anchor.
4. Leading and intervening unconstrained Signal occurrences attach to that
   anchor.
5. Crux takes the longest cursor-consecutive prefix whose constrained
   occurrences require a compatible policy.
6. The first incompatible constrained occurrence ends the prefix and starts a
   later ordered activation. Nothing crosses it or moves around it.

Agent inputs constrain delivery to their resolved activation-policy
fingerprint. Work completions constrain delivery to their stored originating
baseline. Signal occurrences are unconstrained and attach to the activation
selected by cursor order. Internal lifecycle occurrences that require no model
visibility are committed independently and do not alter this partition.

For example, a cutoff containing input A under policy X, a Signal, a Work
completion originating under policy Y, and input B under policy X produces
three ordered activations: A plus the Signal under X, the Work completion under
Y, then B under X. Crux never reorders ingress, applies last-wins policy, or
invents a merged configuration.

The same anchored-prefix check applies to ingress accepted during an active
turn. At the next safe boundary, compatible constrained ingress and
cursor-adjacent unconstrained Signals enter that turn. An incompatible
constrained occurrence remains claimed for the next ordered activation instead
of running under the active turn's policy. A boundary-local `prepareStep` model
or context amendment does not redefine the activation baseline and therefore
does not retroactively change compatibility.

There is no `coalesce`, sequential-processing, debounce, or timing-window
option. Applications requiring one result per input can serialize explicitly:

```ts
const first = await chat.send(a)
await first.result()

const second = await chat.send(b)
await second.result()
```

Independent jobs should use `spawn()`.

## Mid-turn, never mid-step

The durable Session log may become model-visible only at step boundaries.

A step consists of:

- one frozen model request and response;
- its foreground Tool calls and Tool results;
- required Tool approval resolution; and
- effect completion needed to reach a provider-valid continuation.

Ingress accepted during a step is durably queued. Immediately before a
subsequent model step, Crux:

1. atomically claims eligible cursor-ordered ingress;
2. commits its delivery position to the durable Session log;
3. resolves the delivered occurrences into the step's Session baseline;
4. invokes the user's Agent `prepareStep` against that updated baseline;
5. applies the fresh amendment to form the provider-call candidate graph;
6. runs whole-request context planning, validates, and freezes one provider
   request; and
7. executes that request.

This ordering means the user's `prepareStep` sees newly delivered input.
Explicit user amendments remain subject to the same whole-request validation
and observability as standalone Agent execution.

Crux does not inject between a Tool call and its required result, while an
approval is unresolved, during an effect transaction, or while parallel
foreground Tools from the current step remain incomplete.

Background Work does not keep the spawning step open. Its later completion is
new Session ingress.

If the completed step is terminal, pending ingress starts the next turn instead
of inventing another step or changing an answer already streamed to a client.
The transition from running to parked is one conditional operation:

```text
park only if drained cursor == accepted high-water mark
```

Otherwise the Session immediately begins the next activation. This prevents a
lost wakeup or two concurrent turns at the terminal boundary.

### AI SDK and Crux-owned loops

The AI SDK adapter lowers this contract through its per-model-step
`prepareStep` hook. Crux delivery composes before any user callback and may
amend the messages for the next SDK step.

The AI SDK loop naturally reaches another step after completed Tool work. If a
step produces its terminal response, newly queued input becomes a new Session
turn rather than forcing a synthetic SDK step.

OpenAI, Anthropic, and Google adapters using Crux-owned loops call the same
provider-neutral Session boundary before each model request. Core semantics do
not depend on provider SDK types.

## Provider requests, retries, and commits

Every model step receives one immutable request plan from the whole-request
context planner.

A provider retry of that step:

- reuses the exact frozen request;
- does not drain newer ingress;
- does not invoke another delivery boundary; and
- remains the same step identity.

New ingress waits for the next real step or turn. This preserves deterministic
replay and provider prompt-cache stability.

Activation attempts may repeat after worker failure. A successful logical step
commits canonical messages, typed output evidence, cursor progress, and
idempotency identity atomically enough that it cannot be appended twice.

The implementation may use multiple physical records, but it must expose one
logical publication point. Recovery completes or safely retries an
unpublished transition; it never exposes a partially committed Tool lifecycle
or advances processed cursors without either committed output evidence or
committed terminal-failure evidence.

## Signals

Signals support two explicit modes.

An Agent definition:

```ts
agent({
  use: [deployRequested],
})
```

retains fresh-execution trigger semantics.

Delivering matching occurrences into one existing Session requires an explicit
durable binding:

```ts
export const deployForRepo = deployRequested.when(
  (
    event,
    args: { repository: string },
  ) => event.repository === args.repository,
)

const subscription = await chat.subscribe(
  deployForRepo({ repository: repositoryId }),
)
```

`.when()` always receives authored predicate code. A predicate with a second
typed argument produces a callable parameterized filtered-Signal definition.
Calling it binds JSON-serializable arguments without closing over
request-local state.

Durability decomposes into:

- a stable manifest definition identity plus a version fingerprint for the
  exported predicate code; and
- canonically encoded typed argument data stored with the binding.

An ordinary one-argument predicate remains an unparameterized filtered Signal.
Crux emits a development/Project Index diagnostic when a durable subscription
uses predicate code that cannot be resolved after restart. `subscribe()`
rejects before creating the binding as a runtime safety backstop. Crux never
serializes closures or grows a second structural query language.

The Session owns the binding. A Signal occurrence:

- preserves the Signal's validated typed payload and occurrence identity;
- does not become public Agent input;
- receives an acceptance cursor in the Session's shared ingress order;
- wakes a parked Session; and
- enters a running Session at the next safe boundary.

Using a Signal in an Agent does not implicitly subscribe all existing Sessions.
That would cause accidental broadcasts and duplicate fresh executions.

Unsubscription is explicit and idempotent:

```ts
subscription.id
await subscription.unsubscribe()
```

It is an ordered barrier. Future matching deliveries reject after the barrier;
already accepted occurrences drain normally. A Session may have multiple
filtered subscriptions to the same Signal, so V1 does not add ambiguous
`session.unsubscribe(signal)`.

`session.subscribe()` is idempotent by Session, Signal, stable filtered-
definition identity, and canonical bound arguments. The fingerprint is pinned
execution version, not logical subscription identity. Repeating the same call
after reconnect returns a handle for the existing active binding rather than
causing duplicate delivery.

Crux makes no claim that it can decide whether arbitrary predicate-code
versions are semantically compatible. The latest active manifest version of
the same stable filtered definition evaluates future candidate occurrences.
An occurrence already accepted into Session ingress retains the predicate
version evidence under which it matched and is never reevaluated. This changes
neither logical binding identity nor delivery idempotency.

If the exported definition disappears, or the active predicate version cannot
evaluate the canonically stored arguments, the subscription becomes visibly
`blocked` with source-linked migration guidance. Its delivery position does
not skip the failing occurrence. Restoring a runnable definition or explicitly
replacing the subscription resumes evaluation. Ordinary predicate edits
require no unsubscribe/resubscribe ceremony. Different stable definitions or
arguments remain distinct.

```ts
const subscriptions = await chat.subscriptions()
```

lists active reconnectable handles for inspection or bulk cleanup. V1 adds no
`getSubscription(id)` because repeating the authored `subscribe()` call is the
normal reconnect path and enumeration covers recovery when that input is not
at hand.

Closing a Session automatically closes its Signal subscriptions.

## Background Work

Work started from an active Session execution scope is owned automatically:

```ts
const work = await spawn(expensiveOperation, input)
```

No Session option or `backgroundWork()` contributor is required.

Durable Session ownership requires an exported named Work target. Inline
closures remain unavailable when restart-safe rejoin is required, following
the Background Work contract.

Before the Session can park, Crux durably records the attached Work reference.
Work completion, failure, or cancellation becomes small ordered internal
ingress. A parked Session wakes; a running Session receives it at the next safe
boundary.

Large Work results remain behind the Work handle or Tool surface. Crux injects
identity and concise lifecycle context, not an unbounded result payload.

Attached Work contributes to `pendingWork` and graceful closure waits for its
terminal delivery. The Agent or application may:

```ts
await work.cancel()
await work.detach()
```

After reconnecting, applications regain owner-scoped control without retaining
the original in-process handle:

```ts
const pending = await session.pendingWork()
```

`pendingWork()` returns reconnectable handles for currently attached
non-terminal Work. The existing Agent Work-control Tool provides the same
owner-scoped list, status, result, cancel, and detach actions inside the loop.
Admission limits count currently outstanding attached Work, not everything a
long-lived Session has ever completed.

Cancellation requests termination while retaining Session ownership and
terminal reporting. Detachment removes the Work from Session lifecycle:

- it no longer contributes to `pendingWork`;
- its completion no longer wakes the Session; and
- it no longer holds graceful closure open.

Session ownership removes the session-less orphan-completion warning.
Cancellation rollback for already executed effects follows the separate effect
contract and is not expanded by this design.

## Forking

```ts
const child = await parent.fork()
```

`fork()` is an ordered graceful barrier:

1. inputs accepted before the barrier finish or fail;
2. any active step and provisional streamed output reach a committed boundary;
3. the parent Thread position and processed cursor are snapshotted;
4. the child receives a new Session ID and independent Thread position; and
5. inputs accepted after the barrier remain parent-only.

The child:

- retains the same Agent identity and underlying Thread;
- starts parked;
- has an empty ingress queue;
- inherits no pending Work;
- inherits no Signal subscriptions;
- inherits no application key;
- owns an independent lifecycle; and
- may run concurrently with the parent.

Public direct lineage is:

```ts
child.forkedFrom
// { sessionId, cursor }

await parent.forks()
```

The complete descendant graph belongs in inspection and Devtools. V1 does not
define merge or rebase.

Fork lifecycle rules are:

- `running` and `parked` fork through the normal committed-boundary barrier;
- `closed` forks immediately from its frozen committed head into a new open,
  parked child without reopening or triggering the parent;
- `closing` rejects because the close barrier has sealed new descendants;
- `blocked` rejects because abandoning unresolved accepted state needs a
  separate recovery contract; and
- `deleted` rejects.

A fork racing close is serialized by the Session mutation order. If the fork
barrier is accepted first, child creation commits before the parent close
barrier. If close is accepted first, fork rejects.

## Lifecycle

### Park

Agent output parks an open Session. It never closes it implicitly.

### Graceful close

```ts
await session.close()
```

`close()` is an idempotent, joinable, ordered barrier:

- later external ingress rejects immediately;
- previously accepted ingress drains normally;
- the causal tree admitted before the barrier drains to quiescence;
- active steps finish at safe boundaries;
- Signal subscriptions close;
- crash recovery resumes the close operation; and
- the final closed state is frozen and readable.

Closing rejects new external roots such as later sends, Signal deliveries, and
timers. It does not break an already admitted activation merely because that
activation spawns Work after the close call. Such Work, and continuations
caused by its terminal delivery, remain descendants of the admitted causal
tree and therefore join the same close obligation.

Concretely, the barrier atomically seals external-root admission and records a
close generation over every already admitted root: accepted Agent inputs,
accepted Signal and timer occurrences, active activations, and attached Work.
Every descendant created while draining one of those roots inherits its root
and close generation. Subscription delivery racing the barrier is therefore
unambiguous: acceptance before the barrier joins the close obligation;
acceptance after it receives the terminal closed-target outcome.

Obligations discharge only at durable delivery boundaries:

- an ingress root drains after its delivery and resulting continuation commit;
- attached Work does not drain merely because its process reports a terminal
  state—its completion, failure, or cancellation occurrence must be accepted,
  delivered, and its resulting continuation committed;
- descendants created by that continuation join the same obligation tree;
- cancellation retains the branch until terminal reporting drains; and
- explicit detachment removes that Work branch from Session ownership and the
  close obligation.

Close never silently cancels or detaches Work. A stuck attached obligation
leaves the Session visibly `closing` until the application explicitly cancels
or detaches it through a retained handle, `pendingWork()`, or the owner-scoped
Agent Work-control Tool.

The close barrier completes only when the durable obligation set is empty and
no Session mutation is active. This subsumes pre-barrier non-input ingress,
terminal-but-not-yet-delivered Work, and every admitted descendant rather than
inferring quiescence from process status. The complete obligation tree is
internal; status, inspection, and Devtools explain which safe summaries still
hold the Session in `closing`. It may remain `closing` indefinitely; a future
destructive `kill()` is the separately designed bounded alternative.

Forked children are lifecycle-independent.

Closed Sessions reject messages, Signals, Work delivery, timers, and other
future ingress with a terminal closed-target outcome rather than retrying
forever.

### Delete

```ts
await session.close()
await session.delete()
```

V1 deletion is closed-only and idempotent. It removes:

- Session input payloads;
- completed typed turns;
- Session activity and stream data;
- Session-owned assets; and
- private execution state.

It retains only the minimal payload-free identity needed for anti-recreation,
key/idempotency safety, and fork lineage.

An application- or Agent-supplied Thread is never deleted automatically. An
automatically created Thread remains while any forked Session still owns a
position and may be erased with unreferenced assets after its final Session
owner is deleted.

Open or closing deletion rejects with guidance. It never acquires implicit
kill semantics.

### Future kill

A possible future `session.kill()` would immediately fence the Session and
aggressively terminate owned work. Its external-effect, cancellation, rollback,
and partial-output guarantees require a separate design. `close()` is never an
alias or weaker spelling for kill.

## Failure isolation

Failures use the narrowest honest ownership boundary:

### Before acceptance

Agent input-schema failure rejects `send()` before acceptance and consumes no
cursor.

### Per-input resolution

If one accepted input cannot resolve its dynamic prompt or policy before
joining an activation, only that input fails. The Session advances past it and
continues later cursor-ordered input. The same isolation applies when resolving
new input at a mid-turn boundary: failure terminalizes its handle without
changing the already running activation.

### Shared activation

A provider, Tool, output-validation, or shared execution failure after inputs
have joined one activation fails every input claimed by that activation with
one linked failure identity.

### Retry exhaustion

Retry exhaustion terminalizes the affected accepted handles and parks the
Session open. Ordinary activation failure never closes or permanently poisons
the Session.

### Blocked state

`blocked` is reserved for a condition requiring user action, such as:

- an incompatible Agent-definition contract;
- unavailable required durable capability;
- unresolved target identity; or
- an explicit migration requirement.

The blocker is inspectable and provides the smallest remediation. Ordinary
provider downtime is not by itself a permanent blocked state.

A blocked Session remains open and accepts bounded durable ingress:

- `send()` and `sendMany()` validate and accept normally;
- Signal deliveries and attached-Work completion retain cursor order;
- accepted-handle activity reports the blocker;
- no Agent activation runs until compatibility or capability preflight passes;
  and
- restoring a compatible target or capability automatically rechecks and
  wakes the Session.

The Session admission policy caps accepted non-terminal backlog. Once full,
new direct input fails before acceptance with an actionable backlog error;
already accepted Signal/Work delivery follows its owning durable delivery
contract. Requesting `close()` while blocked records the close barrier, but
causal quiescence cannot complete until the blocker clears or the affected
obligations become terminal.

## Agent definitions and upgrades

`agent.id` is the stable definition-family identity. V1 requires no
user-authored `version`.

Every activation records an automatic definition fingerprint:

- an active activation finishes on its pinned fingerprint;
- a newly waking Session resolves the latest definition with the same
  `agent.id`;
- compatible changes apply to the next activation; and
- incompatible retained contracts block with migration guidance.

Compatibility is contract-aware, not whole-fingerprint equality. Prompt,
model, Tool, context, and policy changes normally apply automatically.
Potential incompatibility includes pending typed inputs, retained typed
outputs, required durable state, or removed runtime capabilities that cannot be
validated against the new definition.

Operationally, before advancing a parked Session to a new fingerprint, Crux:

1. resolves the deployed runtime target for the same `agent.id`;
2. revalidates every pending canonical input against its current input schema;
3. validates retained typed output evidence needed by `session.history()`
   against the current output decoder or an exactly matching stored decoder;
4. verifies Thread, capability, and durable-state contracts; and
5. records the compatible transition before claiming new work.

Validation failure blocks with the affected evidence identities and migration
guidance; Crux never makes a lying TypeScript cast. Historical turns retain
their producing schema and definition fingerprints.

Crash recovery of an already active activation resolves its pinned executable
target artifact. Runtime manifests must retain that target until the
activation is terminal. If the pinned target is no longer resolvable, the
Session blocks rather than running the activation under newer code.

Explicit version and migration APIs wait for concrete migration workflows.

## Target resolution

Session wake execution reuses the Runtime Engine target resolver and handler.
There is no Session registry, route table, or provider-specific dispatcher.

In the common build/runtime path, exported Agents used by `session()` become
generated-manifest runtime targets. Low-level runtime handlers may list Agent
targets explicitly beside Flows and durable tasks.

`session()` preflights that the Agent can be resolved after process restart or
deployment. If not, it fails before creation with the smallest supported setup
fix.

`getSession(agent, id)` uses its Agent argument for static typing and identity
validation. The activated runtime manifest is the sole execution definition
source. Public handle typing does not require users to mount a registry.

## Required capabilities and setup

The durable Session contract requires:

- conditional Storage mutation;
- one active mutation lease with fencing;
- durable ingress and claim records;
- retained wake scheduling;
- restart-safe Agent target resolution; and
- a host/runtime capable of continuing after the initiating request returns.

These capabilities come from existing Crux Runtime, Storage, and platform
composition. Common adapters should bundle sensible implementations and reuse
the one configured global Storage. Session introduces no dedicated database,
queue, store, worker registration, or host setting.

If required capabilities are absent, `session()` fails before creating state.
The error:

1. names the missing capability;
2. explains the violated guarantee;
3. shows the smallest relevant configuration; and
4. is recorded in observability.

An explicit memory/test runtime may provide reduced behavior. Development must
warn prominently that restart, cross-process, or post-request durability is
absent. Behavior that succeeds in development but would fail in production
must produce a predictive diagnostic rather than silently appearing complete.

## Resumable streams

### Session-wide state stream

```ts
for await (const event of session.stream({ after: streamCursor })) {
  // reduce current Session state
}
```

The stream is resumable state delivery, not permanent raw-delta retention.

- `after` is an exclusive opaque `SessionStreamCursor`, distinct from the
  ingress acceptance `SessionCursor`.
- Omitting it emits a current `session.snapshot` followed by live activity.
- The SDK reconnects from the last delivered cursor.
- Delivery is ordered and at-least-once.
- Stable event IDs permit deduplication.
- Official reducers own deduplication and snapshot replacement.
- Slow consumers never block Session execution.

Recent canonical safe deltas may replay. Older token activity may compact into
completed-turn and output snapshots. Redacting a linked Thread entry removes
the affected turn's retained deltas and output snapshots; later snapshots show
only the redacted-turn variant. If a cursor expires or a consumer falls too far
behind, Crux emits a replace-state snapshot and continues. Malformed, foreign,
or unauthorized cursors reject.

A temporary transport disconnect does not end the logical stream. Graceful
closure, caller abort, deletion, or unrecoverable authorization/transport
failure does.

### Stable event taxonomy

Every public stream event has:

```ts
interface SessionEventBase {
  readonly id: string
  readonly cursor: SessionStreamCursor
  readonly at: Date
}
```

The conceptual discriminated union is:

```ts
type SessionEvent = SessionEventBase & (
  | {
      type: 'session.snapshot'
      reason: 'initial' | 'cursor-expired' | 'compacted'
      state: SessionView
    }
  | { type: 'session.status'; status: SessionStatus }
  | { type: 'ingress.accepted'; ingress: IngressSummary }
  | {
      type: 'ingress.delivered'
      ingress: IngressSummary
      turnId: string
      step: number
    }
  | {
      type: 'ingress.failed'
      ingress: IngressSummary
      error: SafeError
    }
  | { type: 'turn.started'; turnId: string; inputs: readonly string[] }
  | {
      type: 'turn.delta'
      turnId: string
      delta: GenerationStreamEvent
    }
  | { type: 'turn.completed'; turn: SessionTurn<unknown, unknown> }
  | { type: 'work.changed'; work: WorkSummary }
  | {
      type: 'subscription.changed'
      subscription: SubscriptionSummary
    }
  | { type: 'fork.created'; fork: SessionForkSummary }
)
```

`session.snapshot` always replaces local reducer state. Every other event is an
incremental update. `turn.delta` reuses Crux's provider-neutral generation
stream vocabulary rather than inventing Session-specific token, reasoning,
Tool, media, or structured-output deltas.

Retries, leases, wake attempts, and physical Storage commits remain
observability/inspection events rather than UI-stream discriminants.

### Input-scoped stream

```ts
for await (const event of sent.stream()) {
  // activity relevant to this accepted input
}
```

The scoped stream:

- projects the same `SessionEvent` vocabulary rather than defining another
  protocol;
- works after completion by reconstructing a scoped snapshot;
- may include events shared with coalesced inputs;
- exposes terminal failure in-band; and
- ends after the input reaches terminal success or failure.

`sent.result()` remains the throwing typed-result surface.

## Internal component boundaries

The implementation should preserve these provider-neutral units:

1. **Session handle** owns typed public methods and no execution loop.
2. **Session coordinator** owns acceptance, ordering, batching, leases, and
   lifecycle barriers.
3. **Session repository** owns conditional records, claims, commits,
   tombstones, and stream projections over standard Storage.
4. **Runtime wake adapter** owns target resolution and retained execution.
5. **Loop boundary adapter** owns pre-step delivery integration with
   Crux-owned loops and AI SDK.
6. **Thread/turn projector** owns canonical message publication and linked
   typed result evidence.
7. **Activity reducer** owns resumable state snapshots and deltas independently
   of transport.

`@use-crux/core` remains provider-agnostic. Provider packages depend on Core,
not the reverse. Next, Vercel, Cloudflare, Convex, and other framework packages
bind host/runtime capabilities without entering Core contracts.

## Observability and Devtools

Observability should record:

- Session creation or keyed retrieval;
- capability preflight and selected durability mode;
- input acceptance, identity, cursor, and wake intent;
- claim cutoff and batching membership;
- activation-policy fingerprints and split reasons;
- Signal and Work occurrence provenance;
- delivery turn, step, and boundary;
- immutable request-plan identity;
- provider attempts and retries;
- lease acquisition, recovery, and fencing;
- Thread and turn commit identities;
- stream snapshot, replay, and cursor-reset decisions;
- Agent-definition transitions and blockers;
- fork and lifecycle barriers;
- close, delete, cancellation, and detachment; and
- failure ownership and remediation.

Devtools should let a user answer:

- Why did this input enter this turn or step?
- Which inputs shared an activation and why?
- What did the model see?
- Was a provider call a new step or a retry?
- Why is the Session parked, blocked, or closing?
- Which Signal subscriptions and Work items still belong to it?
- Which definition fingerprint executed each turn?
- What durability guarantees were active?

Privacy-safe summaries are the default. Full payload access follows existing
observability authorization and redaction contracts.

## Project Index and Eval integration

Project Index should recognize:

- `session(agent, options)` target and Thread dependencies;
- `getSession(agent, id)` target references;
- `session.subscribe(signal)` relations;
- Session fork lineage operations; and
- Session lifecycle operations useful for linting.

Useful findings include unresolved runtime targets, conflicting Thread
bindings, Session use in a runtime lacking durable capabilities, and
application patterns that ignore accepted results without an intentional
stream or observability path.

Eval evidence should preserve Session, input, activation, turn, step, request,
Agent fingerprint, and replay identities. A Session scenario must be
reconstructable without treating transport timing as semantic input.

## Verification strategy

Testing should prioritize adversarial interleavings and crash recovery.

### Deterministic model tests

- input validation and acceptance identity;
- cursor ordering under concurrent callers;
- opportunity cutoffs;
- longest-consecutive compatible-policy batching;
- ordered activation splitting;
- terminal-step versus next-turn delivery;
- pre-step context-planning and `prepareStep` ordering;
- frozen provider retry behavior;
- typed turn and canonical message separation; and
- lifecycle state transitions.

### Property and concurrency tests

- no accepted ingress is lost;
- no cursor is processed twice;
- no committed step or Thread causal group is appended twice;
- only one logical mutation lease owns a Session;
- wake coalescing never suppresses required work;
- terminal park cannot race with acceptance;
- close barriers include exactly prior external roots and every admitted
  descendant;
- a pre-barrier Signal cannot be skipped by close;
- terminal Work cannot discharge close before its terminal occurrence and
  resulting continuation commit;
- cancellation retains and detachment removes the intended close branch;
- forks capture exactly one committed parent boundary; and
- keys never create two Sessions for one namespace and Agent identity.

### Fault injection

Crash before and after:

- input append;
- wake publication;
- lease acquisition;
- cutoff claim;
- ingress delivery commit;
- provider dispatch;
- Tool completion;
- Thread publication;
- typed-turn commit;
- processed-cursor advance;
- stream-event publication;
- fork barrier;
- close barrier; and
- deletion tombstone.

Recovery must either finish the unpublished transition or retry it
idempotently.

### Adapter parity

The AI SDK, OpenAI, Anthropic, and Google paths should pass one shared Session
loop contract suite:

- same definition of a step;
- same mid-turn delivery boundary;
- same Tool lifecycle validity;
- same retry versus new-step identity;
- same context-planning order;
- same structured-output and multimodal preservation; and
- same terminal-step handling.

### Stream tests

- reconnect after every event boundary;
- duplicate at-least-once delivery;
- expired cursor replacement;
- input-scoped reconstruction after completion;
- coalesced input event projection;
- slow and disconnected consumers;
- close and deletion termination; and
- malformed, foreign, and unauthorized cursors.

### Capability and upgrade tests

- each missing durable capability fails before creation;
- explicit memory/test mode emits predictive diagnostics;
- development diagnostics describe production differences;
- compatible Agent changes apply only to the next activation;
- incompatible retained contracts enter `blocked`;
- active activations finish with their pinned definition; and
- target disappearance produces actionable recovery guidance.

## Acceptance criteria

The design is satisfied when:

1. `await session(agent)` durably creates one parked typed Session without
   running the Agent.
2. `session(agent, { key })` atomically returns one stable lifecycle for that
   namespace and Agent identity.
3. `send()` returns only after durable acceptance and can be reconstructed
   after restart.
4. Concurrent sends preserve independent identity while batching at the next
   opportunity.
5. New ingress enters before a subsequent model step but never mutates an
   in-progress step.
6. Terminal-step ingress begins a new turn without a lost wakeup.
7. Provider retries use the same frozen request and cannot absorb later
   ingress.
8. Thread exposes canonical messages while Session exposes typed turns.
9. Signal subscriptions and attached Work wake the same ordered owner without
   becoming fake Agent input.
10. Fork, close, and delete obey their durable barriers across crashes.
11. Compatible Agent-definition changes apply between activations and
    incompatible changes block visibly.
12. Streams reconnect, deduplicate, replace expired state, and never block
    execution.
13. Missing runtime guarantees fail before creation with the smallest setup
    fix.
14. All supported adapter loops pass the same provider-neutral Session
    contract suite.

## Deferred extensions

Future designs may add:

- inert Swarm or another declared Session target;
- a reusable Session definition once repeated policy pressure exists;
- declared schema-validated Session application state;
- typed application events or annotations;
- externally steering running Work;
- explicit Agent version and migration workflows;
- destructive `kill()` semantics;
- merge or rebase of Session branches;
- Session-to-channel bindings;
- scheduled/timer subscriptions;
- advanced retention policies; and
- hosted coordination as one optional runtime adapter.

These extensions should preserve the serialized-owner, canonical-Thread,
safe-boundary, and honest-capability contracts defined here.
