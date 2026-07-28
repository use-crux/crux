# Native Subagent Supervision Design

Status: **approved for specification review**

Companion designs:

- [Joinable Background Work](./2026-07-23-joinable-background-work-design.md)
- [Canonical Thread](./2026-07-24-thread-design.md)
- [Message History Projection](./2026-07-25-message-history-projection-design.md)
- [Whole-Request Context Management](./2026-07-27-whole-request-context-management-design.md)
- [Durable Agent Sessions](./2026-07-28-durable-agent-session-design.md)

## Summary

Crux should make model-directed child Agents feel like ordinary Tools:

```ts
const writer = agent({
  id: 'writer',
  prompt: writerPrompt,
  tools: {
    search,
    research: researcher,
    deepResearch: backgroundable(researcher),
  },
})
```

An Agent value in `tools` is a native child binding. A direct binding runs
foreground and returns the child's exact validated output. `backgroundable()`
adds the already designed foreground/background choice without changing the
child contract.

Every child invocation is Agent-backed Work. Foreground delegation
conceptually spawns Work and immediately awaits `result()`; background
delegation returns a Work reference and lets the parent continue. Both paths
share identity, admission, ownership, durability, retries, cancellation,
steering, result validation, activity streaming, Session rejoin, Evals, and
observability.

The common path requires no subagent registry, binding wrapper, new Storage
setting, dedicated supervisor type, or mandatory Runtime. Durable guarantees
activate through Crux's existing Runtime, Storage, Host, Project Index, and
generated activation manifest. Process-local execution remains useful and
reports its weaker guarantees honestly.

## Goals

1. Make a reusable Agent directly callable by another Agent with minimal API
   ceremony.
2. Preserve typed input, structured or text output, and full multimodality.
3. Support both foreground child calls and joinable background child Work.
4. Let application code start, observe, steer, cancel, detach, and await child
   Work through one typed handle.
5. Let durable Sessions resume when attached background children complete.
6. Bound recursive model-driven fan-out automatically without requiring user
   configuration.
7. Keep child context isolated by default while permitting deliberate shared
   Thread, Memory, Blackboard, or knowledge resources.
8. Preserve one execution/activity foundation across direct child Agents,
   existing Agent compositions, and future controllers.
9. Keep parent-model visibility bounded while giving authorized application UIs
   a rich, resumable execution-tree stream.
10. Make replay, approvals, failures, deployment changes, and Evals
    deterministic and observable.

## Non-goals

This design does not add:

- a public `SupervisorAgent` type;
- arbitrary model-authored system prompts, Tool sets, Skills, or Agent
  definitions;
- autonomous sibling messaging or Agent teams;
- implicit parent-context inheritance;
- automatic promotion of finite Work into a Session;
- mandatory Agent binding wrappers or per-edge overrides;
- a new general execution token/time/cost budget;
- an Agent-specific storage configuration;
- hard-kill semantics;
- per-spawn model, Tool, context, or policy amendments for model-started
  children;
- a programmatic controller API;
- changes to `swarm()` handoff meaning; or
- live nested child execution by default in Evals.

Programmatic controllers remain a separate design. They will be able to reuse
the Work and activity foundations defined here.

## Terminology

### Child Agent

One Agent invoked by another Agent with a bounded typed assignment and output
contract.

### Supervisor

An ordinary Agent whose authorized Tools include child Agents. `supervisor` is
a role, not a second Agent type.

### Agent-backed Work

One finite child Agent execution represented by the shared Work lifecycle.

### Binding role

The key under which an Agent appears in a parent's `tools` map. It becomes the
model-facing Tool name and identifies why that parent may invoke the child.

### Steering

Ordered canonical guidance sent to queued or running Agent-backed Work. The
public ergonomic verb is `send()`.

### Activity root

The owner-scoped cursor timeline used for resumable execution activity. A
Session is an activity root; standalone Work receives an implicit root with
guarantees matching that Work.

## Public authoring API

### Agent values in `tools`

The existing keyed Tool namespace accepts Agent values:

```ts
const researcher = agent({
  id: 'researcher',
  description: 'Investigates questions using primary sources.',
  prompt: researchPrompt,
  tools: {
    search,
    read,
  },
})

const supervisor = agent({
  id: 'supervisor',
  prompt: supervisorPrompt,
  tools: {
    research: researcher,
    deepResearch: backgroundable(researcher),
  },
})
```

The namespace remains authoritative for:

- provider Tool names;
- collisions;
- Tool approval policy;
- middleware;
- `activeTools`;
- step-level activation;
- adapter lowering;
- Project Index relations; and
- Devtools presentation.

Crux does not add a parallel `subagents` field or hide model-callable children
inside `use[]`.

An ordinary Tool executes its handler. An Agent entry starts a typed nested
child. A backgroundable Agent entry lets the model choose the existing
foreground/background mode.

### Description resolution

When an Agent becomes a model-facing Tool, description resolution is:

1. `agent.description`;
2. `agent.prompt.description`; or
3. activation failure before a model request.

Crux never synthesizes a vague description from the Agent ID or map key.

Example diagnostic:

```text
Agent "researcher" is bound as tool "research" but has no description.
Add `description` to the Agent or its Prompt.
```

Descriptions remain optional for Agents that are never exposed as
model-callable actions.

### Tool-schema projection

Provider Tool parameter schemas must have an object root. Crux uses one
provider-neutral projection:

- a guaranteed object Agent input exposes its properties directly;
- a no-input Agent exposes `{}`;
- a non-object or mixed-root Agent input exposes
  `{ input: AgentInput }`.

