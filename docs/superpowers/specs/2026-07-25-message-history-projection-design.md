# Message History Projection Design

Status: **proposed**

Related designs:

- [Canonical Thread](./2026-07-24-thread-design.md)
- [Joinable Background Work](./2026-07-23-joinable-background-work-design.md)
- existing canonical `Message`, prompt composition, adapter transcript, Storage,
  and observability contracts

## Summary

Crux should have one simple conversation path:

```ts
const conversation = thread({
  id: `conversation:${conversationId}`,
})

const chat = prompt({
  use: [
    conversation,
    recentMessages({ maxMessages: 12 }),
  ],
  system: 'Be helpful.',
  prompt: ({ input }) => input.message,
})
```

Supplying a Thread through `use` binds conversation ownership for the managed
invocation. Crux reads its selected history, applies `recentMessages()` when
present, adds the new prompt, invokes the model and Tool loop, and atomically
commits the accepted exchange back to the same Thread.

`recentMessages()` is a stateless history projection. It never owns a second
rolling transcript, captures no turns, and renders no lossy system-text
summary:

```ts
interface RecentMessagesOptions {
  readonly maxMessages?: number
}

function recentMessages(
  options?: RecentMessagesOptions,
): MessageHistoryProjection
```

The other public mode is deliberately manual:

```ts
const messages = [
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi!' },
  { role: 'user', content: 'Continue.' },
] satisfies Message[]
```

`messages` always means a complete caller-owned conversation transcript. It
overrides automatic Thread history and prompt-message assembly for that
invocation. Configured system/context instructions and non-history capabilities
still compose normally. Crux may project the conversation transcript through
`recentMessages()`, but never infers a durable append from it and never mutates
a shadowed Thread.

The public mental model is therefore:

```text
prompt    one new turn; Thread composition and commit are automatic
messages  one complete conversation transcript; the caller owns it
```

Thread trees, causal-group preservation, source precedence, identity,
idempotent publication, and model-provider translation remain internal.

## Why the current model must change

The existing `recentMessages()` is a stateful Memory block. It stores a
text-only rolling copy in `RecordStore`, captures turns after execution, and
later renders those copies as system text. That creates a second, weaker
transcript beside explicit messages and the future canonical Thread.

The current capture path can also receive a complete supplied history and add
past user messages again on subsequent calls. More generally, a private rolling
copy cannot remain correct as the canonical transcript gains:

- multimodal content;
- Tool calls and correlated Tool results;
- immutable edits and alternative paths;
- message redaction and Thread deletion;
- provider continuation sidecars; and
- concurrent Session positions.

Deduplication cannot repair the ownership problem. Synchronizing two transcript
stores would make redaction, branching, retry identity, and causal validity
more complex while still leaving one copy lossy.

`recentMessages()` should select from conversation truth, not attempt to own
another version of it.

## Product principles

1. **The common path should explain itself.** Put a Thread and optionally
   `recentMessages()` in `use`; Crux handles the conversation.
2. **One transcript has one owner.** Thread owns Crux-managed history. A
   `messages` array is caller-owned. `recentMessages()` owns neither.
3. **`prompt` and `messages` are different modes.** `prompt` contributes a new
   turn. `messages` supplies the whole model transcript.
4. **Never merge competing histories implicitly.** Source selection is
   deterministic and observable.
5. **Never infer persistence from an arbitrary transcript.** Automatic Thread
   commits occur only when Crux can identify the new prompt and generated
   exchange structurally.
6. **Preserve protocol validity.** A recent window never separates a Tool call,
   its results, and the resulting continuation.
7. **Manual control stays available.** Users can supply a complete transcript
   or call standalone Thread methods without adopting automatic conversation
   ownership.
8. **Successful means published.** A Thread-bound invocation does not report
   ordinary success until its accepted exchange is committed.
9. **Canonical messages remain multimodal.** Projection never flattens messages
   into prose.
10. **Advanced transcript assembly belongs elsewhere.** A later step-level
    context-composition design may expose controlled render pipelines without
    complicating the standard API.

## Goals

V1 should provide:

