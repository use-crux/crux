# Standalone Signals Design

Status: **proposed**

## Summary

Crux should provide a typed, reactive `signal()` primitive that can connect
external events, local callbacks, fresh agent runs, and durable Flow suspension
without making users adopt a hosted Crux platform.

The common API is deliberately small:

```ts
import { signal } from '@use-crux/core/signal'
import { z } from 'zod'

export const deployRequested = signal({
  id: 'deploy.requested',
  schema: z.object({
    environment: z.enum(['preview', 'production']),
    commit: z.string(),
  }),
})

await deployRequested.publish({
  environment: 'production',
  commit: 'abc123',
})
```

`signal()` only defines a typed event. It does not open a connection, start a
worker, or subscribe anything. Consumers opt in by using the same definition:

```ts
const productionDeploy = deployRequested.when((payload) => payload.environment === 'production')

const deployAgent = agent({
  id: 'deploy-agent',
  use: [productionDeploy],
  prompt: deployPrompt,
})

const occurrence = await flow.waitFor(deployRequested, { timeout: '24h' })

const subscription = deployRequested.subscribe(async (occurrence) => {
  console.log(occurrence.payload.commit)
})
```

Passing a Signal to an Agent has one meaning in V1: every matching accepted
occurrence starts a fresh, independent agent run. The occurrence is supplied as
canonical structured Signal context. There is no `trigger()`, `route()`, or
input-mapping layer in the common API.

Durability is a runtime capability, not a platform commitment. Crux owns the
portable semantics and adapters; users choose where those semantics run. A
high-level runtime adapter should make the normal case close to one-line setup,
while lower-level storage and execution ports remain composable for existing
infrastructure.

## Product principles

1. **Simple things stay simple.** Define, publish, place in `use`, or wait.
2. **Definitions are inert and composable.** Importing a Signal causes no I/O
   and creates no global subscription.
3. **Runtime is a capability, not a platform.** Crux may own durable execution
   semantics without owning the user's infrastructure.
4. **Guarantees are explicit.** Process-local behavior is never described as
   durable, and a fallback never silently weakens correctness.
5. **Progressive adoption is normal.** Local callbacks, one webhook, one Flow
   wait, or a complete durable agent system are all valid adoption points.
6. **Infrastructure stays replaceable.** High-level adapters provide defaults;
   lower-level ports allow composition on Node, Postgres, Convex, Cloudflare,
   or another suitable host.
7. **Authored code is the registration surface.** Project discovery may infer
   relationships from definitions and host bindings, but users do not repeat
   them in a global provider registry.
8. **Reactive evidence is first-class.** Every accepted occurrence and durable
   delivery remains attributable in the Project Index, runtime evidence, Evals,
   and Devtools.

## Scope

V1 covers:

- typed standalone Signal definitions;
- publication, validation, receipts, and optional publication idempotency;
- filtered Signal views;
- process-local callback subscriptions;
- fresh agent runs declared with `agent({ use: [signal] })`;
- durable `flow.waitFor(signal)`;
- provider, transport, and platform-binding contracts for ingress;
- a webhook transport and native platform bindings;
- durable fan-out, retries, leases, deduplication, and causal evidence; and
- Project Index, Devtools, and Eval integration.

The following remain separate future designs:

- targeting, resuming, waking, or injecting into an existing agent session;
- the durable/long-running Agent and Session model;
- outward SSE, WebSocket, or stream subscriptions to application clients;
- historical replay or backfill for consumers created after publication;
- cross-Signal joins, windows, or complex event processing;
- exactly-once delivery or global execution ordering;
- Crux-maintained service-specific integrations such as `githubSignals()`; and
- collapsing the existing Flow-local signal API into standalone Signals.

## Terminology

### Signal

An inert, globally identified, typed definition of something that can occur.

### Occurrence

One accepted publication of a Signal. It has a stable occurrence ID, validated
payload, acceptance timestamp, and provenance.

### Filtered Signal

An inert view created with `.when(predicate)`. It retains the source Signal's
payload and occurrence identity and narrows which occurrences a consumer
receives.

### Consumer binding

An authored relationship between a Signal or filtered Signal and a callback,
Agent, or Flow wait.

### Delivery

One attempt to make one occurrence available to one consumer binding. Delivery
identity is stable across retry.

### Transport

The raw ingress mechanism and its lifecycle, such as HTTP webhook, polling,
SSE, WebSocket, or another stream. A transport has no knowledge of Signals.

