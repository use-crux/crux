# Joinable Background Work Design

Status: **proposed**

Related designs:

- [Standalone Signals](./2026-07-23-standalone-signals-design.md)
- [Effects, receipts, recovery, and rollback](./2026-07-10-effects-receipts-recovery-design.md)
- existing Runtime Engine, request-scoped `defer()`, and Flow durable-work APIs

## Summary

Crux should support result-bearing work that starts now, lets its owner
continue, and returns later to the place that spawned it.

```ts
const result = await research(input) // foreground

const work = await spawn(research, input) // background
// The owner continues.

await work.status()
const result = await work.result()
```

This is **joinable background work**, not fire-and-forget work. Crux already
has:

- `defer(callback)` for process-local work retained at an execution boundary;
- `defer(durableTask, input)` for named durable work without a result;
- `flow.defer()` for replay-safe durable child work; and
- `flow.after()` for durable delayed child work.

`spawn()` adds a typed result, an owner-scoped completion inbox, and a handle
that can inspect, await, cancel, or detach the work.

The same target may run in the foreground or background. Programmatic code
uses `spawn(target, input)`. Agents receive an explicit `backgroundable(target)`
binding that lets the model choose. A tool may also directly return a
`WorkHandle`; Crux projects that handle into the owning Agent loop.

Completion never interrupts an in-flight model request. An active owner sees it
at the next safe boundary. A future durable Agent may park and resume from the
same owner-inbox contract. A session-less Agent that already ended cannot be
resumed, even when the child work itself was durable; Crux reports that lost
rejoin guarantee honestly.

## Product principles

1. **Fire, continue, and come back.** Background work is useful because the
   owner remains productive while a result is pending.
2. **Background is a call-site choice.** Targets are not duplicated into
   foreground and background definitions.
3. **Joinability is a target contract.** Durable results require stable target
   identity plus serializable input and output.
4. **The inbox is authoritative; prompt context is a view.** Work does not
   become prompt state merely because an Agent owns it.
5. **Work durability and owner resumability are separate guarantees.** A
   durable child cannot magically resume a non-durable owner that no longer
   exists.
6. **Safe boundaries, never surprise interruption.** Completion queues while a
   model or tool step is in flight.
7. **Results enter context on demand.** Completion announces availability;
   `result` carries the potentially large output into the loop.
8. **Cancellation is not rollback.** Stopping future work and compensating
   completed effects remain separate, explicitly composed intents.
9. **Zero-config safety.** `backgroundable()` supplies the inbox, controls,
   status projection, and bounded admission defaults automatically.
10. **Portable runtime semantics.** Crux owns contracts and adapters; users own
    and can replace infrastructure.

## Goals

V1 should support:

- process-local spawning of inline closures;
- local or durable spawning of named Tools, Agents, and Runtime tasks;
- typed, schema-validated results;
- status inspection and optional progress;
- programmatic result waiting;
- cancellation and detachment;
- owner-scoped completion delivery;
- replay-safe Flow spawning and result waiting;
- an Agent projection with model-selectable background execution;
- direct top-level `WorkHandle` returns from tools;
- bounded concurrency and outstanding-work admission;
- optional pending-work finish feedback;
- Effect-scope integration and explicit cancellation rollback policy;
- Project Index, observability, Devtools, and Eval support; and
- a durable owner-inbox seam for the later Agent/Session design.

## Explicitly deferred

The following remain important but belong to later designs:

- sending steering or follow-up messages into running work;
- waking, queueing, or interrupting an arbitrary existing Session from an
  external Signal;
- the concrete public durable Agent/Session primitive;
- cross-owner handle transfer or reattachment;
- supervisor policy, delegation strategy, and rich subagent topology;
- streaming partial results into an owner;
- public completion Signals and arbitrary completion fan-out;
- hard-kill cancellation;
- exactly-once execution;
- priority, preemption, and global fairness; and
- a general typed progress-event stream.

Steering is deferred to the durable Session/interruption design, not rejected.
This design keeps stable work identity, ownership, and inbox seams so steering
can address the same work later.

## Terminology

### Work target

An executable closure or named definition accepted by `spawn()`.

### Joinable target

A target whose result type is known and whose durable form has a stable
serializable output contract.

### Work item

One accepted occurrence of a target execution. It has a stable work ID across
Runtime retries.

### Work handle

The application-facing object used to inspect and control one work item.

### Work reference

The JSON-safe, non-executable projection of a handle used in model context,
durable owner state, evidence, and APIs.

### Owner

The logical Agent run, durable Session, Flow, invocation, or application scope
to which completion should return.

### Owner inbox

The private completion channel between child work and its owner.

### Rejoin