- direct Thread participation in `use`;
- direct `recentMessages()` participation in `use`;
- one active Thread and one active recent-history policy per invocation;
- deterministic selection between manual messages and Thread history;
- a group-safe recent-message soft cap;
- leading system-directive preservation;
- complete canonical multimodal projection;
- automatic managed-invocation Thread publication;
- strict commit-before-success behavior;
- an optional `threadCommit` result receipt;
- clear manual-mode diagnostics when a Thread is shadowed;
- source and projection observability;
- Project Index and Devtools representation; and
- removal of the hidden rolling recent-message store.

## Non-goals

This design does not define:

- transcript summarization or compaction;
- token-budget arbitration between transcript, Memory, retrieval, tools, and
  system context;
- step-specific or arbitrary transcript assembly;
- durable Session input transactions or Session-owned positions;
- provider-hosted Thread synchronization;
- live Thread subscriptions;
- automatic Memory extraction from projected history;
- cross-Thread copying or merging;
- a second rolling short-term-memory primitive; or
- automatic persistence of arbitrary caller-authored complete transcripts.

## Terminology

### Automatic conversation mode

A managed invocation whose prompt contributes one new user message and whose
active history source may be a Thread. When a Thread is active, Crux owns the
read, projection, execution, and commit sequence.

### Manual transcript mode

An invocation supplied with `messages`, either at the call site or by the
prompt's complete-transcript content mode. The supplied value is the complete
conversation transcript. Crux does not infer which entries are new. Resolved
system instructions and non-history capabilities remain orthogonal and still
apply.

### History source

The canonical message sequence considered for recent-history projection before
automatic prompt contribution. It is either a caller-owned transcript, a
Thread path, or empty.

### History projection

A stateless policy that selects which canonical history messages enter a model
invocation. It does not modify conversation truth.

### Causal group

The indivisible message group defined by the Thread design. It keeps correlated
Tool lifecycle messages and their resulting continuation together.

### Leading system prefix

The contiguous system-role prefix at the beginning of a selected transcript.
It is treated as invocation directives rather than conversational history.

## Public API

### Thread as a `use` entry

The existing inert Thread handle becomes a valid prompt contributor:

```ts
interface Thread extends ContextEntry {
  readonly id: string

  // Existing standalone Thread methods remain available.
}
```

This adds execution binding semantics without adding execution methods to the
Thread itself:

```ts
const conversation = thread({
  id: `support:${ticketId}`,
})

const answer = prompt({
  use: [conversation],
  prompt: ({ input }) => input.question,
})
```

Constructing the Thread remains inert. `resolve()` and `inspect()` remain
read-only. Only managed execution may publish an automatic exchange.

Exactly one Thread may be active after conditional and nested `use` resolution.
If two are active, resolution rejects with a targeted error that names both
contribution sources. Array order never selects a winner.

### `recentMessages()`

The public factory is:

```ts
interface RecentMessagesOptions {
  /**
   * Soft maximum for selected conversational messages.
   *
   * Complete causal groups may cause the result to exceed this number.
   *
   * @default 10
   */
  readonly maxMessages?: number
}

interface MessageHistoryProjection extends ContextEntry {
  readonly kind: 'recentMessages'
  readonly maxMessages: number
}

function recentMessages(
  options?: RecentMessagesOptions,
): MessageHistoryProjection
```

Example:

```ts
const chat = prompt({
  use: [
    conversation,
    recentMessages(),
  ],
  prompt: ({ input }) => input.message,
})
```

The primitive:

- has no `id`;
- has no `priority`;
- owns no Storage records;
- exposes no `addTurn()`, `list()`, or `clear()`;
- captures nothing after an invocation;
- injects no system-text block; and
- preserves canonical messages and content parts.

When a Thread is active and no explicit transcript projection is present, Core
applies an implicit bounded default equivalent to:

```ts
recentMessages({ maxMessages: 10 })
```

An explicit `recentMessages()` replaces that implicit default. The implicit
policy is visible in resolution, observability, and Devtools; it is not a
second active contributor and does not cause the duplicate-policy error.
Thread binding therefore remains safe and useful by itself:

```ts
const chat = prompt({
  use: [conversation],
  prompt: ({ input }) => input.message,
})
```