```ts
// Authored Agent input
z.string()

// Provider Tool parameters
z.object({
  input: z.string(),
})
```

Crux unwraps the reserved `input` property before validating and invoking the
Agent. Programmatic `spawn(agent, value)` continues to accept the raw authored
Agent input type.

`input`, rather than `message`, accommodates strings, numbers, unions,
canonical multimodal content, and other non-object contracts. All adapters,
Project Index, Devtools, and Evals use the same projection.

### No binding wrapper in V1

V1 exports no `subagent()`, `bindAgent()`, `agentTool()`, or Agent method.

Materially different authority should be an explicit Agent capability profile:

```ts
const researcher = agent({
  id: 'researcher',
  description: 'Performs broad research.',
  prompt: researchPrompt,
  tools: { search, browse, runCode },
})

const readOnlyResearcher = agent({
  id: 'read-only-researcher',
  description: 'Investigates using read-only sources.',
  prompt: researchPrompt,
  tools: { search, browse },
})
```

Profiles may reuse the same Prompt. This makes authority visible and
manifest-resolvable rather than hiding it in a parent edge.

An optional strictly narrowing binding compositor remains a non-breaking
future addition. It should be designed together with unified Tool activation
and swarm narrowing after real usage demonstrates the need.

`delegate()` remains the escape hatch for foreign/custom executors and result
transforms. It is not the normal Crux-Agent-to-Agent path.

## Child execution contract

### Fresh finite execution

Every child call creates fresh finite Work:

```text
research call 1 -> work_1
research call 2 -> work_2
```

Repeated calls through one binding do not continue an earlier child. Each has
independent:

- Work identity;
- validated assignment;
- lifecycle;
- retries;
- result;
- cancellation;
- execution evidence; and
- request-local transcript.

A new logical Tool-call occurrence starts fresh Work even when its normalized
input equals an earlier call.

### Stable capability profile, dynamic assignment

The Agent definition is the trusted capability profile:

- Prompt and system instructions;
- model/routing defaults;
- Tools;
- Skills;
- constraints and guardrails;
- context policy;
- schemas;
- work policy; and
- durable definition identity.

Every invocation receives a new typed assignment.

A freeform task property is still an application-authorized instruction
channel. It constrains capabilities, not the semantic content a supervisor may
place in that field. Applications needing stricter assignment semantics should
use a narrower schema, constraints, guardrails, or separate Agent profile.

The supervising model may never invent a new system prompt, Tool set, Skill
set, model, budget, or guardrail configuration. Per-spawn authority may narrow
only through already authorized definitions and Runtime policy; V1 adds no
model-facing amendment surface.

Application code may construct and run an ephemeral request-specific Agent.
Restart-safe durable execution requires a stable, exported,
manifest-resolvable definition.

## Context boundary

Child context is fresh and isolated by default.

It contains:

- the child Agent's own Prompt;
- the child Agent's `use[]`;
- the child Agent's Tools and Skills;
- the child Agent's model/routing;
- the child Agent's constraints and guardrails;
- the validated assignment;
- inherited execution identity;
- inherited cancellation;
- effective Work/tree policy;
- Runtime/organization safety ceilings; and
- observability lineage.

It does not implicitly contain:

- the parent Thread or messages;
- parent temporary context;
- parent Tools or Skills;
- sibling transcripts;
- unresolved provider Tool history;
- an automatically generated parent summary; or
- hidden inherited context selected by a model.

Parent-to-child knowledge crosses through:

- the typed assignment;
- an explicitly shared Thread;
- Memory;
- Blackboard;
- knowledge/retrieval resources; or
- a future explicit controlled context projection.

Crux adds no `inherit: true`.

A child may intentionally possess specialized Tools the parent cannot invoke
directly. The application-authored Agent binding is the indirect authority
edge. Runtime and organization policy still clamp the child.

## Thread and Session boundary

A finite child does not implicitly allocate a durable Thread. Its ordinary
loop transcript is private execution state and observable evidence.

If the Agent explicitly declares a Thread, Memory, Blackboard, or knowledge
dependency, that resource keeps its normal sharing and durability semantics.
Two Work occurrences using one explicit Thread remain separate executions.

`send()` continues only queued or running child Work. Once Work is terminal:

- calling the Agent starts fresh Work;
- `send()` rejects;
- Crux does not revive the child; and
- Crux does not copy its private transcript into a Session.

Ongoing durable conversation must use a Session from the beginning:

```ts
const research = await session(researcher, {
  key: 'research:issue-42',
})

await research.send(initialInput)
```

A later Session may intentionally use the same explicitly durable Thread under
the normal Agent/Thread/Session compatibility rules. That is resource reuse,
not terminal-Work promotion.

## Foreground and background behavior

### Foreground

A direct Agent binding is foreground:

```ts
tools: {
  research: researcher,
}
```

Conceptually:

```ts
const child = await spawn(researcher, input)
return await child.result()
```

The handle is internal to the ordinary model Tool call. The parent receives the
child's model-facing result representation as a provider-valid Tool result.

Foreground child execution keeps the parent Tool step open. Until the child
returns:

- the parent model cannot continue;
- new parent Session ingress waits for the next safe boundary;
- parent Work completions and steering wait;
- the waiting parent model cannot steer the child; and
- required child approval resolution remains part of the foreground
  dependency.

Crux never switches a foreground child to background based on elapsed time.
Devtools and observability show the dependency. Bounded development advice may
recommend `backgroundable(agent)` for demonstrably long or multi-step
foreground work without changing behavior or relying on one noisy universal
timeout.