Making a terminal child result or outcome available to its still-live or
resumable owner.

### Detachment

Permanently severing a work item's owner-inbox relationship while allowing the
work to continue.

### Safe boundary

A point between model/tool steps, or a durable owner suspension/resumption
transition, where new work status can be projected without changing an
in-flight provider request.

## Public target contract

### Named Runtime task

`durableTask()` gains optional schema contracts while preserving existing
fire-and-forget definitions:

```ts
export const research = durableTask('research', {
  input: ResearchInput,
  output: ResearchResult,
  async run(input, work) {
    await work.progress({ message: 'Searching sources' })
    return {
      summary,
      sources,
    }
  },
})
```

The conceptual types are:

```ts
interface JoinableTaskOptions<
  TInputSchema extends StandardSchemaV1,
  TOutputSchema extends StandardSchemaV1<unknown, JsonValue>,
> {
  readonly input: TInputSchema
  readonly output: TOutputSchema
  run(
    input: StandardSchemaV1.InferOutput<TInputSchema>,
    context: WorkExecutionContext,
  ): Awaitable<StandardSchemaV1.InferInput<TOutputSchema>>
}
```

The exact schema abstraction should follow Crux's public schema direction. The
requirements are runtime validation, input/output inference, and normalized
`JsonValue` output.

Existing `durableTask(name, { run })` definitions remain valid for
`defer()`/`flow.defer()`. Without an output contract they are not durably
joinable and cannot be passed to durable `spawn()`.

### Tool and Agent targets

A Tool may add an optional output schema to its existing authored contract:

```ts
export const research = tool({
  name: 'research',
  description: 'Research a question',
  input: ResearchInput,
  output: ResearchResult,
  async execute(input) {
    return runResearch(input)
  },
})
```

`tool({ output })` validates and normalizes the resolved execution value before
it is committed as a durable result. Its TypeScript output is inferred from the
schema, and `execute` must return a value accepted by that schema. Existing
Tools without `output` remain fully compatible and keep inferring their
foreground result from `execute`.

A Tool is durably joinable when it has:

- stable definition identity;
- serializable input;
- a serializable output contract; and
- an executable tool target in the activated Runtime manifest.

For V1, durable Tool identity requires an authored `name`; the key in an
Agent's `tools` map is the model-facing call name and is not durable identity.
The Project Index fingerprints the exported definition, authored name,
input/output schemas, execution body, and required adapter capabilities.

An existing Tool without `output`, or without a stable `name`, may still be
spawned process-locally when the capability matrix permits. Its TypeScript
result remains typed, but Crux cannot persist and validate it as a named
durable result. If a Runtime or durable owner requires durable execution, spawn
rejects before acceptance and identifies the missing `name` or `output`
contract. `backgroundable()` follows the same rule: it can expose such a Tool
for local background execution, but a model request for a durability that
cannot be provided fails honestly rather than silently serializing an
uncontracted result.

An Agent uses its prompt input/output contracts. A text-mode Agent has an
implicit string output. Agent execution also requires an activated
adapter-provided `AgentExecutor`.

The Project Index and Runtime activation manifest resolve named targets to
importable source definitions, exact definition versions, and executor
capabilities. A definition mismatch or missing executor fails activation or
spawn rather than producing permanently unexecutable accepted work.

### Inline closure

Inline closures are process-local:

```ts
const work = await spawn(() => runSubprocess(args))
```

TypeScript infers the result. No closure is serialized, imported later, or
described as durable.

An inline closure is rejected before acceptance when the owner requires durable
rejoin. The error identifies the closure source when available and shows how to
move the operation into an exported named target.

## `spawn()`

The common overloads are:

```ts
function spawn<T>(run: () => Awaitable<T>, options?: SpawnOptions): Promise<WorkHandle<T>>

function spawn<TTarget extends JoinableTarget>(
  target: TTarget,
  input: SpawnTargetInput<TTarget>,
  options?: SpawnOptions,
): Promise<WorkHandle<SpawnTargetOutput<TTarget>>>
```

`await spawn()` resolves after work acceptance, not execution. Durable
acceptance persists the work identity, input, target version, owner binding,
and wake obligation before returning.

`spawn()` starts eligible work promptly after acceptance. This differs from
`defer()`, which intentionally starts at the owning boundary.

### Spawn options

```ts
interface SpawnOptions {
  readonly idempotencyKey?: string
  readonly effects?: {
    readonly onCancel?: 'preserve' | 'rollback'
    readonly recovery?: 'required' | 'best-effort'
  }
}
```

`idempotencyKey` is scoped to owner, target, and active definition version. A
repeated compatible spawn returns the existing handle. A conflicting
normalized input rejects.