It should be exported from the ordinary `@use-crux/core` composition surface,
not presented as a Memory store. Package organization may retain an internal
projection module, but users should not need a separate memory configuration
to limit conversation history.

Exactly one `recentMessages()` policy may be active after conditional and
nested `use` resolution. Multiple active policies reject with an error naming
their contribution sources. Crux does not use last-wins or minimum-limit
merging.

### Prompt content

The standard `prompt` content mode remains the automatic path:

```ts
const chat = prompt({
  system: 'Be concise.',
  prompt: ({ input }) => input.message,
})
```

The prompt field should accept canonical user content from the beginning:

```ts
type PromptFieldResult = string | MessageContent
```

This keeps multimodality inside the simple mode:

```ts
const inspectImage = prompt({
  prompt: ({ input }) => [
    {
      type: 'text',
      text: input.question,
    },
    {
      type: 'image',
      source: input.image,
    },
  ],
})
```

Crux canonicalizes the resolved value as one new user message. That message,
accepted model messages, and accepted Tool lifecycle messages form the
automatic exchange eligible for Thread publication.

The existing prompt-level `messages` content mode remains a complete transcript
escape hatch:

```ts
const manual = prompt({
  messages: ({ input }) => [
    {
      role: 'system',
      content: 'Answer carefully.',
    },
    {
      role: 'user',
      content: input.question,
    },
  ],
})
```

It does not gain history, turn, examples, preamble, persistence-marker, or
transcript-builder parameters in this design.

### Managed call-site `messages`

Call-site `messages` has the same complete-transcript meaning:

```ts
await generate(chat, {
  model,
  input,
  messages,
})
```

When present, it is the complete conversation transcript for that invocation.
The resolved `prompt` content is not appended. This matches the familiar rule
that one supplies either a prompt or a messages transcript to a model call.

Call-site `messages` takes precedence over prompt-level `messages` because it is
the more local explicit override. No two arrays are merged.

Manual conversation ownership does not suppress the rest of prompt
composition:

- resolved prompt/context system instructions still enter the ordinary system
  channel;
- tools, constraints, guardrails, settings, and other non-history `use`
  capabilities still apply;
- system-role entries explicitly present inside `messages` remain in the
  caller-owned transcript; and
- Crux neither removes those entries nor treats them as replacements for
  separately configured system contributions.

The adapter owns its normal provider-specific translation of the resolved
system channel plus canonical conversation messages. `messages` is complete
conversation input, not an escape from configured prompt policy.

## Source selection

Each invocation selects one source:

```text
call-site messages
        |
        v
prompt-level messages
        |
        v
Thread selected path
        |
        v
empty history
```

The first available source wins.

The selected source determines the execution mode:

| Selected source | Prompt appended | Thread read | Automatic Thread commit |
| --- | --- | --- | --- |
| call-site `messages` | no | no | no |
| prompt-level `messages` | no | no | no |
| Thread path | yes | yes | yes |
| empty | yes | no | no |

This table describes source ownership, not hidden precedence users must manage
in the common path. A standard Thread-backed prompt contains neither messages
override and therefore follows the obvious automatic row.

If a Thread contributor is present but manual messages win:

- the Thread is not read for model history;
- the Thread is not mutated;
- `threadCommit` is absent;
- development emits one focused diagnostic explaining that the complete
  transcript shadowed automatic Thread ownership;
- observability records the shadowing in every environment; and
- production behavior is the same rather than unexpectedly becoming durable.

This is an intentional per-invocation escape hatch. It never copies a manual
transcript into the Thread.

When no history source exists, the history is simply empty. This is normal for
first-turn and one-shot invocations, so Crux emits no warning. Observability
records `source: 'none'` and zero selected messages.

## Projection semantics

### Ordering

Projection preserves canonical chronological order. It never reorders selected
messages, moves Tool results, or mixes alternative Thread paths.

### Soft cap

`maxMessages` is a soft cap:

1. Separate the leading causal groups composed entirely of contiguous
   system-role messages.
2. Partition the remaining transcript into causal groups.
3. Select the newest complete groups whose total conversational message count
   fits the limit.