### Background

`backgroundable(agent)` uses the Joinable Background Work contract:

```ts
tools: {
  deepResearch: backgroundable(researcher),
}
```

When background execution is selected:

- Work is accepted and attached to the parent owner;
- the parent continues;
- bounded status enters later parent steps;
- terminal completion becomes owner inbox activity;
- the parent explicitly calls `result` through Work control;
- the full result is never injected automatically;
- a durable owner may be resumed; and
- an ended non-durable owner records orphaning and warns in development.

The same child output type and validation apply in foreground and background
modes.

## Work handle

### Common handle

This design extends the Joinable Background Work contract:

```ts
interface WorkHandle<
  Result,
  Event extends WorkEventEnvelope = WorkEvent<Result>,
> {
  readonly _tag: 'WorkHandle'
  readonly id: string
  readonly targetId: string
  readonly guarantees: WorkGuarantees
  readonly effects: EffectScopeRef

  status(): Promise<WorkStatus>
  stream(options?: WorkStreamOptions): AsyncIterable<Event>
  result(options?: WorkResultOptions): Promise<Result>
  cancel(options?: WorkCancelOptions): Promise<WorkCancelReceipt>
  detach(): Promise<void>
  toRef(): WorkRef
}
```

`stream()` is a common Work capability, not a subagent-only event system.
Tool/task Work exposes lifecycle and progress. Agent-backed Work additionally
exposes provider-neutral generation deltas.

### Agent handle

`spawn(agent, input)` returns an inferred specialized handle:

```ts
interface AgentWorkHandle<Result>
  extends WorkHandle<Result, AgentWorkEvent<Result>> {
  send(
    input: AgentSteeringInput,
  ): Promise<AgentSendReceipt>
}
```

The event parameter keeps ordinary Work handles source-compatible while
specializing Agent handles without overriding `stream()` with a wider return
type.

Users normally never name this type:

```ts
const child = await spawn(researcher, {
  topic: 'Database contention',
})

await child.send('Also inspect transaction retries.')
const result = await child.result()
```

Tool/task handles do not expose an optional `send?()` that later fails merely
because the target kind is wrong.

Serialized Work references remain inert data. Reconstructing an authorized
Agent-backed handle restores its target-specific capability. Work references
are identifiers, never ambient bearer authority across owners.

## Steering

### Input

Steering uses Crux's existing canonical user-authored content:

```ts
type AgentSteeringInput =
  | string
  | CanonicalUserContent
```

Examples:

```ts
await child.send('Prioritize primary sources.')

await child.send([
  { type: 'text', text: 'Also inspect this screenshot.' },
  { type: 'image', /* canonical image content */ },
])
```

This is distinct from the Agent's typed initial assignment. Reusing initial
input would force a complete structured assignment or invent ambiguous
partial-input patch semantics.

`send()` has no metadata or delivery-mode options in V1.

### Receipt

```ts
interface AgentSendReceipt {
  readonly id: string
  readonly cursor: WorkSteeringCursor
  readonly acceptedAt: Date
}
```

The receipt acknowledges acceptance at the guarantees declared by the handle,
not child completion. For durable Work, the send and cursor survive according
to the Work's durable guarantees. For process-local Work, they remain valid
only while that Work's activity root survives. `handle.guarantees` makes the
difference inspectable; the same receipt shape does not imply durability that
the handle does not have.

### Delivery

- acceptance is immediate and durable when guarantees permit;
- sends are ordered;
- a queued child sees accepted guidance when it starts;
- a running child sees it at the next safe boundary;
- delivery may occur mid-turn but never mid-step;
- no in-flight provider request or Tool call is mutated;
- several accepted sends may coalesce at one boundary;
- every send retains its own identity and cursor;
- a parent model normally cannot steer a foreground child while waiting;
- application code holding a handle can send before awaiting `result()`; and
- V1 accepts sends only for queued or running Agent Work.

Suspended, blocked, completed, failed, and cancelled Work rejects a send.
Detachment is an ownership transition, not a Work state:

- a formerly owning model/control Tool loses authority and its send is
  rejected;
- an application handle whose capability remains authorized after detachment
  may continue to send while the Work is queued or running; and
- a reference cannot recover the former owner's revoked authority merely
  because it still names the Work.

This design therefore supersedes Durable Agent Sessions' deferral of
externally steering running Work, but only for an authorized
`AgentWorkHandle`; it does not create a general Session mailbox or public
actor-steering API.

### Authority

Steering enters as model-visible supervisor guidance with explicit
`agent-steering` provenance. It is never a system message and cannot:

- grant approval;
- add Tools or Skills;
- change model/routing;
- raise budgets or limits;
- replace constraints or guardrails;
- mutate the Agent definition; or
- widen Runtime/organization authority.

The ergonomic verb remains `send()`. `agent-steering` is the internal semantic
category.

### Model-facing Work control

The existing owner-scoped Work control Tool adds `send` only for Agent-backed
Work:

```ts
work({
  action: 'send',
  id: 'work_12',
  message: 'Prioritize primary sources.',
})
```

The model-facing form initially accepts text. Programmatic handles support full
canonical multimodal content.

## Ownership and hierarchy

Every child has one immediate owner. Each child owns its direct descendants.

```text
supervisor
├─ researcher
│  └─ verifier
└─ reviewer
```

Model-facing Work control is limited to directly owned children. The
supervisor may:

- inspect `researcher`;
- retrieve its result;
- send guidance;
- cancel it; or
- detach it.

It may see bounded aggregate descendant counts/state under `researcher`, but
cannot directly retrieve, steer, cancel, or detach `verifier`. Work IDs do not
grant ambient authority.

Authorized application activity and Devtools can inspect the complete tree and
may expose separately authorized administrative controls.

V1 communication is hierarchical:

- parent to child through assignment and steering;
- child to parent through bounded progress and final result.

It adds no sibling messaging or autonomous team protocol.

## Cancellation and detachment

### Cancellation

Cancelling Agent-backed Work cooperatively cancels its complete attached
descendant subtree:

- cancellation propagates downward;
- it never cancels ancestors or siblings;
- the outcome remains visible upward;
- `cancel()` returns after the subtree request is accepted;
- it does not wait for every attempt to acknowledge;
- child cancellation never becomes an implicit join;
- cancellation of terminal Work is a no-op preserving the outcome; and
- once cancellation wins a cancel/detach race, detachment cannot rescue the
  subtree.

Root cancellation, deadline, future hard `kill()`, Runtime/organization safety
termination, and unsafe durable fencing/corruption remain outer execution
boundaries.

Effect cancellation/rollback follows the Joinable Background Work and Effects
contracts. Cancellation rollback never crosses into the owner or sibling
boundaries.

### Detachment

Detachment changes ownership and delivery only:

- the child and its internally attached subtree continue;
- the former owner inbox receives no further progress or completion;
- the former owner is never resumed;
- model-facing former-owner control disappears;
- pending-finish checks no longer count the detached child;
- application code retaining an authorized handle may continue to
  inspect/control it; and
- Crux does not silently reparent it into a root inbox.

The retained application handle keeps its existing target capability, so it
may call `send()` while detached Work remains queued or running. Former-owner
model control and handles/references scoped only to that ownership relation are
revoked. Detachment neither grants control to a new principal nor turns a Work
reference into bearer authority.

V1 supports no reattachment or ownership transfer.

Detachment never releases recursive safety accounting. The subtree retains its
originating root-budget identity until terminal.

## Work states

This design extends public Work state:

```ts
type WorkState =
  | 'queued'
  | 'running'
  | 'suspended'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancel-requested'
  | 'cancelled'
```

### Suspended

`suspended` is a normal durable wait with a registered continuation condition:

```ts
{
  state: 'suspended',
  suspendedOn: {
    kind: 'approval',
    // safe identity/summary
  },
}
```

Examples include:

- approval;
- Signal;
- timer;
- child result; or
- another explicit durable waiter.

The expected event returns Work to queued/running execution.

### Blocked

`blocked` means ordinary execution cannot continue and remediation is required:

```ts
{
  state: 'blocked',
  blockedOn: {
    kind: 'definition-unavailable',
    // safe remediation
  },
}
```

Examples include:

- missing pinned Agent definition;
- incompatible durable capability;
- unresolved target identity; or
- explicit migration requirement.

Temporary provider downtime, retry backoff, or capacity wait is not a permanent
blocker.

Both `suspended` and `blocked`:

- are non-terminal;
- release any worker lease;
- count as pending owner Work;
- count toward logical tree activity;
- appear in bounded safe model status;
- expose actionable detail only through authorized activity/inspection; and
- hold graceful Session close open until resumed/remediated, cancelled, or
  detached.

## Recursive safety

Recursive safety extends the existing optional `workPolicy()` contribution:

```ts
workPolicy({
  concurrency: 4,
  maxOutstanding: 16,
  tree: {
    maxDepth: 2,
    maxStarts: 64,
    maxActive: 16,
  },
})
```

No configuration is required. Finite observable defaults activate
automatically. Exact default values should follow Runtime/Agent benchmarks and
remain implementation policy rather than protocol constants.

### Scope

- `concurrency`: per-owner executing Work admission;
- `maxOutstanding`: per-owner non-terminal attached Work;
- `tree.maxDepth`: nested child Agent depth;
- `tree.maxStarts`: lifetime accepted child Agent occurrences across the root;
- `tree.maxActive`: simultaneous non-terminal child Agent Work across the
  root.

`tree.maxActive` includes queued, running, suspended, blocked, and
cancel-requested child Agent Work. Suspended/blocked Work has no worker lease
but remains active logical Work.

Terminal Work releases `maxActive` capacity. It never refunds `maxStarts`.
Detached Work continues to count toward both ledgers until terminal.

Applications needing unrelated independent Work create another
application/root scope rather than asking model-invocable `detach()` to escape
limits.

### Effective policy

Effective policy is the intersection of:

- Runtime hard ceilings;
- organization policy;
- root execution policy;
- parent declarations;
- child declarations; and
- any future strictly narrowing binding policy.

Descendants never widen it.

Model-initiated exhaustion returns a provider-valid structured Tool refusal
distinguishing:

- temporary capacity (`retryable: true`); and
- permanent depth/start boundary (`retryable: false`).

Programmatic composition receives the typed equivalent error. Structural
admission refusal does not crash the parent merely because a model probed a
limit.

`workPolicy()` owns counts and topology, not cumulative time, tokens, or cost.
A future general execution-budget design composes with it.

### Protected `use[]` policy

`workPolicy()` remains a `use[]` entry so it composes across Agents, standalone
Prompt/generation owners, Sessions, and future controllers.

Its resolved root value is protected execution policy:

- selected and frozen when execution begins;
- impossible for `prepareStep` to remove or weaken;
- invalid inside `droppable()` or `optional()`;
- selectable through explicit pre-execution conditional composition;
- narrowed only through descendant intersection; and
- absent from model tokens except bounded status/refusal material.

Runtime/organization defaults still apply when no authored policy exists.

## Result contract

### Canonical output

The child's canonical result is its exact validated Agent output:

- a text-mode Agent returns `string`;
- structured output retains its inferred schema type;
- multimodal output retains canonical content;
- partial output never counts as a successful result; and
- application `result()` returns the exact canonical value.

Foreground Agent-as-Tool execution returns a model-facing representation of
that value. Background completion announces availability; the parent
explicitly requests the result through Work control.

Crux does not automatically summarize, reshape, or copy:

- child transcript;
- intermediate assistant messages;
- Tool activity;
- progress;
- reasoning; or
- stream deltas

into parent model context.

Child output enters parent context as untrusted Agent/Tool result content,
never as system instruction. Safety provenance records that it came from a
child Agent.

An explicit `handoff()` may project, normalize, redact, or summarize output
when the application deliberately authors a different boundary. It is not
required for the normal path.

### Intrinsic representation ladder

Agent-backed Work declares two legal parent-model representations of one
canonical result:

```text
exact inline
-> explicitly labeled bounded preview + owner-scoped exact-recovery handle
```

Whole-request planning chooses the reference only when:

- the exact inline result cannot fit the planner's selected measured fit tier;
  or
- the provider cannot carry that modality in a Tool result.

The inline result is the full-fidelity rung and the reference is its reduced
rung under Whole-Request Context Management. If the complete exact-inline
request fits at or below `optimizeAt`, the planner keeps it. If it does not,
the reference may let a complete request fit the soft tier. When no legal
candidate fits the soft tier, strict-tier planning may still retain exact
inline output until the strict maximum. The reference is mandatory before
dispatch only when exact inline cannot fit the strict tier or its modality is
unsupported.

The preview never impersonates the full result. Unsupported media becomes an
asset/Work reference rather than a stringification.

This is a primitive-declared representation ladder, so the whole-request
planner still selects only authorized representations. It never invents a
reduction.

Application `result()` and Work-stream result fields expose only the canonical
exact value, never the preview. Existing Work retention still applies:

- while `resultAvailable` is true, `result()` and an authorized snapshot may
  expose that exact value;
- after result retention expires, the terminal snapshot remains but reports
  `resultAvailable: false`; and
- no stream keeps a result alive indefinitely merely because the Work is
  terminal.

Durable references use existing Storage/asset capabilities. Process-local Work
may use an owner-scoped memory reference only while its activity root lives and
reports that weaker guarantee. If neither inline nor exact-reference
representation is possible, planning fails before parent provider dispatch
with precise remediation.

A future policy may narrow this intrinsic ladder to inline-only failure without
changing the common binding.

Multimodal `send()` content uses ordinary whole-request/provider
representation planning inside the child.

## Progress and application activity

### Parent-model projection

Parent model context receives only a bounded Work projection:

- direct attached child list;
- queued/running/suspended/blocked/terminal state;
- attempt and timing;
- bounded automatically generated Agent-step progress;
- latest explicit progress when present;
- aggregate descendant counts/state; and
- result availability.

It never receives token deltas, private transcript, reasoning, or intermediate
Tool arguments/results.

### Work activity stream

This design supersedes Background Work's deferral of a general typed progress
stream.

Conceptual common events:

```ts
interface WorkLineage {
  readonly id: string
  readonly parentId?: string
  readonly rootId: string
  readonly depth: number
  readonly target: {
    readonly kind: 'agent' | 'tool' | 'task'
    readonly id: string
  }
}

interface WorkEventEnvelope<
  Cursor extends ActivityStreamCursor = WorkActivityCursor,
> {
  readonly id: string
  readonly cursor: Cursor
  readonly at: Date
  readonly lineage: WorkLineage
}

type WorkEvent<
  Result,
  Cursor extends ActivityStreamCursor = WorkActivityCursor,
> =
  | WorkEventEnvelope<Cursor> & {
      type: 'work.snapshot'
      work: WorkView<Result>
    }
  | WorkEventEnvelope<Cursor> & {
      type: 'work.changed'
      work: WorkSummary
    }

type AgentWorkEvent<
  Result,
  Cursor extends ActivityStreamCursor = WorkActivityCursor,
> =
  | WorkEvent<Result, Cursor>
  | WorkEventEnvelope<Cursor> & {
      type: 'work.delta'
      delta: GenerationStreamEvent
    }
```

Exact type factoring may use a shared base and narrowed Agent target
discriminant. It must preserve one public event vocabulary, not add
`SubagentEvent` or `ChildEvent`.

`ActivityStreamCursor` is an internal/public constraint shared by the opaque
root-specific cursor brands; users never construct it. Standalone Work binds
the default `WorkActivityCursor`. Session-owned Work binds
`SessionStreamCursor`.

Event IDs are stable and unique within the activity root. `cursor` identifies
the event's ordered position on that root's cursor line, while `at` is
observational time and never the ordering authority. `lineage` is present on
every event, including snapshots, so reducers never need event-kind-specific
ancestry lookup.

### Focused and aggregate scopes

```ts
for await (const event of child.stream()) {
  render(event)
}

for await (const event of session.stream()) {
  render(event)
}
```

- `child.stream()` is a focused Work projection;
- `session.stream()` is an aggregate activity-root projection;
- aggregate streams discover model-started descendants without child handles;
- all Work activity carries lineage;
- official reducers can render a complete tree; and
- parent models never consume this application activity projection.