### Provider

Userland integration logic that interprets transport envelopes and publishes a
declared set of typed Signals.

### Platform binding

The small adapter that connects a Provider's transport requirements to a host
such as Next.js, Convex, Cloudflare, or Node.

## Public Signal contract

### Definition and typing

The conceptual public contract is:

```ts
type SignalSchema = StandardSchemaV1<unknown, JsonValue>

interface SignalOptions<TSchema extends SignalSchema> {
  readonly id: string
  readonly schema: TSchema
}

interface Signal<TSchema extends SignalSchema> {
  readonly _tag: 'Signal'
  readonly id: string
  readonly schema: TSchema

  publish(payload: StandardSchemaV1.InferInput<TSchema>, options?: SignalPublishOptions): Promise<SignalReceipt>

  when(
    predicate: (payload: StandardSchemaV1.InferOutput<TSchema>) => boolean,
  ): FilteredSignal<StandardSchemaV1.InferOutput<TSchema>>

  subscribe(
    callback: (occurrence: SignalOccurrence<StandardSchemaV1.InferOutput<TSchema>>) => Awaitable<void>,
  ): SignalSubscription
}

interface FilteredSignal<TPayload extends JsonValue> {
  readonly _tag: 'FilteredSignal'
  readonly signalId: string

  when(predicate: (payload: TPayload) => boolean): FilteredSignal<TPayload>

  subscribe(callback: (occurrence: SignalOccurrence<TPayload>) => Awaitable<void>): SignalSubscription
}

interface SignalPublishOptions {
  readonly idempotencyKey?: string
}

interface SignalOccurrence<TPayload extends JsonValue> {
  readonly id: string
  readonly signalId: string
  readonly payload: TPayload
  readonly acceptedAt: string
  readonly provenance?: SignalProvenance
}

interface SignalReceipt {
  readonly occurrenceId: string
  readonly signalId: string
  readonly acceptedAt: string
  readonly guarantee: 'durable' | 'process-local' | 'captured'
  readonly deduplicated: boolean
}

interface SignalProvenance {
  readonly kind: 'application' | 'provider' | 'runtime' | 'eval'
  readonly providerId?: string
  readonly transportKind?: string
  readonly bindingId?: string
}

interface SignalSubscription {
  close(): void
}
```

The exact internal schema abstraction should align with Crux's public schema
direction. The requirement is runtime validation plus input/output inference;
the API must not unnecessarily lock Signals to one schema library.

The schema-normalized output must be a Crux `JsonValue`. Schema transforms that
produce `Date`, `bigint`, class instances, `undefined`, non-finite numbers, or
another non-portable value fail validation before acceptance in both local and
durable modes. This gives every occurrence one portable representation across
stores, adapters, retries, and Evals.

Signal IDs are stable authored identities and must be unique in one activated
project/runtime namespace. Duplicate IDs with incompatible source definitions
are blocking diagnostics.

### Publication

`publish()` performs this logical sequence:

1. validate and normalize the payload;
2. derive or allocate a stable occurrence identity;
3. atomically accept the occurrence and its fan-out obligation at the strongest
   configured guarantee;
4. return a receipt describing the guarantee actually obtained; and
5. process the pinned durable candidates and best-effort process-local
   callbacks that were active when acceptance completed.

Publication waits for acceptance, not for consumer completion. One slow or
failed consumer cannot make another consumer's delivery fail.

With a durable runtime, occurrence acceptance and the obligation to create all
eligible deliveries are one crash-safe commit. Individual delivery records may
be materialized asynchronously from that obligation. A crash after the receipt
therefore cannot silently lose fan-out.

The durable obligation includes only durable bindings from the activated
runtime manifest and committed Flow waiters. Process-local `.subscribe()`
callbacks are notified separately on a best-effort basis after acceptance and
are never represented as recoverable fan-out obligations.

The receipt's `guarantee` describes occurrence acceptance, not the completion
or durability of every consumer. In particular, `.subscribe(callback)` remains
process-local even when its occurrence was accepted durably.

An invalid payload rejects before an occurrence is accepted. A persistence or
admission failure rejects without an accepted receipt. The error says which
capability was missing or failed, whether anything was recorded, and the
smallest concrete setup action that can remedy it.

Without `idempotencyKey`, every successful call is a distinct occurrence. With
one, repeated publication of the same Signal and key returns the existing
occurrence receipt and does not create duplicate deliveries. Payload conflicts
for an already accepted key are rejected rather than silently treated as the
same event. Conflict detection compares a canonical encoding of the
schema-normalized `JsonValue`: object keys are ordered deterministically, array
order is retained, and JSON scalar values compare exactly.