4. If the newest indivisible group alone exceeds the limit, include the whole
   group.
5. Restore the leading system prefix before the selected conversation suffix.

The result may therefore contain more than `maxMessages` total entries. The
cap protects causal correctness rather than promising an unsafe array length.

In automatic conversation mode, the new prompt and messages generated during
the current invocation are added after projection and do not count toward
`maxMessages`.

In manual transcript mode, the supplied transcript is already complete. Its
newest complete or valid open terminal group participates in selection like
the rest of the manual transcript. Crux does not attempt to label one supplied
entry as the current prompt.

### Leading system prefix

A contiguous leading system-role prefix is retained outside the conversational
soft cap only at whole causal-group boundaries. This supports ordinary
SDK-style complete transcripts without dropping their directives or violating
Thread atomicity.

If one causal group crosses from leading system messages into conversational
messages, the entire group remains in the ordinary window and counts toward
`maxMessages`. It may exceed the soft cap as one indivisible group. Prefix
preservation never splits an authoritative Thread group, and Crux does not
forbid an otherwise valid mixed group merely to simplify projection.

A system-role message later in the conversation remains at its causal position
and participates in ordinary group-safe selection. Crux does not keep every
historical system-role message forever.

Agent, prompt, and context system instructions remain separate resolved system
contributions. Projection does not duplicate them into history.

### Group boundaries

Thread causal-group metadata is authoritative for Thread history.

For manual canonical messages, Core derives equivalent protocol groups using
the same provider-neutral transcript validator and Tool-call correlation used
by managed adapters. The grouping algorithm is deterministic:

1. After the leading system-only prefix, one or more consecutive user messages
   begin an interaction group.
2. Following assistant messages, Tool calls, correlated Tool results, and
   assistant continuations remain in that interaction.
3. The next independent user input begins the next group.
4. A later system message begins a new directive-and-interaction group and
   remains with the user/assistant exchange that follows it.
5. Multiple assistant messages before the next independent input remain in the
   same group.
6. A terminal user input without a response is one valid open final group.
7. A transcript beginning with an assistant or Tool continuation treats that
   continuation as one initial group through the next independent input
   boundary.
8. Tool-call dependency closure is authoritative: if a proposed boundary would
   separate a call from its result or resulting continuation, Core merges the
   adjacent groups.

A malformed Tool lifecycle, impossible role sequence, or dependency that
cannot be made complete rejects with a targeted transcript error rather than
being silently repaired.

Adapter-native message inputs must be normalized to canonical messages before
projection. Provider-specific arrays are not an alternate projection model.

### Provider continuation coverage

Provider continuation sidecars are optimizations over canonical history, not a
second history source. An adapter may use one only when its covered canonical
history is exactly equivalent to the history selected for the invocation.

If projection omitted, redacted, compacted, reordered, or otherwise changed
any history covered by a continuation sidecar, Core must bypass that sidecar
and rebuild the provider request from the projected canonical messages.
Configuring `recentMessages()` does not itself disable continuation when the
complete covered history still fits and nothing was removed.

An adapter may use a provider-specific truncation facility only when the
adapter can prove that it produces the same selected-history semantics. It
must otherwise prefer the portable canonical request. Observability records
whether provider continuation was used or bypassed and the normalized reason.
No opaque provider reference may silently reintroduce context excluded by
Crux's projection.

### Redaction and deletion

A redacted Thread entry never enters model projection. If redaction makes a
causal group incomplete, the entire affected group is unavailable to the
model. Later complete groups may still be selected.

Projection counts model-visible entries, reports excluded redacted groups in
authorized observability, and never turns a redaction tombstone into prose.

A deleted Thread produces the terminal deleted outcome defined by the Thread
contract. It does not degrade to empty history.

## Automatic Thread execution

### Read and prepare

A managed automatic invocation:

1. resolves `use`;
2. verifies that at most one Thread and one recent-history policy are active;
3. reads the Thread position and revision required by the Thread append
   contract;
4. obtains the complete current-path canonical history;
5. applies `recentMessages()` when present;
6. resolves system/context contributions and the new prompt;
7. assembles provider input without mutating the Thread; and
8. invokes the selected adapter and managed Tool loop.