Default behavior is:

- scope/root generation deltas are included;
- lifecycle and bounded progress for descendants are included;
- high-volume descendant generation/Tool deltas are excluded.

An explicit option includes subtree deltas:

```ts
session.stream({
  include: {
    deltas: 'subtree',
  },
})
```

The same option shape applies to focused Work streams. The default is the
current scope.

### Cursor and retention

Focused and aggregate views share the activity root's cursor line.

```ts
for await (const event of child.stream({ after: cursor })) {
  cursor = event.cursor
}
```

- omitting `after` emits a current snapshot followed by live activity;
- events are ordered and at-least-once;
- stable IDs support deduplication;
- slow consumers never block execution;
- stopping/aborting observation never cancels Work;
- recent safe deltas may replay;
- older raw deltas compact into current/terminal snapshots;
- an expired cursor emits a replacement snapshot and continues;
- completed Work can still produce a terminal snapshot; and
- redaction removes retained child deltas from focused and ancestor views.

Durable Work uses configured Runtime and Storage. Process-local Work reconnects
only while its activity root survives. Existing guarantees and predictive
development diagnostics make that limitation explicit. No activity-specific
Storage setting is introduced.

This amends the Durable Agent Sessions event union to include lineage-aware
Work snapshot/change/delta activity and the subtree-delta option. Concretely:

```ts
type SessionWorkEvent<Result = unknown> =
  AgentWorkEvent<Result, SessionStreamCursor>
```

At the Session boundary, `id`, `cursor`, and `at` are the existing
`SessionEventBase` fields on the same event envelope. Work activity uses the
Session activity root's `SessionStreamCursor`; it does not introduce a nested
cursor or a second ordering line. This supersedes the companion Session
design's single `{ type: 'work.changed'; work: WorkSummary }` arm with the
lineage-aware Work union. Non-Work Session event arms remain unchanged.

## Approval boundaries

Delegation and internal child actions have independent approval boundaries.

### Outer delegation

The Agent binding participates in the parent's existing Tool approval policy
under its map key.

Approval/denial happens before child Work acceptance. A denial returns the
ordinary provider-valid Tool denial to the supervisor.

### Internal actions

After the child starts, its Tool calls use the child Agent's own approval
policies.

Approving delegation never pre-approves all future child actions. The parent
model cannot self-approve through `send()` or Work control.

When internal approval is required:

- foreground child execution suspends, and the waiting parent step remains
  unresolved;
- background child Work suspends while the parent may continue;
- authorized owner/Session activity exposes the canonical approval request;
- parent model context sees only bounded suspended status; and
- approval identity/decisions survive durable retry and resume.

Denial becomes an ordinary Tool denial inside the child. The child may recover
or fail normally.

## Idempotency and replay

Agent-as-Tool Work is automatically idempotent per logical Tool-call
occurrence.

Automatic occurrence identity derives from:

- owner execution;
- parent turn/step occurrence;
- normalized Tool-call occurrence identity; and
- binding key.

Definition version is not part of automatic occurrence identity. It is pinned
on the accepted Work record. Therefore replay after a deployment still finds
the original Work rather than spawning a duplicate.

Normalized input is conflict evidence, not occurrence identity. Conflicting
input for one occurrence is durable protocol corruption/conflict.

Replay returns the same:

- Work ID/handle;
- pending state;
- committed result;
- failure; or
- cancellation.

Providers without stable native Tool-call IDs use Crux's normalized stable
occurrence identity.

Programmatic `spawn(..., { idempotencyKey })` retains its explicit
owner/target/definition-version-scoped semantics. That key deduplicates one
Work occurrence; it never means "continue the last child."

## Durability and activation

### Project Index discovery

Project Index follows:

- exported Agent definitions;
- Agent values in `tools`;
- `backgroundable(agent)` targets;
- nested composition relations;
- Agent input/output contracts; and
- required executor/Runtime capabilities.

Runtime generation builds the activation manifest automatically. Users do not
mount or register child Agents manually.

### Durable requirements

Durable child Work requires:

- stable Agent ID;
- serializable normalized input;
- serializable validated output;
- exact definition fingerprint/version;
- manifest-resolvable exported definition;
- activated adapter `AgentExecutor`;
- activated referenced Tools/Skills/resources; and
- required Runtime/Storage/Host capabilities.

Process-local execution may invoke an imported or dynamically constructed Agent
directly.

If durability is optional and a process-local fallback is honest, Crux may use
it and warn in development about lost restart/rejoin guarantees. A durable
Session or Flow never silently downgrades attached child Work.

### Definition pinning

Acceptance records the exact Agent definition fingerprint/version.

- retries and resumes use that version;
- a deployment never silently changes accepted Work;
- new Work uses the new deployment;
- an unavailable pinned definition produces `blocked` with migration/recovery
  guidance; and
- Crux never pretends a new definition is replay-equivalent.

V1 requires no user-authored version number. Project Index/Runtime identity
owns the fingerprint.

## Failure isolation

Ordinary child-scoped failure becomes data the parent can handle after the
child's own retry/recovery policy exhausts.

Foreground execution returns a provider-valid structured Agent Tool error.
The parent may:

- try another child;
- change the assignment;
- work inline;
- continue with partial overall progress; or
- report the failure.

Child-scoped failures include:

- child provider failure;
- child Tool failure;
- output-validation failure;
- guardrail failure;
- child-specific timeout;
- child cancellation;
- an ordinary child Tool/Skill capability failure after the pinned Agent Work
  has activated successfully; and