### Filtered views

`.when(predicate)` returns another inert value:

```ts
const failedProductionDeploy = deploymentChanged.when(
  (payload) => payload.environment === 'production' && payload.status === 'failed',
)
```

The predicate runs for each candidate delivery. It does not mutate, republish,
or create a new occurrence. Filters compose with every consumer kind:

```ts
agent({ id: 'incident-agent', use: [failedProductionDeploy], prompt })
await flow.waitFor(failedProductionDeploy)
failedProductionDeploy.subscribe(onFailure)
```

V1 treats a predicate as authored consumer code, not a serializable query
language. Runtime activation records a stable consumer-binding identity and
definition fingerprint so code changes are visible. It need not promise
storage-level filter pushdown.

A filtered view exposes `.when()` and `.subscribe()` and is accepted by Agent
`use` and `flow.waitFor()`. Chained `.when()` calls compose by conjunction in
authored order. A filtered view deliberately has no `.publish()` method:
publication always belongs to the source Signal.

Durable acceptance creates a candidate obligation for every active durable
binding before evaluating its filter. Each candidate pins the binding's
activation version and filter fingerprint. `false` produces a terminal
`filtered-out` delivery outcome. A filter exception is a failed attempt and
retries against the same pinned executable version; a later deployment cannot
silently substitute new predicate code for an already accepted occurrence.

A predicate exception fails only that consumer delivery. Durable delivery
follows the normal retry policy; a process-local callback reports the failure
through local observability.

### Process-local subscriptions

`.subscribe(callback)` is intentionally process-local. It returns a closeable
subscription, receives only occurrences published while it is active, and does
not imply replay, persistence, distributed coordination, or an outward client
stream.

This method is useful for local composition, tests, and applications whose
lifecycle already makes process-local behavior correct. Callback-delivery
evidence and Devtools must describe it as `process-local`; the publication
receipt continues to describe the occurrence's acceptance guarantee.

“While active” means in the same JavaScript process and Crux runtime instance.
After occurrence acceptance, callbacks are scheduled best-effort without
holding the publisher open. Process exit, invocation teardown, or a crash may
prevent or interrupt them even when the occurrence itself was accepted
durably.

## Agent integration

### One declarative meaning

An Agent subscribes by using the Signal definition:

```ts
const triageAgent = agent({
  id: 'pull-request-triage',
  use: [pullRequestChanged],
  prompt: triagePrompt,
})
```

This design adds agent-level `use` for lifecycle/capability bindings. It is
distinct from `prompt({ use })`, which continues to compose prompt context,
tools, constraints, and related contributors. V1 accepts Signals and filtered
Signals in the agent-level array; it does not move existing prompt contributors
or give prompt definitions an execution lifecycle.

Each matching accepted occurrence schedules a new independent run of that
Agent. Multiple Signals in `use` mean that an occurrence from any one of them
starts a run. Fan-out and retries retain one stable delivery ID per
Signal/Agent binding.

`use` declares the relationship. Users do not also write a callback, route, or
global subscription entry. Project discovery and runtime activation turn the
authored relationship into an active consumer binding.

### Signal context

A triggered run receives a canonical structured context contribution:

```ts
interface TriggeredSignalContext<TPayload> {
  readonly signal: {
    readonly id: string
    readonly occurrenceId: string
    readonly acceptedAt: string
    readonly payload: TPayload
    readonly provenance?: SignalProvenance
  }
}
```

The same data is attached to run metadata and causal evidence. If an Agent uses
multiple Signals, a run receives only the occurrence that triggered that run.

This keeps the default deterministic and avoids an input-mapping API. Signal
context is separate from the Agent prompt's caller-owned input. Therefore a
reactive Agent must be executable without unsatisfied required caller input.
Project discovery should diagnose a reactive Agent whose prompt still requires
caller-only fields and explain that those fields need defaults, static context,
or an explicit caller-controlled orchestration outside the Signal API. Crux
does not guess how arbitrary payload fields map into arbitrary prompt input.

Agent execution requires an active adapter and a host able to run the selected
model/tools. If no safe local execution path or durable runtime is available,
activation or publication fails cleanly instead of claiming that an Agent was
scheduled.

### Runtime activation

Project discovery describes relationships but does not execute Agent
definitions. Runtime generation creates an explicit activation manifest for
each reactive Agent binding containing:

- a generated/importable definition-module reference;
- Agent ID and definition fingerprint;
- Signal binding and filter fingerprint;
- executable target version; and
- required executor and host capabilities.

The Runtime or platform binding supplies the existing adapter-provided
`AgentExecutor` capability. Activation resolves the imported Agent, verifies
its fingerprint and capabilities, and only then makes the binding eligible for
new occurrences. Missing modules, mismatched definitions, or no compatible
executor fail activation with source-linked remediation; they do not create a
consumer that will fail only after publication.

An executable target version remains resolvable until all of its deliveries
are terminal. A rolling deployment may activate a new version for new
occurrences, but it cannot run an old candidate delivery with new Agent or
filter code. If a host cannot retain the pinned version, the delivery becomes
explicitly blocked rather than being reinterpreted.

### Parked session behavior

V1 does not define a session identifier or overload `use` with targeted
delivery. A later durable Agent/Session design may bind the same Signal
definition to an existing session and specify inject, queue, wake, resume, and
concurrency semantics. That future behavior must reuse occurrences and
deliveries rather than create a competing Signal abstraction.

## Flow integration and compatibility

Standalone Signals add an overload to the existing runtime wait primitive:

```ts
const occurrence = await flow.waitFor(deployRequested, {
  timeout: '24h',
})

occurrence.payload.commit
```

`flow.waitFor(signal)` suspends durably and returns the typed
`SignalOccurrence`, not only its payload. A filtered Signal may be passed in the
same position. The wait registers one durable consumer binding tied to that
Flow suspension point.

The existing Flow APIs remain unchanged:

- Flow-local declarations in `flow(name, { signals }, handler)`;
- `flow.suspend(localName)`; and
- `FlowHandle.signal(flowId, localName, payload)`.

Those APIs address a known Flow instance directly and use a Flow-local signal
map. Standalone Signals describe reusable pub/sub occurrences that can fan out
across consumers. V1 is additive: it does not migrate, alias, deprecate, or
silently reinterpret the existing local API.

`flow.waitFor(signal)` requires a Runtime because correct suspension must
survive the current call and process. Without one, it rejects before
registration with precise runtime setup guidance.

The race between a matching occurrence and the existing `flow.waitFor()`
timeout is resolved atomically by the Runtime waiter transition. Whichever
transition commits first wins; timeout retains the existing
`FlowExpiredError` outcome and the losing delivery cannot also resume the Flow.

## Delivery semantics

### Fan-out and retry

One occurrence creates an independent candidate delivery for every eligible
active durable binding. Its pinned filter decides whether that candidate
becomes a consumer delivery or the terminal `filtered-out` outcome.
Process-local callbacks are notified separately on the best-effort boundary
defined above.

Durable delivery is **at least once**. A handler, Agent, or resumed Flow can
observe the same occurrence again after a crash or ambiguous completion. The
occurrence ID and delivery ID remain stable across retries so consumer code,
tools, and effects can deduplicate safely.

Crux does not promise exactly-once effects. It should expose stable
idempotency/effect identities to downstream primitives and make retry evidence
obvious.

Accepted occurrence order is recorded. Consumers may start, retry, and complete
concurrently, so global completion order is not guaranteed. V1 does not add
per-Signal serialization or partition ordering.

### Consumer activation and replay boundary

Authored bindings become active when their runtime manifest is activated.
Process-local callbacks become active when `.subscribe()` returns. A Flow wait
becomes active when its suspension is durably committed.

Only bindings active when an occurrence is accepted are eligible. Creating or
activating a consumer later does not replay historical occurrences in V1.
Activation changes and rolling deployments must be recorded so Devtools can
explain which definition version was eligible.

For durable filtered consumers, “eligible” means a candidate obligation was
created for the active pinned binding. Whether it matched is the terminal
result of evaluating that pinned filter, not a decision that may be repeated
against whatever code happens to be deployed later.

### Failure isolation

- Validation and acceptance failures reject publication.
- Filter, callback, Agent, and Flow-resume failures affect only their delivery.
- Durable failures retry according to runtime policy with leases and backoff.
- Exhausted retries become an explicit blocked/failed delivery visible in
  runtime evidence and Devtools.
- Cancelling or removing one consumer does not cancel the occurrence or other
  consumers.

## Runtime capability and degradation

Crux should support high-level runtime composition:

```ts
export default config({
  runtime: node(),
})
```