Without an explicit projection, Core applies the observable implicit
`recentMessages({ maxMessages: 10 })` default. It never sends the unbounded
Thread path merely because the user omitted a policy. A future compaction or
context-pressure design may define another safe explicit projection, but must
amend this contract rather than silently changing it.

### Commit set

After an accepted completion, Crux publishes one causal group containing:

- the canonical new user message produced by `prompt`;
- accepted assistant messages;
- accepted Tool calls and their correlated results;
- the accepted final assistant continuation; and
- provider continuation sidecars covered by the Thread contract.

It does not publish:

- Thread history that was read;
- system/context instructions;
- messages excluded by projection;
- retry feedback or rejected validation attempts;
- rejected guardrail output;
- transient provider deltas;
- typed structured-result objects as duplicate message content; or
- manual transcripts that shadowed the Thread.

Structured results follow the Thread design: canonical model messages remain
conversation truth, while the parsed typed result remains linked execution
evidence.

### Accepted completion

An accepted completion must satisfy all of the following:

- the managed invocation produced a terminal result rather than throwing or
  being aborted;
- structural validation, semantic constraints, and enforcing output
  guardrails accepted the result; and
- the canonical exchange is causally closed, with no unresolved Tool call or
  partial Tool lifecycle.

The publication decision is:

- an ordinary stop commits;
- a length or content-filter finish commits only when the adapter produced a
  structurally complete accepted assistant outcome, preserving its normalized
  finish reason;
- a Tool failure represented canonically as a Tool result may commit when the
  loop subsequently produces an accepted assistant continuation;
- reaching `maxSteps` with a pending Tool call rejects as an incomplete
  exchange and commits nothing;
- abort or cancellation commits nothing;
- provider failure or an unhandled Tool failure commits nothing;
- structural-validation or semantic-constraint exhaustion commits nothing;
- enforcing guardrail rejection commits nothing; and
- failure after earlier successful internal steps still commits nothing.

One ordinary invocation exchange is atomic. Crux does not publish a completed
prefix after the overall invocation fails. Rejected attempts and partial
progress remain execution/observability evidence only. A later durable Session
design may persist accepted input and failure events under its distinct
transactional contract.

### Success boundary

For a non-streaming invocation, successful Thread publication is part of
ordinary invocation success:

1. accepted model execution completes;
2. Core attempts the idempotent Thread commit;
3. transient publication failures retry within the configured policy;
4. success returns the model result and receipt; and
5. exhausted publication failure rejects with `ThreadCommitError`.

Crux never returns an apparently ordinary success with silently missing
history.

The automatic commit uses stable operation and message identities so retrying
publication cannot duplicate the exchange. Thread conflict handling follows
the Thread contract: a concurrent continuation may commit as a durable
alternative rather than rebasing against context the model never saw.

### Streaming

Streamed provider output remains provisional until the terminal result commits.
Consumers may already have observed deltas, so publication cannot retroactively
make delivery atomic.

The existing managed stream surface remains authoritative:

```ts
const stream = await adapter.stream(chat, options)

for await (const delta of stream.textStream) {
  // Provisional output.
}

const completed = await stream.completion
completed.threadCommit
```

The immediate `StreamResult` never exposes `threadCommit`. The existing
`StreamResult.completion` promise is the final completion envelope and must:

- resolve only after publication succeeds;
- include the Thread receipt;
- reject with `ThreadCommitError` if publication exhausts retries; and
- record that provider output may already have been observed.

Awaiting `completion` must be sufficient to drive or drain managed completion
even when the caller does not iterate `textStream`.

An explicit abort or cancellation before terminal completion publishes nothing
and rejects `completion`. Ending the managed async iterator early is
cancellation, not successful completion. Provider, Tool, validation, or
publication failure rejects `completion`; iteration also throws when the
failure is observable through that consumer. Deltas delivered before any such
failure remain provisional and are reported in normalized error evidence and
observability.

Applications requiring crash-resumable execution and coordinated delivery
should use the future durable Session contract. A normal Thread-bound stream
provides persistent successful history, not durable execution.

## Result contract