- structural admission refusal.

Partial output is never a successful typed result.

Background failure/cancellation terminalizes Work, wakes a durable owner, and
appears through Work control. Programmatic `result()` rejects with the typed
Work failure/cancellation error.

Execution-boundary failures still propagate or block the tree:

- root cancellation/deadline/future hard kill;
- unsafe durable corruption or fencing;
- unresolved required definition/capability;
- Runtime/organization safety termination; or
- an integrity failure that makes replay unsafe.

The activation boundary distinguishes the two capability cases:

- if the pinned Agent has activated and one of its ordinary invoked
  Tools/Skills reports an unavailable capability, that invocation fails inside
  the child and is child-scoped data;
- if Crux cannot activate, reconstruct, or safely resume accepted Work because
  its pinned definition, executor, Runtime contract, or required referenced
  capability is unavailable, the Work is `blocked`; and
- if the same required activation capability is known to be absent before a
  new occurrence is accepted, admission rejects without creating Work.

Crux never terminalizes accepted durable Work merely because a deployment
temporarily cannot reconstruct its required execution boundary.

Rule:

```text
delegated-work failure is data the parent may handle
execution-boundary failure ends or blocks the tree
```

## Composition semantics

Existing Agent compositions reuse the same internal execution, activity,
cancellation, admission, and observability foundation without changing their
public APIs.

### Parallel, pipeline, and consensus

`parallel()`, `pipeline()`, and `consensus()` own and join their nested Agent
executions according to existing semantics.

Activity labels relationships such as:

- parallel branch;
- pipeline stage; and
- consensus synthesis.

They do not expose Work-handle ceremony merely because the internal lifecycle
is unified.

Nested Agent executions count toward the originating root:

- `tree.maxDepth`;
- `tree.maxActive`;
- `tree.maxStarts`; and
- future general execution budgets.

Application-authored exhaustion returns the typed programmatic admission error
rather than fabricating a model Tool refusal.

### Swarm

A swarm handoff transfers active responsibility to a peer. It does not create a
parent awaiting a child result.

Therefore:

- handoff edges are not child depth;
- existing handoff-loop bounds remain separate;
- a handoff preserves the current Work occurrence, depth, and root budget;
- repeated handoffs cannot reset counts/time/tokens/cost; and
- activity still visualizes the complete transfer path.

## Adapter contract

Adapter-provided Agent execution capabilities cover:

- nested Agent invocation;
- typed input/output;
- foreground execution;
- background execution where Runtime/Host permit;
- safe step boundaries for running-work `send()`;
- provider-neutral generation deltas;
- structured and multimodal result lowering;
- approval suspend/resume;
- cancellation; and
- durable resume where promised.

Crux-owned loops implement these directly. First-party adapter-owned loops,
including AI SDK integrations, must bridge their step lifecycle so behavior
matches:

- ingress is accepted at any time;
- delivery occurs at the next safe step boundary;
- no in-flight provider request/Tool call is mutated;
- context is replanned before the next provider request; and
- stream and result evidence use the same canonical vocabulary.

A third-party adapter may declare a smaller capability matrix. Activation or
spawn rejects an unavailable requested guarantee with precise remediation. It
never silently changes foreground/background, steering, streaming, structured
output, multimodality, or durability semantics.

## Observability and Devtools

Every child preserves:

- root operation/session identity;
- unique child run and Work IDs;
- immediate owner;
- binding role;
- Agent definition/version;
- target kind;
- depth;
- assignment provenance;
- output provenance;
- foreground/background mode;
- attempts and timing;
- model/Tool usage and cost;
- steering receipts/delivery;
- approval state;
- cancellation/detachment;
- suspended/blocked reason;
- Effect recovery;
- result representation; and
- inbox delivery/consumption.

Devtools should answer:

- Which Agent started this child?
- Why was it authorized?
- What is it doing or waiting on?
- Which descendants exist?
- Is it foreground, background, suspended, blocked, detached, or orphaned?
- Will its result return anywhere?
- Which definition version will resume?
- Why did admission refuse another child?
- Was the parent given the exact result or a labeled reference?
- Did cancellation recover Effects?

The parent model receives only the bounded Work projection. Authorized
application streams and Devtools may show richer deltas under existing
observability privacy/redaction policy. Hidden chain-of-thought is never
manufactured or exposed; only provider-safe canonical reasoning content may
appear when already allowed by the generation stream contract.

## Eval contract

Every Eval Case/Variant/trial uses an isolated virtual Work namespace and
scheduler for both foreground and background Agent-backed Work by default.

The root supervisor remains the Eval subject. Nested child providers and
production Runtime targets are not invoked unless live nested execution is
explicitly enabled.

The virtual scheduler can script:

- typed child completion;
- generation/progress activity;
- queued/running transitions;
- suspension/resumption;
- failure/retry;
- approval;
- steering acceptance/delivery;
- cancellation acknowledgement or completion race;
- detachment;
- owner ending;
- durable wake; and
- result retrieval timing.

Child fixtures validate against the Agent output contract. Production
`WorkHandle`, `stream()`, `send()`, `result()`, `cancel()`, and `detach()` code
runs unchanged against virtual state.

Eval evidence captures:

- selected binding;
- normalized assignment;
- foreground/background choice;
- guarantees;
- tree/admission decisions;
- idempotency;
- steering;
- approval;
- result representation/retrieval;
- failures; and
- lifecycle outcomes.