Effect policy defaults to:

```ts
{
  onCancel: 'preserve'
}
```

`recovery` is meaningful only with `onCancel: 'rollback'` and defaults to
`'best-effort'`.

Admission policy is normally inherited from the automatically activated owner
work capability. It does not need to be repeated at each call.

## `WorkHandle`

The conceptual contract is:

```ts
interface WorkHandle<T> {
  readonly _tag: 'WorkHandle'
  readonly id: string
  readonly targetId: string
  readonly guarantees: WorkGuarantees
  readonly effects: EffectScopeRef

  status(): Promise<WorkStatus>
  result(options?: WorkResultOptions): Promise<T>
  cancel(options?: WorkCancelOptions): Promise<WorkCancelReceipt>
  detach(): Promise<void>
  toRef(): WorkRef
}

interface WorkGuarantees {
  readonly execution: 'durable' | 'process-local'
  readonly rejoin: 'durable' | 'process-local' | 'none'
}

interface WorkRef {
  readonly kind: 'work.ref'
  readonly id: string
  readonly targetId: string
  readonly guarantees: WorkGuarantees
}
```

Methods are never serialized into model context or durable state. Those
surfaces receive `WorkRef`.

### Status

```ts
type WorkState = 'queued' | 'running' | 'completed' | 'failed' | 'cancel-requested' | 'cancelled'

interface WorkProgress {
  readonly message: string
  readonly current?: number
  readonly total?: number
  readonly updatedAt: string
}

interface WorkStatus {
  readonly work: WorkRef
  readonly state: WorkState
  readonly attachment: 'attached' | 'detached'
  readonly attempt: number
  readonly createdAt: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly progress?: WorkProgress
  readonly resultAvailable: boolean
  readonly resultExpiredAt?: string
  readonly effects?: {
    readonly recovery?: RollbackResult['status']
  }
}
```

`status()` reads the authoritative local or durable record. Progress is a
bounded latest snapshot; callers use observability for the full timeline.

### Result

```ts
interface WorkResultOptions {
  readonly signal?: AbortSignal
}
```

`result()` has true waiting semantics:

- pending work waits without creating another execution;
- completed work returns the schema-normalized typed result;
- failed work throws `WorkFailedError`;
- cancelled work throws `WorkCancelledError`; and
- repeated calls read the same write-once result or terminal outcome.

Aborting one `result()` caller stops that wait. It does not cancel the child.

Operational storage retains a completed payload at least until the attached
owner's delivery/consumption obligation is resolved, then for the configured
result-retention period. Detached work applies retention from completion
because it has no owner delivery obligation. After expiry, the summary remains
`completed` with `resultAvailable: false` and `resultExpiredAt`; `result()`
throws `WorkResultExpiredError` with retention metadata and never re-executes
the target.

Inside a replayable Flow or future durable Agent owner, `result()` registers a
durable completion waiter and suspends the owner rather than occupying a
worker. Replay at the same wait occurrence returns the committed outcome.

### Cancellation

`cancel()` durably requests cooperative cancellation. It does not promise an
immediate hard kill.

```ts
interface WorkCancelReceipt {
  readonly workId: string
  readonly accepted: boolean
  readonly state: WorkState
  readonly acceptedAt: string
}
```

The target receives an abort/cancellation signal through
`WorkExecutionContext`. Work remains attached and visible until it reaches a
terminal outcome.

Cancellation state transitions are:

1. a queued item with no active attempt atomically becomes `cancelled`;
2. a running item becomes `cancel-requested`, receives its owned abort signal,
   admits no new attempts, and stops admitting new Effects;
3. propagation of the owned signal's canonical cancellation error, including
   `signal.throwIfAborted()` and an abort from a Crux-owned adapter operation,
   acknowledges `cancelled`;
4. a released or expired attempt lease with no committed result also
   acknowledges `cancelled` once the Runtime has established that no active
   attempt remains and no retry will be admitted;
5. an ordinary target return still commits `completed` if it wins the terminal
   transaction; and
6. an unrelated error commits `failed`, without retry, if it wins after
   cancellation was requested.

An attempt that ignores its signal stays `cancel-requested` while its lease is
active. `cancel()` returns the receipt for the accepted request; it does not
wait for acknowledgement. V1 has no hidden timeout that claims to hard-kill
uncooperative code.

The Runtime classifies cancellation only when the thrown abort is causally
linked to the Work item's owned signal. An arbitrary user-thrown error named
`AbortError` is not sufficient.

If completion wins the terminal transition, the work remains `completed`.
Cancellation never rewrites a completed or failed outcome.

### Detachment

`detach()` changes only ownership:

- the child continues;
- the old owner inbox no longer receives progress or completion;
- the old owner is never resumed for this work;
- pending-work finish checks no longer count it; and
- an application that still holds the handle may continue to inspect it.

V1 does not support reattachment or ownership transfer.

For process-local work, detachment remains best-effort and subject to host
lifetime. For durable work, execution may outlive the former owner.

## Work execution context and progress

```ts
interface WorkExecutionContext {
  readonly id: string
  readonly attempt: number
  readonly signal: AbortSignal
  readonly effects: EffectScopeRef

  progress(update: { readonly message: string; readonly current?: number; readonly total?: number }): Promise<void>
}
```

Progress rules:

- `message` is bounded and treated as untrusted target output;
- `current` and `total`, when both present, must be non-negative and
  `current <= total`;
- the latest accepted snapshot feeds status and Agent projection;
- every accepted update may produce observed timeline evidence;
- progress does not wake or resume an owner; and
- terminal completion supersedes progress.

Agent targets generate equivalent progress automatically from model steps,
tool activity, elapsed time, and safe adapter-provided metadata. V1 does not
introduce a typed arbitrary progress stream.

## Execution and result semantics

Durable execution is at least once. Target code must be idempotent or use
idempotent Effect/tool contracts.

One logical work ID has:

- one normalized input;
- one pinned target definition/version;
- multiple possible execution attempts;
- one write-once terminal output or terminal failure/cancellation; and
- one owner binding until detached.

The Runtime validates the output before committing `completed`. An invalid or
non-JSON normalized output fails the attempt. Retry follows target/runtime
policy. Exhaustion commits a terminal failure.

Individual attempts never publish competing results. A retry that reaches the
result commit after another attempt loses the terminal race and cannot replace
the committed output.

## Owner inbox

### Private completion channel

Completion creates an owner-private inbox occurrence. It may share Runtime
event/waiter machinery with standalone Signals, but it is not a public Signal:

- it cannot fan out to unrelated consumers;
- it is scoped to one owner binding;
- detachment removes that binding;
- it is deduplicated by work ID; and
- it carries target/result availability rather than automatically exposing the
  result payload.

Users who want public domain notification should publish an explicit
standalone Signal from application code. V1 does not do so automatically.

### Safe-boundary delivery

If work completes during an in-flight model or tool step, the inbox records it
but does not change that provider request.

At the next safe boundary:

1. collect newly terminal attached work;
2. deduplicate by work ID;
3. order by terminal acceptance time, then work ID;
4. update the bounded status projection; and
5. make result retrieval available.

Several completions before one boundary are coalesced.

### Durable and non-durable owners

| Owner state              | Completion behavior                                            |
| ------------------------ | -------------------------------------------------------------- |
| Active non-durable Agent | Project at the next safe loop boundary                         |
| Ended non-durable Agent  | Rejoin is impossible; record orphaning and warn in development |
| Active durable owner     | Project at the next safe boundary                              |
| Parked durable owner     | Persist inbox entry and schedule one coalesced wake            |
| Detached work            | Do not notify or resume the former owner                       |

A parked durable owner gets at most one outstanding wake obligation for its
current inbox generation. When resumed, it sees every completion accumulated
before the boundary.

This RFC defines the durable owner-inbox capability, but not the public durable
Agent/Session API. That later design must bind its session identity, snapshots,
and wake/resume policy to this contract.

### Consumption

Completion availability and result consumption are separate:

- an inbox entry may be projected many times as a small status reminder;
- the result payload enters an Agent transcript only through a successful
  result request;
- consumption is acknowledged only after the canonical result was committed to
  the owner transcript/state; and
- retries before that commit reuse the same inbox entry and result.

V1 does not automatically inject the result and therefore cannot both
auto-inject and explicitly retrieve it.

## Agent integration

### `backgroundable()`

```ts
const assistant = agent({
  prompt: assistantPrompt,
  tools: {
    research: backgroundable(researchTool),
    delegateResearch: backgroundable(researchAgent),
  },
})
```

`backgroundable(target)` is an inert Tool wrapper accepted as a value in the
existing keyed `tools` map. It preserves the map key as the model-facing tool
name and preserves the target's inferred input and output types. It does not
make the target globally background-only and is not needed for programmatic
`spawn()`.

For a Tool target, the map key remains authoritative for model calls while the
Tool's authored `name` supplies durable target identity. For an Agent target,
the map key is the delegated model-tool name and the Agent's `id` supplies
durable identity. This avoids deriving public tool names, changing the existing
tool collection shape, or conflating provider names with Runtime identity.

The projected model tool adds a reserved execution field:

```ts
background?: boolean
```

Crux removes that field before the target's authored input validation and
execution:

- absent or `false`: execute normally and return the foreground result;
- `true`: call `spawn()` and return a `WorkRef`.

An authored input field named `background` conflicts with this model-facing
projection. Definition/Project Index diagnostics fail with guidance to rename
the business field. V1 does not silently shadow it.

For an Agent target, the binding creates a delegated tool from the Agent's ID,
description, prompt input, and output contract. Execution uses the activated
Agent executor and starts a fresh child Agent run.

### Automatic capability contribution

The Agent loop discovers the first tagged `backgroundable()` wrapper in the
resolved keyed tool map and automatically activates, once per Agent run:

- the owner inbox;
- one stable work control tool;
- the status-context projection;
- default admission policy; and
- lifecycle/evidence hooks.

Multiple bindings deduplicate this capability. Users never need to add a
companion `backgroundWork()` entry for normal behavior.

### Work control tool

The conceptual model-facing tool is:

```ts
work({
  action: 'list' | 'status' | 'result' | 'cancel' | 'detach',
  id?: string,
  timeout?: string,
})
```

It is owner-scoped. The model cannot inspect or control arbitrary work IDs
outside the current owner inbox.

- `list` returns bounded attached work summaries;
- `status` returns one safe status projection;
- `result` waits up to a bounded timeout and returns the typed result if it
  becomes available, otherwise current status;
- `cancel` applies the application-authorized cancellation and Effect policy;
  and
- `detach` removes the item from this owner.

The default model-facing result wait is bounded. The exact timeout follows the
shared tool timeout policy and may be shortened by a supplied `timeout`; it
cannot exceed the owning call's remaining deadline.

The work tool remains in the tool schema once activated for a run. It returns a
small no-work response when the inbox is empty. Status data appears and
disappears; the tool definition does not thrash on every completion.

An authored tool with the reserved work-control name is a blocking definition
diagnostic. The final implementation should use the normal Crux internal-tool
namespace and expose a concise model-facing name without silently replacing
application tools.

### Status context

At a safe boundary, the Agent receives a capped projection such as:

```text
Background work:
- work_12 · research · running 18s · Searching sources
- work_09 · tests · completed · Result available
```

It contains:

- work ID;
- target label;
- state and elapsed time;
- latest bounded progress message; and
- result availability.

It does not contain full results, raw failures, Effect recovery envelopes, or
unbounded history. Old completed entries age out after consumption/retention;
pending and newly terminal work take priority within the context cap.

### Direct returned-handle lifting

A Tool may intentionally launch work:

```ts
const startResearch = tool({
  input: ResearchInput,
  execute: (input) => spawn(research, input),
})
```

When the top-level resolved Tool output is a branded `WorkHandle`, the loop:

1. recognizes it before ordinary result serialization;
2. verifies that its owner is the current logical owner;
3. converts it to `WorkRef`;
4. closes the original provider tool call with that reference; and
5. activates the work projection at the next safe boundary.

Crux does not recursively scan arbitrary objects for handles.

If `backgroundable()` already activated work support, the control tool is
already present. Otherwise a loop adapter must support one-way tool amendment:
the work tool is added at the next boundary and retained for the rest of the
run.

`spawn()` called in a Tool scope can see whether its owner has work projection
support. If the adapter cannot amend tools and no work capability is already
active, it rejects before accepting the child with guidance to wrap an
appropriate target in `backgroundable()` so the work tool is installed at
run start.

### Provider tool-result correctness

The original backgrounded Tool call returns exactly once:

```text
research({ background: true }) -> {
  kind: "work.ref",
  id: "work_12",
  targetId: "research",
  guarantees: {
    execution: "durable",
    rejoin: "process-local"
  }
}
```

Completion never sends a second result for that provider tool-call ID. A later
model-authored work-result call gets a distinct provider tool-call ID and owns
the canonical typed result:

```text
work({ action: "result", id }) -> ResearchResult
```

This is the portable default for both Core-owned and SDK-owned loops.

## Optional finish policy

Pending work does not force a session-less Agent to continue. Users may opt
into a first-party policy contribution:

```ts
agent({
  prompt: prompt({
    // ...
    use: [workPolicy({ pendingOnFinish: 'remind-once' })],
  }),
})
```

The exported `workPolicy()` contribution also owns admission overrides. Its
`pendingOnFinish: 'remind-once'` behavior is:

`workPolicy()` is a normal entry in the owning prompt's existing `use` array.
It contributes loop policy metadata and, when requested, the finish
constraint. This design does not add a second top-level `AgentConfig.use`
surface.

1. no pending attached work: pass;
2. first final output with pending work: provide one corrective turn listing
   the work and the `result`, `cancel`, and `detach` choices;
