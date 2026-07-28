# Adaptive Execution Control Design

Status: **approved for specification review**

Companion designs:

- [Whole-Request Context Management](./2026-07-27-whole-request-context-management-design.md)
- [Joinable Background Work](./2026-07-23-joinable-background-work-design.md)
- [Durable Agent Sessions](./2026-07-28-durable-agent-session-design.md)
- [Native Subagent Supervision](./2026-07-28-native-subagent-supervision-design.md)
- [Bounded Media Streaming](./2026-07-27-bounded-media-streaming-design.md)
  ([PR #292](https://github.com/use-crux/crux/pull/292))

## Summary

Crux does not add a `controller()` primitive. `flow()` is the
application-controlled orchestration primitive:

```ts
const review = flow('review', async (flow, input: ReviewInput) => {
  const draftWork = await flow.spawn(writer, input)
  const draft = await draftWork.result()

  const stats = await flow.stats()
  const nextReviewer = stats.run.failures.total > 1 ? carefulReviewer : reviewer
  const reviewWork = await flow.spawn(nextReviewer, draft)

  return reviewWork.result()
})
```

Immediate Flow execution works without Runtime or Storage configuration.
Existing infrastructure strengthens the same Flow with restart-safe state and
statistics rather than requiring another definition or API.

The remaining adaptive-control problem is narrower: code sometimes needs to
change the next child invocation or provider call using execution facts and
typed application state, including inside opaque compositions and long-lived
Sessions.

Crux extends the already designed `prepareInvocation()` and `prepareStep()`
boundaries:

```ts
const reviewer = agent({
  id: 'reviewer',
  prompt: reviewPrompt,
  use: [reviewMemory],

  async prepareStep({ stats, resources }) {
    const state = await resources.read(controlState)

    if (state?.legalRisk) {
      return {
        model: strongerModel,
        use: { add: [legalContext] },
      }
    }

    if (
      stats.root.usage.coverage.cost === 'complete' &&
      stats.root.usage.costUsd !== undefined &&
      stats.root.usage.costUsd > 2
    ) {
      return { model: cheaperModel }
    }
  },
})
```

`stats` is a content-free, deeply readonly aggregate of what execution has
done. `resources.read()` provides read-only, execution-scoped access to
declared `workingState()` and Blackboard values. The callback returns the
existing constrained amendment shape, narrowed to the concrete operation.

Every new semantic preparation boundary is evaluated and journaled before
provider/child dispatch. Retry and replay of that accepted boundary reuse the
recorded amendment. There is no controller-owned mutable state, event-query
language, separate statistics store, media-specific controller, or new
infrastructure setting.

## Product boundary

Crux has three control owners:

```text
application decides what runs
└── flow()

model decides which authorized child runs
└── supervisor Agent

Crux prepares one upcoming execution boundary
└── prepareInvocation() / prepareStep()
```

An MVC web controller remains application request glue that calls Crux. It is
not a Crux primitive.

### Why no `controller()`

An executable:

```ts
controller({
  async run(control, input) {
    // branch, loop, spawn, wait, suspend
  },
})
```

duplicates `flow()`:

- ordinary TypeScript already owns branching and iteration;
- Flow definitions are typed, reusable, and nestable;
- Work handles own child lifecycle;
- Flow steps own retry and replay identity;
- Flow owns suspension, Signals, and optional durability; and
- Flow/Work observability already renders the execution tree.

A non-durable controller is therefore an immediate Flow, not a second
primitive. Documentation should say explicitly that Flows are Crux's
application-controlled Agent orchestration.

### Why no stateful `policy()`

Crux also does not reserve an attachable event-fold state machine:

```ts
policy({
  initial,
  reduce,
  amend,
})
```

Mechanical state such as attempts, usage, timing, and outcomes belongs to the
Runtime-owned statistics ledger. Semantic state belongs to Blackboard,
Memory/`workingState()`, or Thread. Another state container would duplicate
those systems, introduce another lifecycle and replay contract, and conflict
with Crux's protected policy terminology.

Preparation callbacks stay stateless. Their complete control relation is:

```text
committed execution statistics
+ declared typed state
→ constrained amendment
```

## Goals

1. Let application code adapt the next child/provider boundary from safe
   accumulated execution facts.
2. Preserve one controller story: Flow for orchestration, preparation hooks
   for boundary-local amendments.
3. Give hooks typed read-only access to existing structured state without raw
   Storage plumbing.
4. Work across Agent loops, fixed compositions, Sessions, Work, completed
   media operations, bounded media streams, and embeddings.
5. Keep accepted decisions deterministic across retry, crash, and deployment.
6. Expose one owner-scoped statistics read model to callbacks, application
   handles, Devtools, and Evals.
7. Require no statistics contributor, database, queue, host, or registration
   setting.
8. Preserve protected Safety, output, ownership, and hard-budget boundaries.
9. Keep statistics bounded, content-free, and useful for production control
   rather than only debugging.
10. Make missing usage and weaker process-local guarantees explicit.

## Non-goals

This design does not add:

- an executable `controller()` or stateful `policy()`/manager;
- arbitrary event queries or raw event arrays in callback context;
- mutable preparation resources;
- arbitrary resource loaders, Thread/message reads, retrieval, or knowledge
  search through `resources`;
- hard-budget enforcement through a read-plus-amendment callback;
- atomic state compare-and-set through preparation;
- raw provider messages or request replacement;
- provider-native option, credential, or header mutation;
- implicit text injection into non-language operations;
- implicit media capture or Memory write-back;
- media-specific iterative controller APIs;
- destructive changes to accepted Work during replay; or
- a second `resources: []` composition option.

## Terminology

### Managed operation

A Core-governed language, image, speech, transcription, embedding, or
streaming-media operation with normalized lifecycle, Safety, statistics, and
adapter behavior.

### Step

One semantic provider-call plan inside a managed operation. A language loop may
have several steps. A completed media operation currently has step index zero.
A future iterative media operation can have several steps without introducing
another hook.

A sealed step may have exact transport retries without reevaluating
preparation. A routing/fallback change that creates another provider-call plan
is a new preparation attempt and RequestPlan. The one authorized
context-overflow recovery from Whole-Request Context Management is narrower:
it derives a linked plan from the already accepted amendment and declared
representation ladder without rerunning user code.

### Preparation boundary

One `prepareInvocation()` or `prepareStep()` decision evaluated before
child/provider dispatch.

### Statistics

A bounded, immutable aggregate of committed mechanical execution facts.
Internal implementation and evidence records may use the term execution
evidence; the public noun is `stats`.

### Control-readable resource

A declared structured-state handle that the preparation mediator may read
without exposing mutation or Storage configuration. V1 supports
`workingState()` and Blackboard.

### Amendment

A constrained, operation-applicable delta evaluated by normal capability,
Safety, planning, and validation rules. It never replaces an entire request or
definition.

## Public API

### Preparation context

Conceptually:

```ts
type OperationKind = 'language' | 'image' | 'speech' | 'transcription' | 'embedding'

interface BasePreparationContext<Operation extends OperationKind, Stats extends PreparationStats> {
  readonly operation: Operation
  readonly stats: Stats
  readonly resources: PreparationResources
  readonly signal: AbortSignal
}

interface StepPreparationContext<Operation extends OperationKind> extends BasePreparationContext<
  Operation,
  StepPreparationStats
> {}

interface InvocationPreparationContext<
  Operation extends OperationKind,
  Target extends ManagedInvocationTarget<Operation>,
> extends BasePreparationContext<Operation, InvocationPreparationStats> {
  readonly target: Target
}
```

Existing hook-specific context such as Agent input, normalized Tool history,
composition target, Pipeline accumulator, Swarm hop, Thread revision, and
Session metadata remains available. This design adds `stats`, `resources`,
`signal`, and normalized operation identity; it does not replace those typed
contexts.

### Agent and direct language calls

An Agent may define a reusable default:

```ts
agent({
  id: 'writer',
  prompt: writerPrompt,
  use: [writerMemory],

  async prepareStep({ stats, resources }) {
    const state = await resources.read(writerState)

    return state?.phase === 'final'
      ? {
          model: finalModel,
          use: { add: [finalReviewContext] },
          activeTools: ['verify'],
        }
      : undefined
  },
})
```

Direct `generate()` and `stream()` invocation options accept the same hook.
The invocation hook overrides the Agent/default hook according to
Whole-Request Context Management; callbacks do not form hidden middleware
chains.

Multimodal language content and structured output use the same managed loop
and amendment contract.

### Fixed compositions

`parallel()`, `pipeline()`, `consensus()`, `swarm()`, and routing compositions
accept `prepareInvocation()`:

```ts
swarm({
  id: 'support',
  agents,

  async prepareInvocation({ target, stats, resources }) {
    const state = await resources.read(supportState)

    if (target.id === 'billing' && state?.legalEscalation) {
      return {
        model: strongerModel,
        use: { add: [legalContext] },
      }
    }
  },
})
```

The composition hook prepares one child invocation baseline. A later
`prepareStep()` inside that child prepares each managed provider call.

`prepareInvocation()` runs only when the composition is about to dispatch a
managed leaf target with one concrete `operation`:

- an Agent is a `language` target, including multimodal language input;
- a completed/streaming image, speech, transcription, or embedding definition
  carries its corresponding operation kind; and
- the callback return type is
  `PreparationAmendment<typeof target.operation>`.

A function-only Pipeline stage or nested orchestration/composition has no
single provider operation. The outer composition records its statistics but
does not call `prepareInvocation()` for that wrapper boundary. If it dispatches
managed leaves, its own child boundary invokes its own composition hook.
Crux does not guess an operation or accept an amendment that may later be
inapplicable.

### Flow

Inside a running Flow:

```ts
const stats = await flow.stats()
```

The call is replay-visible. On first execution it commits the current snapshot
at that Flow position; replay returns that recorded snapshot. A later,
separately positioned call may observe newer facts. This lets ordinary
TypeScript branch on statistics without replay divergence.

From the definition handle:

```ts
const stats = await reviewFlow.stats(flowId)
```

The method name says the value is a read-only fact snapshot, not a live
execution handle. `flow.status()` is not introduced because status convention
belongs to lifecycle state.

### Session, Work, and streaming handles

Every addressable owner exposes the same read capability:

```ts
await session.stats()
await work.stats()
await mediaStream.stats()
```

Existing `status()` methods remain compact lifecycle views:

```ts
await work.status() // queued/running/suspended/completed
await work.stats() // usage/timing/calls/outcomes
```

`StreamingOperationResult` is amended conceptually:

```ts
interface StreamingOperationResult<Event, Result> {
  readonly runId: CruxRunId
  readonly _meta: OperationResultMeta
  readonly fullStream: AsyncIterableStream<Event>
  readonly completion: Promise<Result>

  stats(): Promise<OwnerStats>
  cancel(reason?: unknown): void
}
```

Returning early from one stream reader never ends accounting or the logical
operation.

## Statistics contract

### Public shape

Preparation receives:

```ts
interface PreparationStats {
  readonly at: Date
  readonly cursor: ActivityStreamCursor

  readonly attempt: AttemptStats
  readonly run: ScopeStats
  readonly root: ScopeStats

  readonly flow?: ScopeStats
  readonly session?: ScopeStats
  readonly composition?: ScopeStats
  readonly work?: ScopeStats
}

interface StepPreparationStats extends PreparationStats {
  readonly stepIndex: number
}

type InvocationPreparationStats = PreparationStats
```

`prepareStep()` receives `StepPreparationStats`.
`prepareInvocation()` has no provider step and receives
`InvocationPreparationStats`; its existing composition-specific context
identifies the stage, branch, target, hop, or candidate.

Handle methods receive the same read model without one immediate preparation
attempt:

```ts
type OwnerStats = Omit<PreparationStats, 'attempt'>
```

`run` is the owner currently being controlled. `root` is the outer activity
root. Optional named scopes expose the nearest containing owner of that kind.
They are not an arbitrary ancestry query API.

Examples:

```text
provider step inside Agent inside Flow inside Session

stats.run         = current Agent activation
stats.flow        = nearest Flow run
stats.session     = Session lifetime
stats.root        = Session when it is the activity root
```

When the current run is also the root, both snapshots carry the same totals.

For an owner-handle read, `run` means the addressed owner, not whichever
descendant happens to be active at read time:

| Read                           | `run` identity                    |
| ------------------------------ | --------------------------------- |
| `flow.stats()`                 | current Flow instance             |
| `flowDefinition.stats(flowId)` | addressed Flow instance           |
| `session.stats()`              | addressed Session                 |
| `work.stats()`                 | addressed Work item               |
| `mediaStream.stats()`          | addressed logical media operation |

`root` is that owner's activity root. Optional named scopes describe the
addressed owner's own identity and ancestors, including the addressed owner
when its kind matches. An active descendant contributes committed totals
upward but never changes which owner `run` denotes. The numeric snapshot may
therefore grow while its scope identities remain stable. A child handle is the
way to inspect the child's own `run`.

### Attempt

```ts
interface AttemptStats {
  /** One-based candidate attempt within this preparation boundary. */
  readonly number: number
  readonly reason: 'initial' | 'retry' | 'fallback' | 'validation-retry'

  readonly previousFailure?: {
    readonly kind: FailureKind
    readonly code?: string
  }
}
```

Failure summaries contain normalized safe categories/codes, never messages,
provider payloads, Tool arguments, or output.

### Scope aggregates

The following interfaces are conceptual. Exact integer brands and timestamp
representations follow existing Core conventions:

```ts
interface ScopeStats {
  readonly usage: UsageStats
  readonly timing: TimingStats

  readonly modelCalls: ModelCallStats
  readonly tools: ToolStats
  readonly work: WorkStats
  readonly failures: FailureStats
  readonly approvals: ApprovalStats
  readonly lifecycle: LifecycleStats
}

interface UsageStats {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly cachedInputTokens?: number
  readonly reasoningTokens?: number
  readonly costUsd?: number

  readonly coverage: {
    readonly tokens: Coverage
    readonly cost: Coverage
  }

  readonly byModel: Readonly<Record<string, ModelUsageStats>>
  readonly otherModels?: ModelUsageStats
  readonly modelAttribution: AttributionCoverage
}

type Coverage = 'complete' | 'partial' | 'none'
type AttributionCoverage = 'complete' | 'truncated'

interface ModelUsageStats {
  readonly calls: number
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly cachedInputTokens?: number
  readonly reasoningTokens?: number
  readonly costUsd?: number
  readonly coverage: {
    readonly tokens: Coverage
    readonly cost: Coverage
  }
}

interface TimingStats {
  readonly startedAt: Date
  readonly updatedAt: Date
  readonly completedAt?: Date
  readonly wallTimeMs: number
  readonly activeTimeMs: number
  readonly suspendedTimeMs: number
}

interface ModelCallStats {
  readonly started: number
  readonly succeeded: number
  readonly failed: number
  readonly cancelled: number
  readonly transportRetries: number
}

interface ToolStats {
  readonly total: ToolOutcomeStats
  readonly byName: Readonly<Record<string, ToolOutcomeStats>>
  readonly otherNames?: ToolOutcomeStats
  readonly nameAttribution: AttributionCoverage
}

interface ToolOutcomeStats {
  readonly called: number
  readonly succeeded: number
  readonly failed: number
  readonly denied: number
  readonly cancelled: number
}

interface WorkStats {
  readonly total: WorkOutcomeStats
  readonly byTarget: Readonly<Record<string, WorkOutcomeStats>>
  readonly otherTargets?: WorkOutcomeStats
  readonly targetAttribution: AttributionCoverage
}

interface WorkOutcomeStats {
  /** Cumulative transitions/final outcomes through the snapshot cursor. */
  readonly started: number
  readonly completed: number
  readonly failed: number
  readonly cancelled: number
  readonly detached: number

  /** Current nonterminal population at the snapshot cursor. */
  readonly current: {
    readonly queued: number
    readonly running: number
    readonly suspended: number
    readonly blocked: number
  }
}

interface FailureStats {
  readonly total: number
  readonly byKind: Readonly<Record<FailureKind, number>>
}

type FailureKind =
  | 'provider'
  | 'tool'
  | 'work'
  | 'approval'
  | 'safety'
  | 'validation'
  | 'preparation'
  | 'timeout'
  | 'runtime'
  | 'unknown'

interface ApprovalStats {
  readonly requested: number
  readonly approved: number
  readonly denied: number
  readonly expired: number
}

interface LifecycleStats {
  readonly suspensions: number
  readonly resumptions: number
  readonly cancellations: number
  readonly steeringInputs: number
}
```

`tools.total`, `tools.byName`, `work.total`, and `work.byTarget` are ordinary
serializable maps. Crux does not add selector methods or an event-query DSL.
Implementations may add bounded, similarly mechanical aggregates only through
a normal public API review.

Map keys are normalized definition/model identities, not Work IDs, request IDs,
arbitrary user labels, or content. V1 retains at most 64 explicit identities
per map and owner:

1. the first 64 identities by committed activity cursor receive stable slots;
2. slots are never evicted or reassigned within that owner;
3. every later identity aggregates into the corresponding `other*` field; and
4. attribution becomes `truncated`.

The total aggregate remains complete to the degree allowed by its ordinary
usage coverage; only per-identity attribution is truncated. A separate field
avoids reserving a magic string key that could collide with a real definition.
Replay and recovery use the committed cursor order, so slot assignment is
deterministic. The fixed bound is a Core contract, not another user setting.
Attribution `complete` requires the corresponding `other*` field to be absent;
`truncated` requires it to contain the aggregate of every overflow identity.

All counters are cumulative except `WorkOutcomeStats.current`, whose fields are
gauges at `stats.cursor`. `started` counts accepted Work that entered
execution; exact retry of one Work attempt does not start another Work item.
`ModelUsageStats.calls` counts sealed semantic RequestPlans dispatched with
that normalized model. A route/fallback plan increments it; an exact transport
retry does not. Usage reported by any physical retry still attributes to that
model, and `ModelCallStats.transportRetries` exposes the retry count
separately.

The aggregates include facts, not content:

- usage, cache usage, and cost reported by adapters;
- timing;
- provider-call and transport-retry counts;
- Tool outcomes;
- child Work outcomes;
- normalized failure categories;
- approval outcomes; and
- suspend, resume, cancel, and steering counts.

They exclude prompts, messages, model output, Tool arguments/results, media
payloads and URLs, arbitrary error messages, and raw activity events.

### Usage coverage

Absent usage is unknown, never zero. Token and cost coverage are independent:

```ts
if (stats.root.usage.coverage.cost !== 'complete') {
  // Do not treat a missing cost as a hard fact.
}
```

Adapters normalize provider-reported usage. Crux may calculate cost only when
the user or adapter supplies a versioned cost source. Core must not embed a
silently mutable global price table. Provider omissions produce `partial` or
`none` coverage and a diagnostic when a callback appears to rely on the
missing field.

For that diagnostic only, the preparation view tracks reads of optional token
and cost fields. If a callback reads a field whose coverage is not `complete`
and then returns a non-empty amendment, development warns with the field and
coverage. Reading coverage itself or returning no amendment does not warn.
This access trace is not part of request identity and does not expose content.

### Snapshot and consistency model

`stats.cursor` is an opaque activity-stream cursor. A snapshot contains all
committed facts through that cursor and may include currently queued, running,
suspended, or blocked Work. Reading statistics never waits for concurrent Work
to settle.

After:

```ts
await child.result()
```

the child's terminal fact is causally committed and therefore appears in the
next parent snapshot.

Preparation receives one deeply frozen snapshot. Repeated field reads do not
advance it. On first execution, `await flow.stats()` performs a fresh read and
records it at that replay position; replay returns the recorded snapshot.
External definition-handle, Session, Work, and streaming-operation reads
perform fresh reads.

Statistics are incrementally maintained as a bounded owner read model. A read
must not scan an unbounded event history. Small terminal summaries can outlive
large result payload retention, so an expired Work result does not imply that
its usage and outcome disappear.

### Retention and expiry

Statistics live with the smallest existing owner summary that can reconstruct
them:

- Work uses the terminal Work summary governed by Runtime
  `retention.terminalWork`;
- Flow uses the Flow snapshot governed by
  `retention.terminalSnapshots`;
- Session uses the durable Session summary for as long as that Session record
  is retained;
- a Runtime-owned media operation uses its owning run/Work summary; and
- an immediate process-local media handle retains its final snapshot for the
  lifetime of that handle/process.

Result-payload expiry does not prune owner statistics. Once the owner summary
itself has expired or is unavailable, `stats()` never replays execution or
scans a partially retained event log:

```ts
class StatsUnavailableError extends Error {
  readonly reason: 'expired' | 'not-found'
  readonly owner: {
    readonly kind: OwnerKind
    readonly id: string
  }
  readonly expiredAt?: Date
}
```

Authorization failures continue to use the owning handle's access error and
must not reveal whether another tenant's statistics exist.

### Infrastructure and guarantees

Statistics work automatically:

- immediate execution maintains them in memory;
- configured Runtime and Storage make the same ledger restart-safe;
- Evals use a deterministic virtual ledger; and
- no `use` contributor, statistics store, host, queue, or extra config entry is
  required.

If an application starts durable work while the statistics ledger is only
process-local, development emits the same predictive durability class of
warning as the owning primitive. Crux must warn before production-shaped code
can appear durable in development and then silently lose control facts after a
restart.

### Adaptation is not enforcement

Preparation observes a committed snapshot and proposes the next amendment.
Two concurrent branches may both observe the same prior total. This makes the
API suitable for routing, degradation, escalation, and soft limits, but not
atomic hard-budget enforcement.

Hard ceilings belong to a future Runtime admission/budget mechanism.
Concurrency and fan-out ceilings belong to Work policy. The public API and
documentation must not imply that:

```ts
if (stats.root.usage.costUsd < 10) {
  // spend
}
```

is a transactional reservation.

## Control-readable resources

### API

Preparation receives a read-only mediator:

```ts
interface PreparationResources {
  read<T>(resource: ControlReadable<T>): Promise<T | null>
}
```

The method has no options bag. It automatically inherits the preparation
deadline, cancellation signal, execution identity, tenant, authorization
boundary, and replay journal.

V1 admits only existing structured-state resources:

```ts
const state = workingState({
  id: 'control-state',
  schema: controlStateSchema,
})
const board = blackboard({
  id: 'team-board',
  schema: boardSchema,
})
const memory = memory({
  id: 'control-memory',
  blocks: [state],
})

const worker = agent({
  use: [memory, board],

  async prepareStep({ resources }) {
    const current = await resources.read(state) // ControlState | null
    const shared = await resources.read(board) // Partial<Board> | null
  },
})
```

`null` means the resource is declared and readable but has no value yet.
`undefined` is not another state, and there is no `{ optional: true }`.

### Declared graph, not rendered graph

A resource is readable when its handle belongs to the inherited declared
contributor graph for that boundary. Rendering and control state are separate:

- `when()` being false does not hide the declared resource;
- a smaller `prefer()` representation does not hide it;
- a context being omitted by budget optimization does not hide it; and
- planner facet selection does not change read authority.

These mechanisms control model-facing contribution, not application-state
visibility.

An undeclared handle is a programming error even if it resolves to the same
Storage key as a declared handle. Preparation does not expose arbitrary
Storage access.

### Supported resource contract

The V1 set is deliberately small:

- `workingState<T>` reads `T | null`;
- Blackboard reads `Partial<T> | null`.

Thread messages, transcript history, retrieval, knowledge sources, context
rendering, assets, raw Storage, and arbitrary loaders are not readable through
this API. They each have different privacy, cost, identity, and replay
semantics.

A future resource kind must explicitly implement a Core-owned
`ControlReadable<T>` contract. Being a `use[]` contributor alone never grants
read access.

### Ordering

The declared graph evolves only at preparation boundaries:

```text
definition + direct invocation
→ inherited invocation baseline
→ prepareInvocation reads inherited resources
→ accepted invocation amendment creates child baseline
→ prepareStep reads that child baseline
→ accepted step amendment creates provider-call graph
```

Consequently:

- `prepareInvocation()` cannot read a resource that it adds itself;
- the child `prepareStep()` can read a resource added by the accepted
  invocation amendment; and
- `prepareStep()` cannot read a resource it adds in that same callback.

This avoids a callback whose authority changes halfway through its own
evaluation.

### Read consistency and privacy

Reads are lazy and boundary-local. The first read pins the resource value and
revision for the decision. Repeated reads return the same value. If normal
context resolution later renders that resource in the same boundary, it
reuses the pinned revision rather than fetching a newer one. A new preparation
boundary receives a fresh view.

The decision journal records resource identity, revision, and a
privacy-preserving value hash. It does not record the value in the adaptive
decision record. Existing resource-specific persistence and trace redaction
still apply.

### Read errors

Abnormal reads reject with a typed error:

```ts
class ResourceReadError extends Error {
  readonly reason: 'undeclared' | 'unauthorized' | 'unresolved' | 'storage-unavailable'
}
```

Crux does not turn those states into `null`. A user may choose an explicit
fallback:

```ts
async prepareStep({ resources }) {
  try {
    const state = await resources.read(controlState)
    return state?.urgent ? { model: urgentModel } : undefined
  } catch (error) {
    if (
      error instanceof ResourceReadError &&
      error.reason === 'storage-unavailable'
    ) {
      return { model: safeDefaultModel }
    }

    throw error
  }
}
```

The failed read and the chosen amendment remain observable. Preparation never
gets a write API; state mutation belongs to the owning resource's normal Tool,
Flow, effect, or application API.

## Universal `use[]` applicability

Every managed operation accepts the ordinary `use[]` contributor graph:

```ts
await generateImage({
  model,
  prompt,
  use: [brandContext, imagePolicy, generationState],
  prepareStep,
})
```

Crux does not add a parallel `resources: []` option or a control wrapper.
Contributors can expose operation-specific representations, cross-cutting
capabilities, and control-readable state through the same compositional unit.

Operation families are intentionally coarse:

```ts
type OperationKind = 'language' | 'image' | 'speech' | 'transcription' | 'embedding'
```

`when()` and `match()` preserve the wrapped contributor's applicability types.
At compile time where possible, and otherwise during preflight, Core classifies
each contributor facet:

1. **Applicable** — it has a representation or capability for this operation.
2. **Inapplicable facet** — that facet is dormant, but another facet engages.
3. **Inert contributor** — every facet is inapplicable; reject it.
4. **Unsupported required representation** — fail before provider I/O.
5. **Omitted optional representation** — legal, explicit, and observable.

For example, Memory used with an image operation may provide readable
structured state while its language transcript representation is dormant. A
text-only brand context with no image or cross-cutting facet is inert and is
rejected instead of silently doing nothing.

Safety, guardrails, constraints, approvals, and other applicable behavioral
capabilities remain protected. Operation applicability does not make them
droppable.

Contributor identity, selected facets, state revision/value hashes, and legal
omissions enter RequestPlan identity and Eval evidence. When implemented, this
changes managed task-evidence identity and therefore requires the relevant
`TASK_EVIDENCE_CACHE_EPOCH` bump.

## Preparation amendments

### One family, operation-narrowed

`prepareStep()` is present on every managed operation. Its return type is
narrowed by `operation`, so a user cannot accidentally set `voice` on an image
request or `activeTools` on an embedding:

```ts
interface AmendmentByOperation {
  language: LanguageAmendment
  image: ImageAmendment
  speech: SpeechAmendment
  transcription: TranscriptionAmendment
  embedding: EmbeddingAmendment
}

type PreparationAmendment<Operation extends OperationKind> = CommonAmendment<Operation> &
  AmendmentByOperation[Operation]

interface CommonAmendment<Operation extends OperationKind> {
  readonly model?: CompatibleModel<Operation>
  readonly use?: {
    readonly add?: readonly AmendableContextEntry[]
    readonly remove?: readonly ContributorSelector[]
  }
}
```

This is one conceptual API, not a demand that implementation use this exact
conditional type.

Common authority is deliberately small:

- switch to a compatible normalized `model`;
- add or remove amendable `use[]` contributors; and
- preserve all ordinary capability, identity, Safety, and validation checks.

Language keeps the amendment fields from Whole-Request Context Management:

```ts
interface LanguageAmendment {
  readonly tools?: ToolSet
  readonly activeTools?: readonly string[]
  readonly inputBudget?: InputBudget
}
```

Context added through `use` may bring owned Tools. Tool collision, approval,
guardrail, constraint, and active-selection behavior remains exactly as
specified by the companion design.

### Portable media allowlists

Completed and streaming media operations expose only normalized, portable
amendments already supported by the operation contract:

```ts
interface ImageAmendment {
  readonly n?: number
  readonly size?: ImageSize
  readonly aspectRatio?: ImageAspectRatio
  readonly seed?: number
}

interface SpeechAmendment {
  readonly voice?: Voice
  readonly outputFormat?: SpeechOutputFormat
  readonly speed?: number
  readonly language?: string
}
```

The exact public option names and validators in each completed-operation
contract are authoritative; notably image count remains `n`, not a second
`count` alias.

Transcription amendments may change only clearly portable execution options
that do not change the requested meaning or output detail. V1 defines no such
transcription-specific fields:

```ts
type TranscriptionAmendment = Record<never, never>
```

The common compatible `model` and `use` amendments remain available. Task,
language intent, timestamp granularity, diarization, output contract, and
equivalent meaning-bearing fields remain fixed.

Embedding amendments are routing-only in V1. A model change is legal only when
the target has the same declared embedding-space fingerprint, including:

- dimensions;
- normalization;
- input modality; and
- semantic task.

Crux must reject a switch that would make stored and newly generated vectors
incomparable.

```ts
type EmbeddingAmendment = Record<never, never>
```

Its only V1 fields therefore come from `CommonAmendment<'embedding'>`.

### Immutable authority

Preparation cannot amend:

- canonical prompts, reference images, input text/audio, or embedding values;
- Safety rules, guardrails, constraints, or approval policies;
- output schemas and structured-output contracts;
- abort signals, deadlines, or hard budgets;
- credentials, headers, raw provider options, or adapter-native extras;
- Thread, Session, owner, root, idempotency, or tenancy identity; or
- the definition of already accepted Work.

The hook returns a delta. It never receives or returns a mutable provider
request.

### Media Memory behavior

Using Memory with image, speech, transcription, or embedding operations has a
strict V1 meaning:

- structured state may be read when the Memory exposes a control-readable
  state handle;
- Crux does not implicitly turn language transcript content into a media
  prompt;
- completed output is not implicitly written back;
- progressive image/audio frames are never exposed to Memory; and
- partial, failed, cancelled, or Safety-blocked output is never captured.

A future media-capture capability must be explicit and operation-applicable. It
may see only finalized, validated, post-Safety output.

### Boundary behavior across operation families

For language, a semantic Tool loop can call `prepareStep()` several times.
For completed image, speech, transcription, and embedding V1 operations, the
single provider-call plan is step zero.

For `streamImage()` and `streamSpeech()`, preparation occurs before the
logical stream's provider-call plan. Stream events do not trigger callbacks.
A future iterative media implementation may introduce further semantic steps
through this same hook, without a media controller API.

An exact transport retry of a sealed plan reuses the decision. A fallback or
route that creates a different provider-call plan receives a new
`AttemptStats` snapshot and evaluates preparation again.

This section intentionally supersedes the language-only non-goal in the
Whole-Request Context Management companion design.

## Preparation lifecycle and replay

### Evaluation sequence

For every semantic boundary, Core:

1. resolves the immutable inherited baseline;
2. snapshots committed execution statistics;
3. constructs the declared control-readable resource mediator;
4. runs the callback under its deadline and `AbortSignal`;
5. pins any resource revisions read by the callback;
6. validates the amendment and operation applicability;
7. resolves the final contributor/capability graph;
8. seals the normalized RequestPlan;
9. commits the decision record and plan before dispatch; and
10. dispatches the child or provider call.

No provider or child I/O may start before step 9 succeeds.

The callback does not automatically retry as a unit. An individual Storage
adapter may perform its ordinary safe read retries. An outer Flow or
composition may explicitly retry a failed preparation boundary.

### Decision record

The committed record contains:

- operation and boundary identity;
- callback source identity;
- statistics cursor and content-free snapshot;
- resource identities, revisions, and value hashes;
- requested and resolved amendment;
- contributor applicability and optional omissions;
- validation and compatibility outcomes; and
- the sealed RequestPlan identity.

It excludes resource values, prompts, messages, Tool arguments/results, media
payloads, arbitrary provider bodies, and raw errors.

### Retry, recovery, and deployment

Once accepted:

- exact network/rate-limit retry reuses the sealed plan and amendment;
- one context-overflow recovery may seal a linked plan from another already
  authorized representation, while reusing the accepted amendment and not
  rerunning callback code;
- crash recovery after acceptance reuses the journaled decision;
- code deployed after acceptance cannot change that work item; and
- Evals can replay the accepted decision from its recorded inputs.

If the decision record did not commit, dispatch did not occur. The boundary may
therefore be evaluated again safely.

A read-only Devtools preview may run callback logic against an explicit
snapshot, but that result is advisory. Actual execution reevaluates and commits
against its own current boundary.

## Bounded media streaming integration

This design extends the bounded media streaming contract from PR #292; it does
not replace its routing or publication semantics.

A logical `streamImage()` or `streamSpeech()` operation may make several
physical attempts before the first public event. Statistics distinguish:

- one logical operation;
- each semantic provider-call plan/attempt;
- exact transport retries; and
- the final route commitment.

Preparation runs for a new semantic plan. It does not run for each chunk,
progress event, preview frame, or transport retry.

Before the first allowed public event, routing may fall back according to the
existing contract and a new plan receives fresh preparation. The first public
event commits the route. A later provider failure terminates that logical
stream; Crux never mixes media from another provider into it.

`mediaStream.stats()` remains readable while the stream is live and after
completion within the owner's normal statistics retention window. Accounting
continues if one `fullStream` reader returns early. `cancel()` ends the logical
operation according to the existing stream contract and records cancellation.

Only safe event descriptors may update statistics—for example event kind,
sequence count, and normalized timing. Statistics never retain frame bytes,
audio chunks, prompt content, URLs, payload hashes that can become correlating
identifiers, or adapter-native event bodies.

## Composition, Session, and Work semantics

### Layering

Preparation amendments remain non-accumulating:

```text
definition + direct invocation
+ fresh prepareInvocation amendment
= child invocation baseline

child invocation baseline
+ fresh prepareStep amendment
= one provider-call plan
```

The invocation amendment is inherited by the selected child. A step amendment
applies only to its one semantic provider plan and is recomputed for the next
step.

Statistics do accumulate within their owner scopes. A child contributes
mechanical totals upward even though its semantic context remains isolated.

### Session

Within a Session activation:

- `stats.run` is the current Agent/composition activation;
- `stats.session` is the Session lifetime;
- `stats.root` is the Session when it owns the activity root; and
- steering, parking, resumption, Work delivery, and close outcomes update the
  Session's mechanical aggregates.

The Thread stores semantic conversation history. The statistics ledger stores
mechanical execution facts. Neither is derived by scanning the other.

Closing a Session freezes new input acceptance as specified by Durable Agent
Sessions. Its retained statistics remain readable. A closed Session does not
become mutable through adaptive hooks.

### Work and subagents

Spawned Tools, tasks, and subagents share the same Work ledger:

- their own handle exposes `stats()`;
- their mechanical totals roll up to their current Work, run, and root;
- parent preparation sees terminal outcomes after `await work.result()`; and
- the parent model sees only the summarized Work/subagent lifecycle and result
  behavior specified by the Work and supervision designs.

Preparation does not expose child token streams or semantic context to the
parent. Applications may still visualize child progress through the existing
Work/child stream APIs and Devtools.

### Detachment

Detachment changes ownership and result delivery, not history:

- the origin root retains usage and work started before detachment;
- the origin's historical `detached` count remains;
- future activity follows the new independent owner/root; and
- the detached result no longer resumes or injects into the origin.

Crux must not erase already incurred usage by moving a handle.

### Flow

Flow remains ordinary application-controlled orchestration. `flow.stats()` is
a convenience read over the same ledger, not a second controller runtime.

An immediate Flow maintains in-memory statistics. Adding Runtime and Storage
makes its accepted steps, suspensions, and statistics restart-safe without
changing the Flow definition.

## Adapter contract

Core owns preparation semantics. Each managed adapter must:

1. expose normalized operation capabilities and portable amendment fields;
2. resolve compatible model changes before provider I/O;
3. lower the sealed RequestPlan to its SDK;
4. report usage and cache details with explicit coverage;
5. distinguish semantic attempts from exact transport retries;
6. normalize failures without leaking provider content;
7. journal provider-call lifecycle into the shared ledger; and
8. preserve Core's retry and stream-commit boundaries.

Adapters with native loops, such as AI SDK integrations, must surface each
semantic provider-call opportunity to Core. Adapters for OpenAI, Anthropic,
and Google loops owned by Crux use the same contract. An SDK limitation may
produce a preflight capability error; it must not silently skip preparation or
statistics.

Adding a steering input may affect a running language turn only at the next
semantic step, never in the middle of a provider call. Media stream events
likewise do not create injection points.

Function-only Pipeline stages contribute timing, success/failure, and any
child Work they start. They have no provider plan and therefore do not receive
`prepareStep()`.

## Failure semantics

Preparation is part of boundary planning. Any of these prevents dispatch:

- callback throw;
- callback deadline or cancellation;
- typed resource read failure not handled by user code;
- undeclared or unauthorized resource;
- invalid or incompatible amendment;
- inert contributor;
- unsupported required operation facet;
- protected capability removal; or
- inability to commit the decision journal.

The caller receives a typed `PreparationError` with a safe cause category and
the normal causal chain. Sensitive callback or provider content follows
existing redaction rules.

In a composition, failure is scoped to the child boundary. The composition may
fallback or retry according to its explicit policy. In a Session, the current
activation fails or parks according to the Session failure contract; Crux does
not silently choose a model or discard an amendment. A journal failure is a
boundary failure, not permission to dispatch unrecorded durable work.

Preparation executes under the earliest of:

- the caller's abort;
- the remaining managed-operation `timeout.totalMs`;
- `timeout.stepMs` for `prepareStep()`;
- the active host deadline; and
- a Core V1 safety ceiling of 30 seconds.

`prepareInvocation()` has no provider step yet, so `stepMs` does not apply.
The 30-second ceiling is automatic and is not another config setting. A
callback that needs long-running computation should start/join Work before the
boundary and read its small committed state here.

Devtools diagnose callbacks that approach or exceed the effective limit. Crux
does not interrupt arbitrary user code mid-instruction, but it ignores a late
result after cancellation and prevents dispatch.

## Observability and Devtools

Every preparation boundary renders one decision:

```text
prepareStep · image · attempt 2
stats through cursor 01J...
resources control-state@17, brand-board@42
requested model fallback-image, size 1024x1024
resolved model fallback-image, size 1024x1024
contributors +brand-image-policy
plan 01J...
```

Devtools should answer:

- which hook ran;
- which operation and semantic attempt it prepared;
- which safe statistics were visible and their coverage;
- which resource identities and revisions were read;
- what amendment was requested;
- what validation, compatibility, and applicability changed;
- which representation/capability facets engaged or were omitted;
- which sealed RequestPlan was dispatched; and
- whether replay reused or reevaluated the decision.

Devtools must not claim to know the callback's semantic reason. It presents the
exact safe inputs and diff. Resource values remain behind their own authorized,
redacted inspection surface and are not copied into preparation traces.

Owner views display scope explicitly so users can distinguish current run,
Flow, Session, Work, and root totals. Missing token/cost coverage is prominent,
not rendered as `$0` or `0 tokens`.

## Eval and deterministic simulation

Evals run production preparation callbacks against a virtual execution world.
A Case may seed:

- attempts and provider usage with explicit coverage;
- timing;
- Tool, Work, approval, and lifecycle outcomes;
- normalized failures;
- operation route and media commitment state;
- control-readable resource values/revisions;
- resource read failures; and
- compatibility/capability outcomes.

The callback is not replaced by an Eval-only policy. Its result passes through
the same amendment validation and RequestPlan planning as production.

Eval and evidence fingerprints include every adaptive input that can affect the
request:

- callback source identity;
- statistics snapshot/cursor identity;
- coverage;
- resource identity, revision, and value hash;
- requested and resolved amendment;
- selected contributor facets and omissions;
- normalized model/adapter capability; and
- sealed RequestPlan.

Changing any one of those must miss incompatible cached task evidence. The
implementation must bump `TASK_EVIDENCE_CACHE_EPOCH` when adopting the new
adaptive evidence semantics and add focused stale-miss tests.

Live Eval mode may read a real owner snapshot only when explicitly requested.
Deterministic virtual input is the default.

## Diagnostics

Development diagnostics include:

- a durable owner depending on process-local statistics or state;
- a cost/token decision with incomplete coverage;
- an inert contributor for the chosen operation;
- an unsupported required representation;
- a legal optional omission;
- an undeclared, unauthorized, unresolved, or unavailable resource;
- an invalid or incompatible amendment;
- protected capability removal;
- a slow or timed-out preparation callback;
- an adapter that cannot honor a managed preparation boundary;
- Memory used with media when the user appears to expect prompt injection or
  output capture; and
- an inability to commit the decision before dispatch.

Diagnostics state the actual guarantee and the smallest remediation. When code
works process-locally in development but would lose durability after restart,
Crux warns during development rather than allowing the first surprise in
production.

## Security and tenancy

- Statistics are content-free and deeply readonly.
- Resource reads inherit the current tenant and authorization scope.
- A handle from another tenant is unauthorized even if its ID is known.
- Resource values do not enter generic traces, metrics labels, or decision
  records.
- Safe value hashes are keyed or otherwise scoped so they cannot become
  cross-tenant correlation identifiers.
- Preparation cannot weaken protected Safety, guardrails, constraints,
  approvals, output contracts, or hard limits.
- Credentials, headers, provider-native extras, and raw request replacement
  remain outside amendment authority.
- Media payloads, chunks, URLs, references, and prompt material do not enter
  statistics.
- Devtools enforce the same access and redaction rules as the owning resource
  and execution.

## Internal architecture

The design extends existing Runtime machinery with six internal roles:

1. **Statistics ledger** — consumes safe lifecycle facts and incrementally
   maintains bounded owner aggregates.
2. **Preparation coordinator** — snapshots facts/resources, runs the hook,
   validates its amendment, seals the plan, and commits before dispatch.
3. **Control resource reader** — mediates authorized, revision-pinned,
   boundary-local reads.
4. **Applicability compiler** — resolves operation facets and rejects inert or
   unsupported contributor graphs.
5. **Adapter preparation port** — exposes normalized capabilities, semantic
   attempts, usage, and retry/stream commitment.
6. **Statistics read model** — serves owner `stats()` methods, Devtools, and
   Evals from the same aggregate contract.

These are implementation boundaries, not six user-facing primitives.

No new database, event store, queue, runtime option, host option, contributor
registration, or configuration block is introduced. Immediate execution uses
in-memory implementations. Existing Runtime and Storage adapters provide
durability and records through their normal contracts.

The activity stream remains the causal source of accepted facts. Statistics
are a bounded materialized read model, not a replacement event system.

## Relationship to companion designs

This design makes additive amendments:

- Whole-Request Context Management gains `stats`, `resources`, universal
  operation applicability, and non-language `prepareStep()`.
- Joinable Background Work and Native Subagent Supervision gain owner
  `stats()` reads and mechanical roll-up.
- Durable Agent Sessions gain Session-lifetime statistics and the same
  preparation context on activations.
- Bounded media streaming gains `stats()` and adaptive preparation at semantic
  provider-call plans.

All existing ownership, retry, replay, delivery, stream publication, Safety,
and close semantics remain authoritative except where this document explicitly
extends their operation scope.

## Testing strategy

### Types and API

- Operation narrowing accepts only legal amendments.
- `use[]` rejects statically inert contributor/operation combinations where
  TypeScript can prove them.
- `when()` and `match()` preserve applicability types.
- `resources.read()` infers `T | null` for `workingState<T>` and
  `Partial<T> | null` for Blackboard.
- Thread, raw Storage, and ordinary context contributors are not
  `ControlReadable`.
- All owner handles expose the same async `stats()` noun.
- Transcription and embedding reject every operation-specific field in V1.
- `prepareInvocation()` is typed only for concrete managed leaf targets.

### Statistics

- Aggregates are idempotent under activity redelivery.
- Parent, Work, Flow, Session, and root roll-ups remain causally correct under
  concurrency.
- Reads return promptly with pending Work instead of waiting.
- `await work.result()` establishes terminal visibility.
- Token and cost coverage never synthesize zero.
- Per-identity maps keep the first 64 cursor-ordered identities, aggregate the
  rest under typed `other*` fields, and expose truncated attribution.
- Work current-state gauges and cumulative transitions remain correct under
  repeated suspend/resume and terminal races.
- Model call attribution separates semantic plan dispatch from exact transport
  retries.
- Owner-handle `run` identity remains the addressed owner while descendants
  start and settle.
- Terminal summaries obey bounded retention independently of result payloads.
- Expired owner summaries throw `StatsUnavailableError` and never reconstruct
  from a partial log.
- No content-bearing field reaches aggregates or metrics labels.

### Preparation and resources

- Hooks see declared resources regardless of active/rendered representation.
- Undeclared and cross-tenant handles fail with the exact typed reason.
- Reads pin revision per boundary and reuse it during later rendering.
- Invocation-added resources become readable to the child step, not to the
  callback that adds them.
- Callback cancellation, timeout, throw, invalid amendment, and journal failure
  all prevent dispatch.
- The 30-second preparation ceiling composes with shorter caller, operation,
  step, and host deadlines.
- Missing usage-field access warns only when followed by a non-empty amendment.
- Explicit caught resource failure and fallback amendment are both journaled.
- Exact transport retry and crash recovery reuse the sealed decision.
- A new semantic fallback attempt reevaluates with fresh `AttemptStats`.
- A deploy cannot alter already accepted work.

### Adapters and operations

Parity fixtures cover AI SDK, OpenAI, Anthropic, and Google managed loops:

- language generate/stream;
- multimodal language;
- structured output;
- image generate/stream;
- speech generate/stream;
- transcription; and
- embedding.

Fixtures prove operation field validation, model compatibility, embedding-space
compatibility, inactive/applicable contributor facets, and missing usage
coverage.

For PR #292 semantics, tests prove:

- pre-publication fallback starts a new prepared plan;
- exact transport retry does not rerun preparation;
- first public event seals the route;
- post-commit failure terminates rather than mixes providers;
- early reader return does not stop accounting; and
- media bytes and URLs never enter statistics.

### Flow, Session, Work, and Eval

- Immediate Flow works with no infrastructure configuration.
- Durable Flow/Session recovery reconstructs the same accepted decisions and
  statistics.
- Session activations distinguish run from Session/root lifetime.
- Work detachment preserves historical origin usage and changes future
  ownership.
- Function-only Pipeline stages have statistics but no provider hook.
- Nested compositions skip the wrapper invocation hook and prepare their own
  concrete managed leaves.
- Eval virtual fixtures reproduce amendments deterministically.
- Changing stats, coverage, state revision/value, callback source, or
  applicability misses stale evidence.

### Property and fault testing

Randomized tests should interleave provider events, Work completion,
detachment, steering, suspension, cancellation, retry, and crash. Invariants:

- aggregates never double-count;
- accepted facts never disappear from their historical owner;
- snapshots never include facts after their cursor;
- dispatch never precedes decision commit;
- sealed attempts never reevaluate;
- protected capabilities never weaken;
- content never enters statistics; and
- adaptation is never represented as an atomic reservation.

## Acceptance criteria

This design is complete when:

1. Documentation presents Flow as Crux's programmatic controller and does not
   introduce `controller()` or stateful `policy()`.
2. `prepareInvocation()` and every managed operation's `prepareStep()` receive
   frozen `stats`, read-only `resources`, `signal`, and operation identity.
3. Statistics expose attempt, current run, root, and nearest named owner scopes
   with explicit usage and bounded-attribution coverage.
4. Flow, Session, Work, and bounded media stream handles expose `stats()`.
5. Statistics work immediately without config and become durable through the
   existing Runtime/Storage composition.
6. Only declared `workingState()` and Blackboard are control-readable in V1,
   with revision-pinned `T | null` semantics.
7. Every managed operation accepts ordinary `use[]`; inert and unsupported
   contributor graphs fail before provider I/O.
8. Amendments are operation-narrowed, portable, and unable to weaken protected
   contracts or alter canonical input/ownership; non-leaf composition
   boundaries never guess an operation.
9. Every decision and sealed RequestPlan commits before dispatch and replays
   deterministically.
10. Streaming media preserves PR #292 route commitment and never prepares per
    event or exposes payload content through statistics.
11. Devtools and Evals use the same safe owner read model and show coverage,
    resource revisions, amendment diffs, and replay identity.
12. Concurrent preparation is documented and tested as adaptive rather than
    atomic hard-budget enforcement.
13. Adapter parity, fault injection, evidence-cache identity, durability
    diagnostics, and privacy tests cover all operation families.

## Final product statement

Crux has one simple control story:

```text
Use flow() when your application decides what runs.
Use a supervisor Agent when the model decides among authorized children.
Use prepareInvocation()/prepareStep() when the next boundary should adapt.
```

The basic APIs remain ordinary TypeScript and `use[]`. Advanced control adds
read-only facts and state at the point where they matter, without asking users
to adopt another runtime, store, event system, or framework.
