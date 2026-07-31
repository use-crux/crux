# Whole-Request Context Management Design

Status: **proposed**

Related designs:

- [Canonical Thread](./2026-07-24-thread-design.md)
- [Message History Projection](./2026-07-25-message-history-projection-design.md)
- [Joinable Background Work](./2026-07-23-joinable-background-work-design.md)
- existing Prompt, Context, Tool, Memory, Storage, defer-host, adapter,
  observability, and model-routing contracts

This design supersedes the public history-projection API and all
context-budget/compaction assumptions in Message History Projection. Its
canonical Thread ownership, message-source precedence, causal grouping, and
commit semantics remain applicable unless changed here.

## Summary

Crux should automatically plan the complete request sent to every language
model. Plain context remains exact and required. Users authorize only the
specific adaptations they consider safe:

```ts
const support = agent({
  prompt: supportPrompt,
  model,
  maxTokens: 8_000,
  inputBudget: {
    optimizeAt: 80_000,
  },
  use: [
    conversation,
    history(),
    refundPolicy,
    prefer(fullStyleGuide, compactStyleGuide),
    summarizable([productDocs, decisionLog]),
    offloadable(debugLogs),
    droppable(brandVoice),
  ],
})
```

The public mental model is:

> Plain `use[]` entries are exact and required. `-able` wrappers authorize
> specific degradation. Crux automatically selects the best complete legal
> request and explains every adaptation.

Planning accounts for the whole provider request after the concrete model is
known:

- system and authored context;
- conversation messages;
- Tool definitions and Tool results;
- structured-output schemas;
- multimodal parts;
- provider envelope overhead;
- output headroom; and
- Crux-owned support capabilities.

Every provider call receives an immutable internal request plan. Users see a
small request receipt:

```ts
const result = await generate(prompt, { model, input })

result.steps[0].request
await result.steps[0].request.inspect()
```

Planning is automatic. There is no `fit()` contributor, context-manager object,
second transcript, or executable public request plan.

## Product principles

1. **Exact by default.** Plain contributors are never silently omitted,
   truncated, summarized, or substituted.
2. **Loss requires local authorization.** The source or its wrapper declares
   every legal representation.
3. **The whole request is the unit of fit.** Context text cannot be budgeted
   correctly in isolation from messages, Tools, schemas, media, and output.
4. **Canonical truth never changes under pressure.** History projection,
   summaries, offloads, and provider-native edits affect model views only.
5. **Simple problems get simple APIs.** Bare Thread, `history.recent()`, and
   zero-option `history()` cover the common history cases.
6. **Advanced control composes with the same planner.** Conditions, per-step
   amendments, and composition controllers cannot bypass validation.
7. **No infrastructure tax for correctness.** Storage and defer hosts improve
   reuse and latency. Missing infrastructure falls back honestly and warns
   before production differences surprise users.
8. **Provider neutrality is canonical.** Provider-native counting, caching, and
   compaction are adapter lowerings with receipts, not the portable source of
   truth.
9. **Every adaptation is observable.** Users can answer what the model saw,
   what changed, and why.
10. **One configuration for each concern.** No separate compaction store,
    request-plan store, offload store, or output-reserve setting.

## Goals

V1 should provide:

- automatic per-provider-call whole-request planning;
- model-derived capacity and optional per-call `inputBudget`;
- elastic optimization and hard fit limits;
- exact-by-default contributor semantics;
- authored representation ladders through `prefer()`;
- generated summaries through `summarizable()`;
- exact-recovery references through `offloadable()` and forced `offload()`;
- complete omission through `droppable()`;
- bare exact Thread history, stateless recent history, and managed history;
- deferred, content-addressed summary maintenance with inline fallback;
- model- and adapter-aware token measurement;
- immutable request receipts and pre-execution previews;
- safe per-provider-step and per-composition-invocation amendments;
- invocation- and composition-stage `use`;
- multimodal and structured-output correctness;
- provider-native optimization with portable fallbacks;
- actionable failures and predictive development diagnostics; and
- clean removal of the obsolete partial compaction surface.

## Non-goals

This design does not define:

- a stateful public context controller;
- arbitrary raw message or system-prompt replacement;
- hidden model calls invented to make a representation usable;
- request-wide opaque summarization;
- semantic importance classification by another model;
- a universal cache primitive;
- provider-hosted history as canonical truth;
- a new Storage, observability, or runtime configuration;
- operation-specific context control for image generation, speech,
  transcription, or embedding;
- cross-Thread merge/rebase;
- Session lifecycle, steering, or durable activation semantics; or
- preset names beyond the approved summary strategies.