3. work completed during correction: show normal completion availability;
4. a second final output with pending work: allow it; and
5. record `owner-ended-with-pending-work`, then apply ordinary non-durable
   orphan behavior.

This can be implemented through a first-party constraint contributed by the
work capability. It deliberately fails only the first applicable final-output
attempt, so existing assert-constraint exhaustion never turns the optional
reminder into a terminal `ConstraintViolationError`.

No finish policy is required merely to use `backgroundable()`.

## Admission and bounded fan-out

Every owner work capability has two automatic limits:

1. **active concurrency**: excess accepted work remains `queued`; and
2. **maximum outstanding**: once queued plus running attached work reaches the
   cap, another spawn rejects before acceptance.

The implementation should expose one provider-neutral default policy rather
than silently choosing unrelated values per platform. Initial V1 defaults are
provisionally:

```ts
{
  concurrency: 8,
  maxOutstanding: 32,
}
```

These values are safe defaults, not protocol constants. They should be
validated with Runtime/Agent benchmarks before public stabilization and then
documented as observable policy.

Overrides use a normal composable Agent contribution or owning execution
policy:

```ts
const assistantPrompt = prompt({
  // ...
  use: [
    workPolicy({
      concurrency: 4,
      maxOutstanding: 16,
      pendingOnFinish: 'remind-once',
    }),
  ],
})
```

Runtime worker capacity is separate. An owner may admit eight active items
while infrastructure runs fewer; the remaining items stay queued.

Rejected model spawns return a concise tool error that names current limits and
does not encourage immediate blind retry. Programmatic spawn rejects with a
typed admission error.

This RFC does not define recursive subagent depth or total lifetime spawn
budgets. The later subagent/supervisor design must add those policies. Runtime
adapters retain a global safety bound so nested owners cannot exhaust the host
while that richer policy is absent.

## Flow integration

Replayable Flows use an explicit method:

```ts
const work = await flow.spawn(research, input)

// Continue with other replay-safe work.

const result = await work.result()
```

Public ambient `spawn()` is rejected directly inside a replayable Flow body or
step, matching the existing `defer()` replay-safety boundary.

`flow.spawn()`:

1. derives positional replay identity;
2. validates target/input and admission;
3. atomically commits the child work, owner binding, replay occurrence, and
   wake obligation;
4. returns the accepted handle; and
5. on replay returns the recorded handle rather than spawning again.

Unlike `flow.defer()`, it commits its own immediate spawn barrier so work can
start while the Flow continues. `flow.defer()` remains the cheaper buffered
choice when no result/rejoin is needed.

`work.result()` inside the Flow creates a replay-visible durable waiter.
Completion and cancellation race atomically with waiter state. The winning
terminal outcome resumes the Flow once.

Flow cancellation and child cancellation remain separate. Cancelling a Flow
follows its existing child-work policy; this design does not silently change
all existing `flow.defer()` children into joinable owned work.

## Cancellation and Effect integration

Every spawned work item owns an Effect rollback boundary. Nested target calls,
Tools, Agent steps, and native Crux mutations contribute to that boundary under
the Effects RFC.

### Preserve by default

`cancel()` means stop, not undo. Completed effects remain reviewable and
recoverable but are not automatically rolled back.

This matches the Effects RFC's existing rule that cancelled or expired Flows do
not automatically roll back.

### Explicit rollback policy

With:

```ts
effects: {
  onCancel: 'rollback',
  recovery: 'best-effort',
}
```

the cancellation lifecycle is:

1. accept the cancellation request;
2. signal the running target;
3. prevent admission of new effects in the boundary;
4. let in-flight effects reach a known success/failure/unknown outcome;
5. construct the child-boundary rollback plan;
6. recover according to the Effects RFC; and
7. record cancellation and recovery as separate outcomes.

Recovery starts only after the Runtime has established that no active attempt
can add another Effect. An accepted cancellation that ends as `cancelled` or
as an unrelated terminal `failed` outcome still applies its authorized
rollback policy. If an ordinary result wins and commits `completed`, the cancel
request loses and automatic cancellation rollback does not begin.

`recovery: 'required'` makes the policy an honest guarantee: an effect without
available recovery is blocked before execution. `best-effort` allows
irreversible/unavailable effects and may yield partial recovery.

Ambiguous effect outcomes are not automatically retried or compensated.
Cancellation rollback never includes the owner or sibling boundaries.

If work reaches `completed` before the cancellation terminal transition, the
cancel request loses. Undoing completed work requires explicit
`rollback(work.effects)`.

The model-facing cancel action cannot choose or elevate recovery policy. It
uses the policy authorized by application code. Force-conflict recovery and
other elevated Effect operations remain outside the ordinary work tool.