and lower-level composition for users with existing infrastructure:

```ts
export default config({
  runtime: runtime({
    records: postgres({ connectionString }),
    worker: nodeWorker(),
  }),
})
```

These examples communicate the intended DX; exact adapter names belong to the
Runtime design and existing package conventions.

The runtime owns:

- durable occurrence acceptance;
- active consumer manifests;
- delivery records and fan-out;
- leases, wake-up, retries, and backoff;
- publication-idempotency records;
- Flow waiter resumption and fresh Agent work; and
- causal runtime evidence.

Core owns provider-neutral Signal definitions, schema validation, filtering
contracts, receipts, identifiers, and evidence shapes. Concrete host and
persistence packages depend on Core, never the reverse.

The degradation matrix is:

| Operation              | No durable Runtime                                                                                                       | Durable Runtime                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `signal.publish()`     | Accept process-locally when local consumers can be handled correctly; receipt says `process-local` and development warns | Persist before receipt; receipt says `durable`     |
| `.subscribe(callback)` | Works process-locally by definition                                                                                      | Still process-local; no misleading durable upgrade |
| Agent `use: [signal]`  | Execute only when an active local adapter can safely accept the work; otherwise fail with setup guidance                 | Schedule durable independent work                  |
| `flow.waitFor(signal)` | Fail before waiter registration                                                                                          | Suspend and resume durably                         |
| Provider webhook       | May publish process-locally when that is correct for the deployment                                                      | Accept durably before successful response          |

A fallback is allowed only when the requested operation remains correct and the
actual guarantee is returned and observed. Crux never silently labels
process-local acceptance durable. In production, a host binding that requires
durable acceptance should fail its request when the durable runtime cannot
accept the occurrence, allowing the source to retry.

## Ingress architecture

Transport, Provider, and platform binding are separate contracts.

### Transport

A transport owns raw mechanics and lifecycle only. For a webhook that includes
request decoding, size limits, verification/authentication, and producing a
verified envelope. It does not import Signal definitions, map business payloads,
or call `publish()`.

Conceptually:

```ts
const githubWebhook = webhook({
  verify: verifyGithubSignature,
})
```

Future polling, SSE, WebSocket, and stream transports use the same boundary but
may require cursor, reconnect, lease, and shutdown contracts. They should not be
forced into webhook request/response semantics.

### Provider

A Provider is userland source-specific interpretation:

```ts
import { signalProvider } from '@use-crux/core/signal/provider'
import { webhook } from '@use-crux/core/signal/transport'

export const github = signalProvider({
  id: 'github.pull-request-changed',
  transport: webhook({
    verify: verifyGithubSignature,
  }),
  signals: {
    pullRequestChanged,
  },
  async receive(envelope, { signals }) {
    await signals.pullRequestChanged.publish(mapPullRequest(envelope), { idempotencyKey: envelope.deliveryId })
  },
})
```

The `signals` record is the Provider's declared publication capability. It
preserves each Signal's payload types and prevents accidental publication to an
undeclared Signal. It uses the ordinary `.publish()` method; there is no second
provider-only publishing API.

Crux ships the Provider and transport primitives, not a growing catalog of
service-specific `githubSignals()`, `stripeSignals()`, and similar integrations.
Applications and ecosystem packages can define those integrations with little
code.

### Platform binding

One explicit host binding connects one Provider to one endpoint:

```ts
import { signals } from '@use-crux/next'
import { github } from './github'

export const POST = signals(github)
```

The helper adapts the host request/response lifecycle, supplies retention hooks,
and ensures an accepted response is sent only after the configured publication
guarantee is obtained. It does not require adding the Provider to global Crux
config.

Platform packages should offer equivalent idiomatic bindings for the hosts Crux
natively supports. A binding accepts one Provider rather than acting as an
implicit route multiplexer. A Provider's declared `signals` record may contain
the event types emitted by that one external endpoint.

Provider discovery comes from source and binding analysis. Runtime activation
uses generated/project manifests derived from that authored code, not implicit
package scanning or side-effectful global registration.

### Security and payload handling

Transport authentication completes before Provider interpretation and Signal
publication. An invalid signature or malformed raw envelope cannot create an
occurrence.

Raw headers, credentials, and verification secrets are not copied into Signal
payloads or durable evidence by default. Provenance stores safe identifiers
such as provider ID, transport kind, and binding source.
Signal payloads pass through Crux's safety, retention, and observability privacy
policies; Devtools must respect redaction rather than treating reactive payloads
as inherently safe.