Future controllers must emit the same constrained amendments defined here
rather than introduce another request-construction path.

## Terminology

### Contributor

A Context, Thread/history projection, Memory source, retrieval source, Skill,
ToolSource, or another `use` entry that contributes model-facing
representations, capabilities, or both.

### Canonical source

The exact application-owned or Crux-owned value from which model
representations are derived. Request pressure never mutates it.

### Representation

One legal model-facing view of a canonical source. Examples are full text, an
authored compact form, a generated summary, or a preview plus exact-reference
handle.

### Representation ladder

One ordered sequence of legal representations for one canonical source
identity. Fidelity can decrease only from left to right.

### Request plan

The internal immutable materialization of exactly one provider call after model
resolution, source resolution, measurement, representation selection, and
adapter lowering. It is not a public executable value.

### Request receipt

The small public evidence attached to an executed provider step.

### Model epoch

A consecutive sequence of provider calls using the same resolved model and
input-budget policy. Representation fidelity is monotonic within an epoch.

## Ownership and architecture

The implementation should preserve these boundaries:

1. **Sources** declare semantic content, importance, exact contracts, owned
   capabilities, and legal representations.
2. **History projection** chooses the model-facing view of canonical Thread or
   caller-owned messages.
3. **Derived-artifact maintenance** prepares, caches, refreshes, and invalidates
   generated summaries.
4. **Request planning** resolves the concrete model, measures the complete
   request, and selects one legal representation per source.
5. **Execution** owns routing, loop steps, constrained amendments, retries,
   overflow recovery, and post-turn maintenance scheduling.
6. **Adapters** own model profiles, provider counting, envelope/media/schema
   costs, native context management, and prompt-cache lowering.
7. **Observability** owns receipts, detailed inspection, diagnostics, and
   Devtools presentation.

No stateful context manager owns another transcript. State remains in Thread,
Storage, derived artifacts, adapters, and the execution/Session owner.

## Public API

### Exact-by-default composition

Every plain contributor is exact and required:

```ts
use: [
  refundPolicy,
  projectContext,
]
```

Priority ranks only transformations already authorized by a source. It never
authorizes loss. Array order also does not authorize loss.

If required floors do not fit, Crux fails before provider dispatch.

### Authored alternatives

`prefer()` declares an ordered authored ladder:

```ts
prefer(fullInstructions, compactInstructions)
```

Exactly one representation is selected. The primary source owns semantic
identity and priority. This is distinct from generation/model `fallback()`,
which handles execution failure rather than input pressure.

The primary source also owns the ladder's capability set. Authored alternatives
are representations of that source, not independent capability contributors.
Crux rejects an alternative that declares a different Tool, Skill, constraint,
guardrail, or approval set.

### Generated summaries

`summarizable()` authorizes a generated lower-fidelity representation:

```ts
summarizable(productDocs)

summarizable([productDocs, decisions], {
  model: fastModel,
  strategy: summarize.hierarchical(),
})
```

An array is one atomic elastic unit. The default ladder is:

```text
full source -> generated summary
```

The atomic unit owns the union of its canonical members' capabilities.
Capability-name collisions inside that union fail during definition
validation.

The name is intentionally adjectival: constructing the value does not eagerly
summarize or guarantee that the model will receive the summary.

First-party strategies are:

```ts
summarize.adaptive()
summarize.regenerate()
summarize.rolling()
summarize.hierarchical()
```

`summarize.adaptive()` is the versioned default. It uses immutable hierarchical
range artifacts for scale and can periodically regenerate from canonical truth
to bound drift.

Sources determine which parts are summarizable. Messages, retrieved documents,
files/data, and Tool results normally are. Instructions, constraints,
guardrails, approval rules, Tool schemas, and structured-output schemas remain
exact by default. Users provide authored compact alternatives for exact
contracts:

```ts
prefer(fullInstructions, compactInstructions)
```

### Exact-recovery references

`offloadable()` authorizes a full-to-reference ladder:

```ts
offloadable(debugLogs)

offloadable(debugLogs, {
  aboveTokens: 4_000,
})
```

The referenced representation contains a deterministic bounded, type-aware
preview and an opaque typed handle from which the model can recover the exact
canonical value.

`offload()` forces the referenced representation:

```ts
offload(secretDocument)
return offload(toolResult)
```

Forced offload fails before dispatch when suitable backing or access is
unavailable.

Tool definitions may declare an output policy without changing their
application-facing return type:

```ts
const fetchLogs = tool({
  description: 'Fetch deployment logs',
  parameters: schema,
  execute: fetchDeploymentLogs,
  output: offloadable({
    aboveTokens: 4_000,
  }),
})
```

Execution evidence distinguishes canonical `output`, model-facing
`modelOutput`, and the offload receipt.

Offload uses existing Storage, Workspace, and addressable assets. It never
requires an offload-specific store. Handles are opaque, owner-scoped, and
validated for tenant, authorization, residency, retention, allowed operations,
and content type.

Canonical storage normalization is separate from request-time representation.
Thread always owns an exact immutable content part; Storage may preserve that
part inline, by immutable asset reference, or by reusing an existing Workspace
asset. Transient request pressure never changes Thread truth.

When an offloaded representation needs retrieval, Crux injects a
provider-neutral support capability automatically. The capability is required,
fully budgeted, and receipted. If the current call cannot access references,
the offload rung is unavailable. Crux may use a semantically equivalent
provider-native reference lowering. It never enables incompatible Tools,
weakens structured output, or invents an extra model call.

### Complete omission

`droppable()` authorizes complete omission under pressure:

```ts
droppable(brandVoice)
droppable(prefer(fullGuide, compactGuide))
```

It does not make the underlying input nullable, swallow resolution errors,
truncate content, or perform conditional inclusion. `when()` and `match()` own
conditional inclusion.

Complete omission removes the contributor's model-facing representations and
owned capabilities. Representation changes through `prefer()`,
`summarizable()`, or `offloadable()` retain owned capabilities.

### Representation-policy grammar

Wrappers compile into one type-enforced ladder:

```ts
droppable(
  offloadable(
    summarizable(docs),
  ),
)
```

This means:

```text
full -> generated summary -> exact-recovery reference -> omitted
```

Legal structure:

```text
source
prefer(source, authored alternatives...)
summarizable(source or source[])
offloadable(source or non-terminal ladder)
droppable(source or ladder)
```

`droppable()` is terminal and outermost. TypeScript should reject
`prefer(droppable(...), ...)`, `summarizable(droppable(...))`,
`summarizable(offloadable(...))`, nested `droppable()`, and other
order-reversing or identity-ambiguous forms. Definition-time validation is the
backstop.

## History

### Bare Thread

A bare Thread means complete exact canonical history:

```ts
use: [conversation]
```

Crux never applies an implicit recent-message window or summary. Once a bare
Thread crosses the derived optimization watermark, development emits a
deduplicated predictive warning that exact history will eventually stop
fitting. The risk remains visible in observability in every environment.

If the complete Thread no longer fits, execution fails before provider
dispatch and points to `history.recent()` or `history()`.

### Stateless recent history

`history.recent()` selects the newest causal-group-safe suffix:

```ts
history.recent(20)

history.recent({
  messages: 20,
  tokens: 12_000,
})
```

It performs no model call, Storage write, summary, deferred work, or transcript
capture. When both caps are present, the selected suffix satisfies both while
keeping Tool lifecycle/causal groups atomic. Boundary adjustments are
receipted.

Message and token caps are soft at causal-group boundaries. Crux selects the
newest complete groups satisfying both caps. If the newest indivisible group
alone exceeds either cap, that complete group is retained and the overflow is
receipted rather than splitting Tool or interaction lifecycle.

A contiguous leading system-only prefix is retained outside the conversational
caps at whole-group boundaries. A mixed system/conversation group remains in
the ordinary suffix and counts toward both caps. Later system messages remain
at their causal position.

In automatic Prompt mode, projection applies to prior history; the new current
prompt is appended afterward and does not count toward the caps. In manual
transcript mode, the caller supplied a complete transcript, so its newest
complete or valid open terminal group participates in projection.

### Managed history

`history()` authorizes adaptive model-facing history management:

```ts
use: [
  conversation,
  history(),
]
```

Advanced options are local:

```ts
history({
  recent: {
    messages: 20,
    tokens: 12_000,
  },
  summary: {
    model: fastModel,
    strategy: summarize.hierarchical(),
  },
  onMiss: 'inline',
  providerNative: true,
})
```

```ts
interface HistoryOptions {
  recent?: number | {
    messages?: number
    tokens?: number
  }
  summary?: {
    model?: Model
    strategy?: SummarizeStrategy
  }
  onMiss?: 'inline' | 'recent-only' | 'fail'
  providerNative?: boolean
}
```

Defaults:

- `recent` is derived from the resolved model and complete request;
- `summary.model` is the invocation's resolved response model;
- `summary.strategy` is `summarize.adaptive()`;
- `onMiss` is `inline`; and
- `providerNative` is `true`.