## Runtime activation and persistence

### Activation manifest

Project discovery and generation produce an activation entry for each named
joinable target:

- target ID, kind, and source;
- exact definition/version fingerprint;
- input/output schema identity;
- importable module/export reference;
- required executor/adapter capabilities;
- Effect recovery target requirements; and
- supported host/runtime capabilities.

Activation imports trusted application code according to existing Runtime
generation rules. It does not perform implicit npm package discovery or global
side-effect registration.

### Durable records

The Runtime persists:

- work identity, target version, normalized input, and owner;
- execution and rejoin guarantees;
- state transitions and attempts;
- admission and idempotency identity;
- latest progress plus observed progress timeline;
- cancellation request and terminal race;
- write-once validated result or terminal failure;
- Effect scope and recovery outcome;
- inbox delivery/consumption state; and
- wake/outbox state.

Result payloads and sensitive failure/recovery data follow configured
retention, encryption, and evidence-redaction policy. Summary records do not
copy full result payloads unnecessarily.

### Capability ownership

Core remains provider/platform neutral. Concrete packages supply:

- persistence transactions;
- worker wake/lease execution;
- host invocation retention;
- named Tool and Agent executors;
- durable owner suspension/resumption; and
- platform lifecycle binding.

Core packages never import Next.js, Convex, Cloudflare, Vercel, or provider SDKs.

## Capability and degradation matrix

| Situation                                                               | Execution     | Rejoin        | Behavior                                                       |
| ----------------------------------------------------------------------- | ------------- | ------------- | -------------------------------------------------------------- |
| Inline closure, active local owner                                      | process-local | process-local | Start locally and return a local handle                        |
| Named target, safe local owner, no Runtime                              | process-local | process-local | Run locally; development warning describes lost crash recovery |
| Named target with Runtime, active local Agent                           | durable       | process-local | Work survives; result returns only while owner lives           |
| Named target with Runtime, ended local Agent                            | durable       | none          | Work may finish; record orphan and warn in development         |
| Named target with durable owner binding                                 | durable       | durable       | Persist inbox and resume owner                                 |
| Inline closure with durable owner                                       | unavailable   | unavailable   | Reject before work with exported-target remedy                 |
| Freezing host without retention, local work                             | unavailable   | unavailable   | Reject before false acceptance                                 |
| Direct returned handle without loop amendment or preinstalled work tool | unavailable   | unavailable   | Reject spawn before acceptance with `backgroundable()` remedy  |

A local fallback is permitted only when:

- the target is executable in the current process;
- the owner is live and does not require durable rejoin;
- the host can retain the accepted work for its claimed lifetime; and
- the handle/evidence reports process-local guarantees.

Crux never calls invocation retention crash durability and never calls durable
child execution durable rejoin unless the owner is resumable.

## Project Index

The Project Index should represent:

- joinable Runtime task definitions and schemas;
- Tool/Agent target eligibility;
- `spawn()` and `flow.spawn()` call sites;
- target and owner relations;
- `backgroundable()` bindings;
- direct-return WorkHandle sites when source analysis can prove them;
- work policy contributions;
- Effect cancellation policy; and
- source references for each relationship.

Diagnostics include:

- missing or non-serializable output contracts;
- duplicate target IDs or incompatible versions;
- inline closures in proven durable-owner scopes;
- ambient `spawn()` in replayable Flow code;
- unavailable target executors;
- reserved `background` input collisions;
- reserved work-control tool collisions;
- direct-return lifting on an adapter without a valid projection path;
- invalid policy limits; and
- named spawn promises/handles that are unintentionally discarded where
  evidence proves the mistake.

Any implementation that changes Project Index output for unchanged source must
update the required static, semantic, and Go snapshot cache identities under
the repository cache-identity rules. Semantic behavior must remain identical
across JavaScript and native backends.

## Observability and Devtools

### Causal evidence

The canonical graph is:

```text
owner
  -> spawn acceptance
  -> work item
  -> execution attempt(s)
  -> progress
  -> result | failure | cancellation
  -> optional Effect rollback
  -> owner inbox
  -> result retrieval | durable resume | orphan
```

Logical work identity is stable across attempts. Attempts, result commits,
inbox deliveries, and result consumption remain distinct evidence.

### Work view

Devtools should show:

- queued, active, completed, failed, cancel-requested, and cancelled work;
- attached, detached, and orphaned ownership;
- owner/child trees;
- target and source definitions;
- execution and rejoin guarantees;
- attempts, leases, timing, retries, and latest progress;
- result availability and consumption;
- cancellation/completion races;
- Effect receipts and recovery outcome; and
- links to Agent runs, Flow steps, Signals that started an owner, and resumed
  owner steps.