Managed non-streaming generation results and streaming completion envelopes
gain one optional field:

```ts
interface ThreadBoundResult {
  readonly threadCommit?: ThreadCommit
}
```

It is present only after an automatic Thread commit:

```ts
const result = await generate(chat, {
  model,
  input,
})

result.threadCommit
// {
//   id: '...',
//   status: 'selected' | 'alternative',
//   ...
// }
```

The field uses the ordinary Thread receipt rather than inventing a second
execution-specific receipt. Most users can ignore it. It remains necessary for
callers that need to distinguish the selected continuation from a concurrent
alternative.

Manual transcript mode, unbound prompts, and failed publication do not return a
successful `threadCommit`.

## Errors and diagnostics

### Configuration errors

Core should provide targeted errors for:

- multiple active Threads;
- multiple active `recentMessages()` policies;
- a non-positive, non-finite, or non-integer `maxMessages`;
- canonical messages that cannot form a provider-valid projection;
- use of an adapter that cannot normalize the supplied message dialect; and
- Thread capability failures already defined by the Thread contract.

Messages should name the contributing prompt/context paths when conflicts came
through nested `use`.

### Manual shadowing diagnostic

When a complete transcript shadows a Thread, development diagnostics should
say, in substance:

> `messages` supplies the complete conversation transcript for this invocation,
> so Thread `support:…` was not read or updated. Remove `messages` to use
> automatic Thread history, or append to the Thread explicitly.

The emitted Thread identifier follows the Thread diagnostic-privacy contract:
stable scoped fingerprint by default, raw IDs only under explicit diagnostic
policy.

This is a warning rather than an error because manual per-invocation override
is an intentional control surface. It must also appear in observability so
production does not silently differ from development.

### Publication failure

`ThreadCommitError` should include:

- a stable operation ID;
- the scoped Thread diagnostic identity;
- whether provider/model execution completed;
- whether any stream deltas may have been delivered;
- the final retry classification;
- the underlying normalized Storage cause; and
- concise remediation distinguishing transient Storage failure from missing
  durable capability.

The error does not claim that the exchange is present in Thread.

## Observability and Devtools

Every managed invocation should record:

- selected source: `call.messages`, `prompt.messages`, `thread`, or `none`;
- active Thread diagnostic identity, when present;
- whether that Thread was used or shadowed;
- selected Thread position or authorized commit correlation;
- history message and causal-group counts before and after projection;
- leading system-prefix count;
- configured soft cap;
- groups retained, excluded, or unavailable through redaction;
- final provider-message count;
- provider continuation used or bypassed, with reason;
- automatic versus manual mode;
- commit attempt count and duration;
- selected versus alternative commit status; and
- terminal publication failure.

Devtools should visualize:

```text
source -> projection -> prompt assembly -> provider transcript -> commit
```

It should show canonical message structure rather than only rendered prose.
Sensitive content and identifiers continue to follow existing redaction and
diagnostic-privacy policy.

The Project Index should recognize Thread and `recentMessages()` contributors,
show their source locations, and report statically obvious duplicate
contributors where possible. Runtime validation remains authoritative for
conditional composition.

## Memory boundary

The ownership model is:

```text
Thread                 canonical conversation truth
manual messages        caller-owned complete conversation transcript
recentMessages()       stateless transcript selection
Memory                 learned facts, episodes, procedures, and working state
compaction              future read-side compression
context budgeting      future cross-contributor pressure policy
Session                 future durable position and activation ownership
```

Memory capture may observe an accepted exchange for fact or episode extraction,
but it must not recreate a rolling transcript under another block. Redaction
and deletion propagation remain grounded in Thread identities and registered
derived artifacts.

## Compatibility and migration

This is an intentional pre-launch correction.

The implementation should:

1. remove storage ownership from `recentMessages()`;
2. remove its required `id`, `priority`, `addTurn()`, `list()`, and `clear()`;
3. remove automatic recent-message turn capture;
4. stop rendering recent history as a system-text Memory block;
5. add Thread and message-history projection lowering to `use`;
6. make prompt content accept canonical multimodal user content;
7. add strict automatic Thread publication to managed adapters;
8. expose `threadCommit` on successful bound results;
9. update Memory docs to distinguish conversation history from learned Memory;
   and