`providerNative: false` forces the portable Crux-managed path for
replay/compliance requirements.

Exactly one history projection may be active after conditional resolution:
`history.recent()` or `history()`, never both.

### History source selection

History projection applies to the invocation's normalized history source:

1. call-site caller-owned `messages`, when present;
2. otherwise Prompt-level caller-owned `messages`;
3. otherwise the active Thread path; or
4. no history.

The first source wins; arrays are never merged. Call-site messages are a
complete local override and suppress resolved Prompt content. Prompt-level
messages are likewise a complete transcript mode. Both shadow Thread history
for that invocation, and Crux does not infer a Thread append from either
caller-owned transcript. Configured system/context policy and non-history
capabilities still apply. A source-aware diagnostic explains the selection and
shadowing.

Managed history over manual messages uses normalized sequence/prefix digests
instead of Thread revisions for artifact identity. It may reuse standard
Storage artifacts and defer preparation, but it never commits the caller-owned
transcript.

If neither messages nor Thread exists, a history projection emits an actionable
diagnostic instead of silently doing nothing.

## Summary artifact lifecycle

Generated summaries are derived artifacts, never canonical truth. One lifecycle
applies to history, Context, retrieval, file/data, and Tool-result sources.

Whenever a `summarizable()` source resolves, Crux checks for a valid
content-addressed artifact. Crossing the preparation watermark schedules
preparation through `defer()` or the same request-retention host port. Work is
retained after the current response rather than holding it open.

For history, preparation is evaluated after an accepted Thread turn commits or
an eligible manual-history invocation completes. For other sources it is
evaluated after resolution; accepted Tool results become eligible when their
canonical result is recorded. A later call may reuse the artifact regardless
of which invocation prepared it.

Preparation:

- snapshots an exact Thread revision/range or manual-message prefix digest;
- uses content-addressed identity including source, strategy, model, prompt
  version, and policy;
- publishes idempotently and deduplicates concurrent identical work;
- inherits the strictest input sensitivity, tenancy, residency, ownership, and
  retention policy;
- preserves role, trust, and provenance boundaries; and
- never holds the response stream open by default.

Hysteresis prevents maintenance on every turn. A valid summary of an exact
prefix plus its raw suffix remains usable while a fresher artifact prepares.

The general artifact-miss ladder is:

1. A valid artifact makes the summary rung available to normal request
   planning. History uses a valid summary of an exact prefix plus its raw
   suffix.
2. If the full source fits the strict request maximum, its missing summary rung
   is unavailable for that call. Crux may use the full source and schedules
   preparation. It does not add first-call latency merely to cross the soft
   watermark.
3. If the full source cannot fit and the summary rung is needed, Crux joins
   identical in-flight preparation or generates the summary inline.
4. If inline generation fails or the source cannot be partitioned safely for
   the selected strategy/model, the summary rung is unavailable. Planning
   tries only another explicitly authorized rung or fails.

`onMiss: 'recent-only'` explicitly authorizes recent-only degradation.
Serverless deployment or a missing defer host never authorizes that loss.

Constructing `summarizable()` explicitly authorizes these preparation model
calls. Every inline or deferred support call is linked, receipted, and visible
in observability; it is not an invented hidden request. A preparation request
cannot recursively invoke the same source's `summarizable()` policy.
Hierarchical and rolling strategies partition canonical input
deterministically into bounded support calls instead.

When no retention host is configured, correctness remains unchanged and inline
fallback works. Development warns that missing background preparation may add
request latency and points to supported host/runtime setup.

## Whole-request input budget

Input pressure is an execution setting, never a `use` contributor:

```ts
agent({
  maxTokens: 8_000,
  inputBudget: {
    optimizeAt: 80_000,
    max: 180_000,
  },
})
```

```ts
interface InputBudget {
  optimizeAt?: number
  max?: number
}
```

`inputBudget` applies independently to each provider call. It is not a
cumulative Agent-run allowance and does not own cost, latency, Tool count,
elapsed time, or step limits.

With no explicit values, Crux derives capacity from the resolved model. The
effective strict maximum is the lesser of the configured maximum and:

```text
model context window
- generation maxTokens
- provider/schema overhead
- counting safety margin
```

Adapters report model capacity through a synchronous, side-effect-free
`capacity(model)` hook:

```ts
interface ModelCapacityProfile {
  contextWindow: number
  defaultOutputReserve: number
  countingConfidence: 'exact' | 'estimated' | 'conservative'
}
```