The operational occurrence store may need the complete normalized payload to
deliver work. Its adapter owns encryption-at-rest support, access control, and
physical retention according to the configured Runtime policy. Observability
and Eval evidence are separate projections: they default to metadata and
redacted payload previews and include complete payloads only under an explicit
safe evidence policy.

## Project Index and Devtools

### Project Index

Source discovery should represent:

- Signal definitions and schemas;
- filtered Signal definitions;
- Provider and transport definitions;
- Provider-to-Signal publication relationships;
- Agent-to-Signal consumer bindings;
- Flow wait sites;
- platform bindings and their source endpoints; and
- source references for each relationship.

Diagnostics should cover duplicate Signal IDs, incompatible definitions,
reactive Agents with unsatisfied caller-only input, missing host bindings,
unsupported transport/host combinations, and providers that declare but never
publish a Signal.

Discovery makes authored relationships inspectable and supports runtime
manifests. It must not execute arbitrary user code or turn into implicit npm
package discovery.

### Runtime evidence

The canonical causal chain is:

```text
transport receipt
  -> provider receive
  -> signal occurrence
  -> consumer filter
  -> delivery
  -> agent run | flow resume | local callback
```

Every step carries source and definition identities. Triggered Agent runs and
resumed Flows link back to their occurrence and delivery. Retries reuse logical
identities while recording individual attempts.

### Devtools

A Signals view should show:

- definitions and source locations;
- ingress Providers, transports, and platform endpoints;
- current consumer bindings;
- recent occurrences and their actual guarantee;
- fan-out deliveries, attempts, latency, and failure state;
- publication deduplication;
- definition/activation versions; and
- links from an occurrence to every resulting Agent run or Flow resume.

This view should explain the system from both directions: “what reacted to this
occurrence?” and “what can trigger this Agent or Flow?”

## Eval contract

Eval execution must not accidentally launch uncontrolled background work.

By default, publishing inside an Eval is captured as Signal evidence rather than
dispatched to live durable consumers. Process-local live subscribers are also
suppressed. Signal-aware Cases may inject synthetic occurrences into an Agent
or Flow under test.

Every Case/Variant/trial receives an isolated Signal namespace. Publication
idempotency and occurrence identity are scoped to that namespace, so one trial
cannot deduplicate or trigger another. A captured publication returns the
normal receipt with `guarantee: 'captured'`; this means validated Eval evidence
was accepted, not that any production delivery was scheduled.

The Eval API should be able to assert:

- whether a Signal was published;
- payload and schema-normalized value;
- occurrence and publication-idempotency behavior;
- whether a filtered binding matched;
- the requested and actual guarantee;
- which consumer would be or was triggered; and
- causal linkage to a controlled Agent run or Flow resume.

Provider conformance tests feed raw transport envelopes through verification and
`receive()` without opening a real network listener. Runtime conformance suites
exercise the same fan-out, retry, lease, deduplication, and waiter behavior
across supported persistence adapters.

## V1 delivery order

Implementation should proceed in vertical slices:

1. typed inert Signal definitions, validation, process-local publication,
   receipts, `.when()`, and `.subscribe()`;
2. runtime occurrence/delivery records with durable acceptance, fan-out,
   retries, leases, deduplication, and evidence;
3. `flow.waitFor(signal)` while preserving all Flow-local APIs;
4. fresh Agent bindings through `use`, canonical Signal context, and
   definition-time diagnostics;
5. Provider and transport contracts plus a webhook transport;
6. native host bindings beginning with the platforms already supported by
   Crux's runtime packages;
7. Project Index, Devtools, and Eval projections across the completed slices.

Polling is the next transport after webhook. Long-lived SSE, WebSocket, and
stream transports follow only after their reconnect, cursor, lease, and
shutdown semantics have a separate validated design.

## Success criteria

The design succeeds when:

- a user can define a fully typed Signal in a few lines;
- publishing and consuming it locally requires no runtime setup;
- adding one Signal to an Agent starts a fresh run without a routing DSL;
- a Flow can suspend on the same definition and resume durably;
- a webhook Provider can be authored in userland and mounted with one idiomatic
  platform export;
- moving from local to durable execution does not require rewriting Signal,
  Agent, Flow, or Provider definitions;
- every returned receipt and Devtools record states the guarantee actually
  achieved;
- missing capabilities fail before false success with a specific remedy; and
- users can replace the runtime infrastructure without replacing the public
  reactive model.