Full live multi-Agent Evals require an explicit isolated option. Live execution
is never enabled merely because the child is foreground.

## Development diagnostics

Diagnostics should be actionable and source-linked for:

- bound Agent missing a description;
- provider Tool-schema projection failure;
- missing stable Agent identity/output contract for requested durability;
- missing executor or manifest target;
- process-local fallback where restart/rejoin may be expected;
- non-durable owner ending with attached child Work;
- unusually long/multi-step foreground child where `backgroundable()` may fit;
- tree depth/start/active exhaustion;
- attempted policy weakening/removal;
- `workPolicy()` inside `droppable()` or `optional()`;
- send to a non-Agent, terminal, suspended, blocked, cancelled, or unauthorized
  Work;
- unavailable exact-reference backing;
- pinned definition unavailable after deployment;
- owner/tenant authorization mismatch;
- adapter capability mismatch; and
- Eval attempt to dispatch nested live Work without explicit opt-in.

Development may warn when a weaker process-local guarantee still produces a
correct result. It must fail before acceptance when a required durable
guarantee cannot be met. Behavior that appears to work in development but will
fail after deployment must produce a predictive diagnostic.

## Security

- Agent bindings authorize only application-defined child profiles.
- The parent model cannot widen child capabilities.
- Steering is untrusted model-visible guidance, never system instruction.
- Child results/progress are untrusted Agent/Tool output.
- Work control validates direct ownership server-side.
- Work IDs and references are not cross-owner bearer authority.
- Application activity requires owner-scope authorization.
- Descendant deltas inherit redaction, tenancy, residency, retention, and
  observability privacy policy.
- Redacting a child removes retained deltas from focused and ancestor streams.
- Exact-recovery handles are owner-scoped and validate tenant, authorization,
  content type, residency, retention, and allowed operations.
- Detachment retains captured execution permissions and never widens them.
- Approval of delegation does not approve internal child actions.
- Cancellation grants neither elevated rollback nor recovery authority.

## Testing strategy

### Type tests

- object, no-input, and non-object Tool-schema projection;
- `spawn(agent, input)` input inference;
- structured/text output inference;
- `AgentWorkHandle` exposes `send()`;
- Tool/task `WorkHandle` does not expose Agent-only send;
- multimodal steering typing;
- Work/Agent event narrowing; and
- Agent values/backgroundable Agent values in Tool maps.

### Unit tests

- description precedence and failure;
- fresh child occurrence per new Tool call;
- replay identity excludes definition version;
- conflicting replay input;
- safe-boundary ordered/coalesced steering;
- forbidden steering authority changes;
- parent/child context isolation;
- exact result validation;
- inline/reference selection;
- suspended versus blocked transitions;
- cancellation/detachment race;
- recursive attached cancellation;
- detached budget retention;
- direct-owner model control;
- policy intersection/protection;
- tree refusal retryability; and
- approval boundary separation.

### Conformance tests

Every first-party adapter must prove:

- direct foreground Agent-as-Tool execution;
- background Agent execution;
- object/non-object input parity;
- text/structured/multimodal result parity;
- step-safe steering;
- application Work deltas;
- provider-valid child failure result;
- approval suspension/resumption;
- cancellation;
- process-local guarantees;
- durable capability rejection or execution; and
- exact-reference lowering for unsupported Tool-result modalities.

Crux-owned and adapter-owned loops use the same fixtures.

### Runtime tests

- atomic Work acceptance and owner binding;
- automatic Tool-call replay;
- definition pinning across deployment;
- missing pinned definition blocking;
- Session wake/rejoin;
- cursor resume, compaction, and replacement snapshot;
- multi-consumer backpressure isolation;
- redaction across ancestor activity;
- root tree accounting across detach/handoff/compositions;
- suspend/blocked close barriers;
- cancellation propagation and Effect recovery; and
- restart-safe steering delivery.

### Eval tests

- child Work virtualized in foreground and background;
- no production target dispatch by default;
- typed scripted completion/failure;
- deterministic IDs/time/cursors;
- steering and approvals;
- tree admission evidence;
- cancellation/detachment;
- durable wake simulation; and
- explicit live nested execution.

## Acceptance criteria

1. An Agent can be placed directly in another Agent's `tools` map.
2. The binding is typed from the child input/output contract.
3. Direct execution is foreground; `backgroundable(agent)` adds background
   choice.
4. `spawn(agent, input)` returns a specialized typed Agent Work handle.
5. Agent Work supports focused activity streaming and safe-boundary `send()`.
6. Parent model context receives bounded direct-child status, never child
   transcript/deltas.
7. Application Session/owner streams can visualize the complete child tree.
8. Child context is fresh unless resources are explicitly shared.
9. Recursive limits activate automatically and cannot be escaped by detach,
   handoff, composition, or step amendments.
10. Cancellation cascades down attached descendants but never upward/sideways.
11. Finite child Work never implicitly becomes a Session.
12. Agent results remain exact canonically and lower to labeled
    exact-recovery references only when necessary.
13. Delegation approval and internal Tool approval remain independent.
14. Automatic Tool-call replay never double-spawns a child across deployment.
15. Durable Work pins an automatically discovered Agent definition version.
16. Suspended and blocked states preserve Crux's established meanings.
17. Process-local use works with honest guarantees and predictive diagnostics.
18. Existing Agent compositions retain their public semantics while sharing
    execution/activity infrastructure.
19. Supervisor Evals virtualize nested Agent Work by default.
20. No additional registry, Storage setting, or mandatory binding wrapper is
    required.