A missing hook or an unresolved model uses Core's conservative profile: an
8,192-token context window with a 2,048-token output reserve. An adapter may
return a smaller or provider-specific conservative fallback for unknown model
identifiers. Authoritative token counting is a separate optional asynchronous
adapter port because it may require provider I/O; capacity lookup never does.

When `maxTokens` is absent, the adapter/model profile supplies a safe,
observable output reserve. There is no second response-headroom setting.

`optimizeAt` is a soft watermark. Crossing it begins preparation and selection
of authorized reductions. A lower reset watermark is derived for hysteresis.
Requests may operate between the soft and strict limits when preserving
fidelity is preferable. Failure occurs only when no legal complete request fits
the strict effective maximum.

Selection uses two fit tiers:

1. If any complete legal candidate fits at or below `optimizeAt`, select the
   highest-fidelity candidate in that tier.
2. Otherwise select the highest-fidelity complete legal candidate at or below
   the strict effective maximum.
3. If neither tier contains a candidate, fail before provider dispatch.

This makes the watermark effective without turning it into another hard
limit. A request may remain above it when no authorized reduction can cross
it.

## Request planning

Planning occurs automatically after concrete model resolution for every
provider call.

The planner:

1. resolves the active contributor graph and capabilities;
2. enumerates source-declared legal representations;
3. measures complete candidate requests;
4. preserves every required source's minimum representation;
5. selects from the `optimizeAt` tier when possible, otherwise the strict tier;
6. maximizes fidelity lexicographically within that tier;
7. uses operational cost and token savings as later deterministic tie-breakers;
8. validates provider and structured-output compatibility;
9. lowers through the selected adapter; and
10. emits one immutable internal request plan and public receipt.

The fidelity vector orders contributors by descending declared priority, then
by stable resolved declaration order within a priority stratum. Each element
is that contributor's ladder position, with full before every reduced rung and
omission last. Candidate comparison is lexicographic. Declaration order
therefore resolves an otherwise exact tie; it never creates a lossy
representation or makes an undeclared reduction legal.

The planner never invokes another model to guess the importance of arbitrary
content.

One internal plan describes exactly one provider call. Every Tool-loop step,
model-routing change, steering/work-result injection, or child invocation
creates a fresh linked plan.

Network/rate-limit retries reuse the exact sealed request. A provider
context-overflow rejection may create one linked recovery request using only
already-authorized representations. Crux never repeatedly guesses truncation.

Provider adapters report additional wire attempts for the same sealed request
as `transportRetries` on normalized completion facts. Core never infers this
count by re-planning: live receipt inspection exposes it as `retryCount`, while
the small JSON-safe receipt remains unchanged.

### Measurement

Every candidate receives a fast adapter/model-specific estimate. When
uncertainty could change the selected representation or fit result, Crux uses
an authoritative provider counter when available.

When authoritative counting is unavailable, Crux plans against a conservative
upper bound. Receipts report:

```text
exact | estimated | conservative
```

including the applied confidence/margin in full inspection.

### Representation stability

Fidelity is monotonic within a model epoch. Once a contributor moves to a
smaller representation, later Tool-loop calls do not automatically expand it
because transient headroom reappears.

A concrete model change or explicit per-step `inputBudget` change begins a new
epoch and plans afresh from canonical sources. Context/tool-only amendments do
not reset fidelity.

## Preview and executed-request evidence

### Pre-execution preview

`preview()` is the one observational pre-execution API:

```ts
const previewResult = await preview(agent, {
  input,
  model,
  messages,
  inputBudget,
})
```

The second argument reuses the primitive's typed invocation options. There are
no per-primitive preview aliases.

```ts
interface RequestPreview {
  status: 'fits' | 'over-limit' | 'unknown'
  model?: string
  inputTokens?: number
  maxInputTokens?: number
  measurement: 'exact' | 'estimated' | 'conservative' | 'incomplete'
  adaptations: readonly PreviewAdaptation[]
  warnings: readonly RequestWarning[]
  diagnostics: readonly RequestDiagnostic[]
}
```

Preview may resolve read-only sources, inspect Thread, reuse existing
artifacts, and call a provider counting endpoint. It does not generate
summaries, publish offloads, mutate Thread/Session, schedule maintenance, or
reserve an executable request.

Missing artifacts appear as unprepared prospective adaptations with
confidence. Runtime-only sources may produce incomplete measurement and
`status: 'unknown'`.

`RequestPreview` cannot be passed to execution.

### Executed request receipt

Every executed provider step exposes:

```ts
interface RequestReceipt {
  id: string
  model: string
  inputTokens: number
  maxInputTokens: number
  measurement: 'exact' | 'estimated' | 'conservative'
  adaptations: readonly RequestAdaptation[]
  warnings: readonly RequestWarning[]
  previousRequestId?: string

  inspect(): Promise<RequestInspection>
}
```

`adaptations` contains only deviations from full exact representations:
authored alternatives, summaries, offloads, and omissions. The common exact
request has `adaptations: []`.

The receipt is JSON-safe. `inspect()` is a non-enumerable/prototype-backed local
convenience. After serialization:

```ts
await inspectRequest(receiptOrRequestId)
```

returns the same full redacted evidence when retained.

Full inspection includes contribution identity/provenance, candidate
representations and rejection reasons, Thread revision, token breakdown,
fidelity decisions, summary/offload/cache/native-edit receipts, support
capabilities, measurement confidence, and linked requests.

Inspection is guaranteed while the live result exists. A bounded in-process
observation buffer supports recent standalone inspection. Cross-process durable
inspection depends on the existing observability retention pipeline; Crux does
not add another store. Expired evidence fails cleanly while the small receipt
remains useful.

### Failure

Pre-dispatch composition failures use one typed family:

```ts
class RequestCompositionError extends Error {
  code:
    | 'REQUEST_TOO_LARGE'
    | 'REPRESENTATION_UNAVAILABLE'
    | 'INVALID_COMPOSITION'
  diagnostics: readonly RequestDiagnostic[]
}
```

Messages include resolved model, minimum required versus available input,
largest required contributors, exhausted legal alternatives, concrete
remedies, and request/diagnostic identity. Sensitive content is redacted.

Expected preview fit failures return `status: 'over-limit'`; they do not throw.
Source-resolution and programming failures still throw.

## Conditional and per-step control

Input-only `when()` and `match()` predicates evaluate once at model-epoch start
and remain pinned:

```ts
when(enterpriseContext, input => input.plan === 'enterprise')
```

An explicit step argument opts into per-provider-call re-evaluation:

```ts
when(analysisContext, (input, step) => step.tools.called('search'))
```

Transport retries never re-evaluate predicates. Dynamic transitions are
receipted.

### Provider-step amendment

`prepareStep` belongs to Core's provider-neutral managed language-generation
loop:

```ts
const amendment = {
  use: {
    add: [analysisContext],
    remove: [rawResearch],
  },
  tools: {
    analyze,
  },
  activeTools: ['analyze'],
  model: reasoningModel,
  inputBudget: {
    optimizeAt: 120_000,
  },
} satisfies ExecutionAmendment
```

```ts
interface ExecutionAmendment {
  use?: {
    add?: readonly AmendableContextEntry[]
    remove?: readonly ContributorSelector[]
  }
  tools?: ToolSet
  activeTools?: readonly string[]
  model?: Model
  inputBudget?: InputBudget
}

type ContributorSelector =
  | AmendableContextEntry
  | { id: string }
```

`tools` contributes definitions for that boundary. Contexts, Skills,
ToolSources, and other added contributors bring owned Tools automatically.
`activeTools` selects names after the contributor graph resolves. Unknown names
fail before dispatch. Crux-required support capabilities remain active while
their feature is active.

`AmendableContextEntry` is the ordinary contributor union minus ownership
entries such as Thread and `history()`/`history.recent()`. Dynamic hooks cannot
switch transcript ownership or history policy. Those remain available in
definition-, invocation-, and static composition-stage `use`.

Removal uses the resolved top-level contributor identity. Passing the original
entry object is the simple path. `{ id }` targets an explicitly declared
contributor ID when code reconstructs entries dynamically; IDs must be unique
in the resolved graph. Removing the root identity of `prefer()`,
`summarizable()`, `offloadable()`, `droppable()`, or an atomic source array
removes the entire ladder/subtree. Selecting a nested representation or atomic
member is invalid.

Removal is idempotent: inactive removal is an observable no-op and duplicates
deduplicate. Add and remove of the same identity in one amendment is invalid.

Standalone `tools` resolve as one exact boundary-local synthetic contributor.
Name collisions with contributor-owned or Crux support Tools fail; there is no
last-wins shadowing. For each candidate, `activeTools` is applied after
capability resolution. A candidate that omits an explicitly selected Tool is
illegal. Required Crux support Tools remain active outside that filter.

Complete removal removes the contributor's subtree and capabilities atomically.
Protected instructions, constraints, guardrails, approval rules, and output
contracts reject removal unless the complete contributor is explicitly
`droppable()`.