The view answers:

- What is still running?
- What is this Agent waiting for?
- Where did this work come from?
- Will its result return anywhere?
- Why was it queued, rejected, detached, or orphaned?
- Did cancellation also recover effects?

## Eval contract

Each Eval Case/Variant/trial receives an isolated virtual work namespace and
scheduler.

By default:

- `spawn()` validates and records intent but does not launch uncontrolled live
  background work;
- inline closures are not invoked;
- named targets are not dispatched to the production Runtime;
- work IDs, time, attempts, inbox delivery, and progress are deterministic; and
- existing Effect/Eval capture policy remains in force.

The virtual scheduler can script:

- queued/running transitions;
- progress snapshots;
- typed completion;
- failure and retry;
- cancellation acknowledgement or completion race;
- detachment;
- owner ending;
- durable wake/resumption; and
- result retrieval timing.

The captured `WorkHandle` uses the normal public methods against this virtual
state, allowing production code to run unchanged.

Eval assertions should cover:

- target and normalized input;
- foreground/background choice;
- execution/rejoin guarantee requested and simulated;
- admission, idempotency, and retry;
- status and progress;
- result value or terminal error;
- cancellation and detachment;
- inbox projection and exactly-once consumption into the transcript;
- owner wake/resumption/orphaning; and
- Effect rollback policy and outcome.

Live background execution is an explicit Eval option with isolated
infrastructure. It is never the default.

## Security and authorization

- Tool/Agent approval and input policy run before background acceptance, at the
  same authority boundary as foreground execution.
- A background choice cannot bypass a target's tool policy, sandbox, model,
  budget, or Effect authorization.
- The work control tool is restricted to the current owner inbox and validates
  work IDs server-side.
- Work references are identifiers, not bearer authority to control arbitrary
  work from another owner.
- Result and progress content are untrusted Tool/Agent output. They pass through
  the same safety, redaction, prompt-injection boundaries, and observability
  privacy policy as foreground results.
- Cancellation does not grant rollback, force-conflict, or elevated recovery
  authority.
- Detached work retains the permissions captured/derived for its target
  execution; detachment does not widen them.
- Sensitive inputs/results remain in operational storage and are represented in
  evidence by metadata or redacted previews unless explicitly configured.

## Compatibility

This design is additive:

- `defer(callback)` remains process-local, boundary-triggered, and resultless;
- `defer(durableTask, input)` remains durable fire-and-forget work;
- `flow.defer()` remains replay-safe buffered child work;
- `flow.after()` remains durable delayed work;
- existing `durableTask({ run })` definitions remain valid;
- adding schemas makes a target joinable but does not change ordinary defer
  behavior;
- existing Agent and prompt `use` behavior remains unchanged unless a
  background capability/policy is authored; and
- standalone Signals remain independent and are not required for completion.

The implementation should not rename existing `defer()` overloads to `spawn()`
or reinterpret their start timing.

## V1 implementation slices

Implementation should proceed through vertical behavior:

1. Process-local `spawn(closure)`, `WorkHandle`, status, result, cancellation,
   detachment, progress, and evidence.
2. Joinable named Runtime task schemas, durable result records, retries,
   idempotency, and Runtime conformance.
3. Owner inbox, safe-boundary completion, guarantees, orphaning, and automatic
   admission.
4. Replay-safe `flow.spawn()` and durable `result()` waiting.
5. Tool `backgroundable()`, stable work control tool, status projection, and
   provider protocol conformance.
6. Agent targets and direct top-level WorkHandle lifting.
7. Effect cancellation policy and rollback evidence.
8. Project Index, Devtools, Eval scheduler/assertions, and platform/runtime
   adapter completion.

The durable Agent/Session implementation is not a hidden prerequisite for the
local Agent projection or Flow work. Its later design consumes the owner-inbox
contract added here.

## Success criteria

The design succeeds when:

- programmatic code can start typed work and continue in two lines;
- the same target runs foreground or background;
- inline work works locally without setup and reports honest guarantees;
- named work survives restarts with a configured user-owned Runtime;
- a Flow can spawn once under replay and durably wait for the result;
- an Agent can choose background execution without a second target definition;
- a directly returned WorkHandle becomes useful Agent work state;
- completion never violates provider tool-result protocols;
- pending status is concise and results enter context only on demand;
- durable work never implies durable rejoin without a resumable owner;
- cancellation and detachment have distinct, explainable outcomes;
- rollback occurs only under explicit Effect policy;
- automatic limits prevent unbounded concurrent or queued work without required
  setup; and
- Evals can deterministically exercise the same application code without
  launching uncontrolled background work.