10. provide focused migration diagnostics for stale `recentMessages({ id,
    priority })` configuration.

Crux should not retain the old rolling store under the same name. If a concrete
future use case requires a deliberately lossy rolling note, it should receive a
different name and contract rather than masquerading as canonical conversation
history.

## Testing strategy

### Type tests

Verify:

- Thread and `recentMessages()` are valid `use` entries;
- `recentMessages()` needs no `id`;
- `maxMessages` inference remains literal-friendly;
- `prompt` accepts text and canonical multimodal user content;
- managed results expose optional `threadCommit`;
- manual messages remain canonical and provider-neutral; and
- removed stateful block methods are unavailable.

### Projection tests

Cover:

- no source;
- empty Thread;
- implicit ten-message Thread projection without an explicit policy;
- exact soft-cap boundaries;
- one group exceeding the cap;
- several Tool calls and results in one group;
- a valid open terminal manual group;
- leading system-prefix retention;
- later system-message treatment;
- canonical multimodal messages;
- redacted and unavailable groups;
- malformed Tool correlation;
- explicit messages shadowing Thread; and
- prompt-level versus call-site messages precedence.

### Composition tests

Cover:

- one direct Thread;
- one nested Thread;
- conditional Thread activation;
- duplicate active Threads;
- one direct recent policy;
- one nested recent policy;
- mutually exclusive conditional recent policies;
- duplicate active policies; and
- source labels in conflict errors.

### Publication tests

Cover:

- successful user/assistant commit;
- complete Tool-loop group commit;
- structured output linkage without duplicate message content;
- rejected validation and guardrail attempts not being committed;
- transient commit retry;
- exact publication replay;
- exhausted `ThreadCommitError`;
- selected and alternative concurrent commits;
- manual-mode no-op publication;
- no partial user-only group;
- stream final-result success after commit; and
- stream terminal failure after provisional deltas.

### Adapter conformance

Every managed provider adapter should prove:

- canonical history enters provider translation in order;
- native transcript shapes normalize before projection;
- Tool lifecycle groups survive round trips;
- multimodal content survives supported conversions;
- the current prompt is not duplicated;
- manual messages suppress automatic prompt assembly;
- publication receives accepted canonical output only; and
- provider continuation sidecars remain compatible with projected Thread
  history.

### Failure-injection tests

Inject failure:

- before Thread read;
- after Thread read but before provider call;
- during provider execution;
- after accepted provider completion but before commit;
- during atomic publication;
- after an ambiguous Storage acknowledgement;
- during a streamed final commit; and
- during concurrent alternative publication.

No case may expose a partial causal group or an ordinary success without the
promised commit.

## Acceptance criteria

The design is satisfied when:

1. A Thread in `use` automatically supplies and receives conversation history
   for standard `prompt` invocations.
2. `recentMessages()` is a stateless, group-safe projection over the selected
   canonical source.
3. No hidden rolling transcript is stored.
4. `messages` consistently means a complete caller-owned conversation
   transcript while configured system and non-history capabilities still
   apply.
5. Manual messages never mutate a shadowed Thread.
6. One active Thread and one active recent policy are enforced explicitly.
7. Canonical multimodal and Tool lifecycle content remain intact.
8. A bound invocation succeeds only after its exchange commits.
9. Successful results expose the ordinary optional `threadCommit` receipt.
10. Development diagnostics and production observability make source
    selection, shadowing, degradation, and publication visible.

## Follow-up designs

The next design should define transcript compaction and its boundary with
broader context-pressure management. It should treat Thread and manual messages
as read-side sources and must not reintroduce transcript ownership into Memory.

After compaction, the Session design should define:

- Session-owned Thread positions;
- atomic accepted-input and Thread-output publication;
- activation retries and versioning;
- Session history/result views; and
- the relationship between Session input projection and ordinary prompt-mode
  Thread binding.

Advanced arbitrary transcript assembly should be considered only as part of
the later step-level context-control design, where render-only and durable
provenance can be explicit without burdening the standard prompt API.