`StepContext` is immutable and provider-neutral. It includes original input,
step index/reason, previous receipt, typed Tool history, steering/work-result
metadata, and relevant Thread/Session revision metadata. It never exposes raw
provider messages for replacement.

`prepareStep` is accepted by `generate()` and `stream()` across all managed
language adapters. An Agent may supply a reusable default; an invocation hook
overrides it. SDK-native adapters may lower to their native loop, but Core owns
semantics and validation.

Streaming fixes the request for the active provider call. Amendments affect
only a subsequent call.

Multimodal language-model input/results and structured output use the same
loop. Operation-specific iterative control for image generation, speech,
transcription, and embedding is outside this design.

## Invocation and composition control

Ordinary context control should not require a hook.

Stable definition context:

```ts
agent({
  prompt,
  use: [productDocs],
})
```

One direct invocation:

```ts
generate(prompt, {
  model,
  input,
  use: [requestContext],
})
```

One Pipeline Agent stage:

```ts
pipeline({
  steps: [{
    name: 'write',
    agent: writer,
    input: ctx => ({ research: ctx.research }),
    use: ctx => [writingContext(ctx.research)],
  }],
})
```

Swarms accept top-level shared `use`; Agent-specific context stays with each
Agent.

For dynamic cross-cutting composition control, `prepareInvocation()` runs
before a composition invokes one child executable:

```ts
pipeline({
  steps,
  prepareInvocation({ step, context }) {
    if (step.name !== 'write') return
    return {
      use: {
        add: [writingContext(context.research)],
      },
      model: writingModel,
    }
  },
})
```

The same concept applies to `swarm()`, `parallel()`, `consensus()`, routers, and
future compositions. Its immutable context is composition-specific and typed:
Pipeline stage plus accumulated context, Swarm Agent/hop/handoff history, or
branch/candidate metadata.

Two boundaries remain distinct:

```text
composition orchestration
└── prepareInvocation() for one child invocation
    └── managed language loop
        └── prepareStep() for one provider call
```

Both hooks return `ExecutionAmendment`. Amendments are boundary-scoped and
non-accumulating. Every boundary recomputes from definition and invocation
baselines. Persistent mutable behavior belongs to a future explicit
controller.

Layering is exact:

```text
definition use/tools
+ direct invocation use/tools
+ fresh prepareInvocation() amendment
= child-invocation baseline

child-invocation baseline
+ fresh prepareStep() amendment
= one provider-call candidate graph
```

The composition amendment therefore participates in every provider call made
by that child invocation. Step amendments never leak into later calls; they are
recomputed against the same child baseline.

Pipeline function-only stages do not receive provider hooks. `input(ctx)`
remains the simple typed data-flow API.

Composition results retain a tree of linked child request receipts rather than
flattening causality.

## Capability semantics

Contributors separate model-facing representations from owned application
capabilities.

- Capability ownership is fixed before ladder construction. `prefer()` uses
  the primary source's set; an atomic source array uses the union of canonical
  members.
- Authored alternatives cannot add, remove, or replace owned capabilities.
- `prefer()`, `summarizable()`, and `offloadable()` change representations while
  preserving Tools, Skills, constraints, guardrails, and approvals.
- `droppable()` and explicit complete removal authorize omission of the whole
  contributor and its owned capabilities.
- Protected behavioral contracts cannot be removed without explicit
  droppability.
- Dynamically contributed Tools pass normal ownership, collision, approval,
  middleware, guardrail, constraint, budget, and observability validation.
- Tool schemas are exact contracts. Staged loading/search requires an explicit
  ToolSource contract; the planner never summarizes executable schemas.
- Crux-owned support Tools are required and budgeted. If they cannot fit, the
  representation requiring them is unavailable or the request fails.

## Caching and provider-native lowering

These caches remain distinct:

- provider prompt caching;
- source-resolution/retrieval memoization;
- content-addressed derived summary/offload artifacts; and
- exact sealed-request reuse for transport retries.

Existing provider caching remains intact: Context cache hints, prompt-owned
provider cache configuration, Anthropic breakpoints, Google CachedContent,
AI SDK lowering, and OpenAI stable-prefix behavior. No new universal cache API
is introduced.

Adapters may automatically use provider-native compaction/context editing when
semantically compatible. Native continuation IDs, compacted blocks, and edit
receipts are provider sidecars. Switching providers/models replans from
canonical sources.

Native lowering must preserve exact contracts, causal groups, and all
adaptation evidence. It is disableable through the owning source policy, such
as `history({ providerNative: false })`.

## Multimodality and structured output

Canonical Thread/messages preserve text, images, audio, video, files, Tool
lifecycle parts, and supported reasoning metadata.

Planning is modality-aware:

- adapters measure media and provider-envelope costs;
- deterministic offload previews preserve modality where supported;
- media never silently becomes generated text;
- generated captions/summaries are explicit `summarizable()` adaptations;
- structured-output schemas remain exact and budgeted; and
- an offload rung is unavailable when the call cannot expose exact retrieval.

Crux never weakens a structured-output contract or adds a hidden preparatory
model call to make the current request fit.

## Development and production behavior

Development fallbacks must predict production:

- bare Thread approaching overflow warns before failure;
- managed history without defer retention warns about future inline latency;
- missing durable backing makes durable offload rungs unavailable;
- estimated/conservative counting is explicit;
- unavailable full inspection explains observability retention requirements;
  and
- process-local state used with durable execution warns that it is not
  replay-safe.

Warnings never authorize loss. Production uses the same request-composition
semantics.

## Compatibility and supersession

Crux is pre-launch. Remove these public APIs instead of maintaining duplicate
concepts:

- stateful MemoryBlock `recentMessages()`;
- stateless history-projection `recentMessages()`;
- `createSlidingWindow()`;
- `createBudgetManager()`;
- `summarizeMessages()`;
- `compactConversation()`;
- narrow resolver `tokenBudget`; and
- `prompt.inspect()`.

Replacements:

```text
history.recent()
history()
summarizable()
inputBudget
preview()
RequestReceipt inspection
```

The history transition is explicit:

| Previous contract | Current contract |
| --- | --- |
| bare Thread implicitly projected ten recent messages | bare Thread is complete, exact history |
| stateless `recentMessages()` | `history.recent()` |
| stateful MemoryBlock `recentMessages()` | removed; Thread owns canonical history |
| call-site messages over Prompt-level messages over Thread | unchanged |
| automatic Prompt exchange commits to an unshadowed Thread | unchanged |
| manual messages shadow Thread and never infer a commit | unchanged |
| causal-group-safe soft caps and leading system-prefix preservation | retained by `history.recent()` |

Migration documentation should explain semantic ownership changes, not only
renames. Low-level extension uses the new summary-strategy and representation
source contracts so it participates in artifact identity, scheduling,
measurement, and receipts.

The existing public `plan()` task-list primitive is unrelated and remains
unchanged. Public request evidence therefore does not use `plan` vocabulary.

## Validation and testing

Implementation planning should include:

1. exact-by-default failures for oversized required content;
2. type and runtime tests for every legal/illegal ladder composition;
3. whole-request accounting across context, messages, Tools, schemas, media,
   overhead, and output reserve;
4. exact/estimated/conservative counting paths;
5. optimize/max hysteresis and monotonic fidelity across Tool loops;
6. new epoch behavior for model/input-budget changes;
7. network retry reuse and one semantic overflow recovery;
8. causal-group-safe history selection;
9. managed summary preparation, identity, deduplication, invalidation, and miss
   behavior;
10. manual-message history artifact identity and no-commit behavior;
11. offload atomic publication, access control, lifetime, deletion, and
    provider-native lowering;
12. structured-output/Tool-less incompatibility handling;
13. sticky versus completely removed capabilities;
14. dynamic Context/Skill/ToolSource and standalone Tool contribution;
15. `activeTools` validation and required support Tools;
16. `when()` epoch pinning and step-aware re-evaluation;
17. non-accumulating `prepareStep`/`prepareInvocation` behavior;
18. identical generate/stream semantics across SDK-native and Core-owned loops;
19. Pipeline/Swarm child receipt trees;
20. preview side-effect boundaries and tri-state status;
21. receipt serialization and local/durable inspection retention;
22. predictive development diagnostics; and
23. adapter/provider switching from canonical sources.

Tests should cover text, structured, Tool-heavy, and multimodal requests across
AI SDK, OpenAI, Anthropic, and Google adapter paths.

## Deferred work

The following remain separate designs:

- stateful reusable context/Agent controllers;
- Session-owned repeated invocation and steering;
- composition-specific controller state and recovery;
- provider-hosted Thread synchronization;
- explicit cross-owner offload sharing;
- semantic search as an offload requirement;
- summary presets beyond the approved strategy family;
- arbitrary raw transcript assembly; and
- modality-specific iterative controllers for non-language generation.

These extensions must reuse canonical sources, constrained amendments,
whole-request planning, and request receipts defined here.
