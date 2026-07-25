# Canonical Thread Design

Status: **proposed**

Related designs:

- [Standalone Signals](./2026-07-23-standalone-signals-design.md)
- [Joinable Background Work](./2026-07-23-joinable-background-work-design.md)
- existing canonical `Message`, content persistence, Storage, Memory, and
  Runtime Engine contracts

## Summary

Crux should provide a standalone `thread()` primitive that owns canonical,
durable conversational history without requiring an Agent, Session, hosted
Crux service, or provider-specific thread API.

```ts
const conversation = thread({
  id: `conversation:${conversationId}`,
})

await conversation.append({
  role: 'user',
  content: 'Explain the trade-offs.',
})

const { messages } = await conversation.read()
```

A Thread is deliberately narrow. It owns an immutable tree of normalized Crux
messages and one selected path for standalone use. It does not own arbitrary
conversation metadata, an Agent loop, pending work, Signal delivery, long-term
memory, context selection, or typed activation results.

Ordinary conversation history is linear. Editing or regenerating creates an
alternative immutable continuation within the same Thread:

```text
U1 -> A1 -> U2  -> A2
          \-> U2' -> A2'
```

The public API presents a familiar current conversation. Tree structure,
causal message groups, storage publication, provider continuation state, and
concurrent Session positions remain internal until an advanced operation needs
them.

```ts
await conversation.edit(userMessage.id, {
  content: 'The corrected question',
})

await conversation.select(alternativeMessage.id)

const exactPrefix = await conversation.read({
  at: earlierMessage.id,
})
```

Thread messages use Crux's provider-neutral canonical `Message` format.
Adapters translate SDK-native messages at execution boundaries and may preserve
opaque provider continuation data beside the canonical message. Canonical
messages are always the portable source of truth.

Thread uses the standard configured Storage capability. Users do not configure
a Thread-specific store. Core owns one correct generic implementation over an
atomic `RecordStore` plus `AssetStore`; storage adapters may provide invisible
optimized paths with identical semantics.

## Product principles

1. **The common path is dead simple.** Create a handle, append, read, edit, or
   select.
2. **Complexity belongs behind the primitive.** Trees, causal groups, atomic
   visibility, continuation sidecars, and Session positions are internal
   machinery.
3. **Thread is conversation truth, not all memory.** It records what was said;
   Memory derives what should be remembered.
4. **Canonical first, provider fidelity preserved.** Every message has a
   portable Crux representation. Provider-native continuation state is an
   optional sidecar, never the only history.
5. **Messages are immutable; selection is mutable.** Edit and regeneration add
   alternatives instead of rewriting history.
6. **Identity carries retry safety.** Replaying the same message identity and
   canonical write is idempotent; conflicting reuse rejects.
7. **Atomic groups preserve lifecycle validity.** Tool calls, results, and the
   resulting assistant continuation cannot become partially visible.
8. **Multimodality is foundational.** Durable text, images, audio, video,
   files, tool lifecycle content, and persistable reasoning are supported from
   the beginning.
9. **Structured results remain typed results.** They are linked to Thread
   messages, not embedded as a second version of conversation truth.
10. **Configure infrastructure once.** Standard Storage and Runtime composers
    provide capabilities; users never register persistence separately for each
    primitive.
11. **Fallbacks predict production.** Development may use an explicitly noisy
    in-memory fallback. Production never silently loses durable history.
12. **Progressive adoption is normal.** Thread works standalone. Runtime,
    Session, Memory, compaction, and framework bindings compose later.

## Goals

V1 should support:

- inert Thread handles with stable application-owned or generated IDs;
- canonical provider-neutral messages;
- full multimodal content persistence;
- atomic single-message and causal-batch append;
- stable message identity and retry-safe replay;
- complete current-path reads and explicit pagination;
- exact historical-path reads;
- immutable edits and alternative continuations;
- current-path selection and basic variant navigation;
- direct standalone use without Agent or Session adoption;
- a future-safe seam for multiple independent Session positions;
- explicit message redaction and whole-Thread deletion;
- opaque provider continuation sidecars;
- standard Storage discovery and explicit local overrides;
- development fallback diagnostics and production capability checks;
- Project Index, observability, Devtools, and Eval evidence; and
- generic Core correctness with optional adapter fast paths.

## Explicitly deferred

The following are important but belong to subsequent designs:

- how `recentMessages()` selects from explicit messages versus Thread;
- transcript compaction, checkpoints, and broader context budgeting;
- the exact public durable Session API and Session-to-Thread transaction;
- Signal, work-completion, approval, and timer projection into a Session;
- live Thread subscriptions or streaming uncommitted model deltas;
- cross-Thread copying or a public `thread.fork()` operation;
- arbitrary merge or rebase semantics;
- general conversation metadata such as title, participants, labels, or
  application status;
- destructive retention schedules beyond explicit redaction/deletion;
- rich collaborative editing of the same message;
- provider-hosted thread synchronization as the sole history source; and
- automatic projection of typed structured results back into model context.

Deferral does not prevent the internal contracts from reserving stable message,
activation, path, asset, and provenance identities.

## Terminology

### Thread

One user-visible conversation identity and the immutable message tree belonging
to it.

### Thread handle

The inert value returned by `thread()`. Constructing it performs no I/O.

### Canonical message

Crux's provider-neutral `Message` value. It preserves role-restricted text,
multimodal content, tool calls, tool results, reasoning parts, and metadata.

### Thread message

A canonical message with stable Thread identity and immutable provenance.

### Message node

The durable internal structural record for one Thread message. It points to its
parent and does not mutate after publication.

### Causal group

One atomic append containing one or more ordered messages. Groups keep a tool
call, its result, and the resulting assistant continuation together for
visibility, branching, and regeneration.

### Current path

The root-to-message history selected for ordinary standalone `read()`.
Internally the last selected message is a path position or head; the public API
does not require users to learn that term.

### Exact path

The root-to-message history ending at a caller-supplied message ID. Reading an
exact path does not change current selection.

### Alternative

An immutable sibling continuation from the same earlier conversation state.

### Provider continuation sidecar

Opaque, adapter-keyed state needed for lossless or efficient same-provider
continuation, such as response IDs or reasoning signatures.

### Activation result

The typed output of one Agent activation or standalone execution. It is durable
execution evidence linked to messages and exposed through its owning typed
Session turn, not canonical message content.

## Public definition contract

The conceptual factory is:

```ts
interface ThreadOptions {
  /** Stable identity within the effective storage scope. Generated if absent. */
  readonly id?: string

  /** Optional local override. Global configured storage is the common path. */
  readonly storage?: Storage
}

function thread(options?: ThreadOptions): Thread

interface Thread {
  /** Stable supplied or synchronously generated identity. */
  readonly id: string
}
```

The common application-owned identity is:

```ts
const conversation = thread({
  id: `tenant:${tenantId}:conversation:${conversationId}`,
})
```

The Thread ID is a storage identity, not an authorization check. Applications
must still enforce tenant access and should use scoped Storage where applicable.
Programmatic handles, receipts, and errors expose the exact ID to their
authorized caller. Emitted diagnostics use a stable scoped fingerprint by
default so composite application IDs do not leak tenant or user data.

Constructing a handle:

- assigns and exposes `thread.id` synchronously;
- performs no I/O;
- does not require the Thread to exist already;
- does not start an Agent or Session;
- does not acquire a lease;
- does not register a global resource manually; and
- does not imply durable behavior until effective storage is resolved.

After successful capability resolution, reading an untouched handle produces
an empty Thread. The first committed write establishes its durable state. A
deleted Thread ID cannot be accidentally re-established by an ordinary append.

## Canonical message contract

Thread input extends canonical `Message` with optional caller-supplied identity:

```ts
type NewThreadMessage = Message & {
  readonly id?: string
}
```

Durable normalization accepts only the persistence-safe canonical subset:

- metadata, tool inputs, and tool results must pass Crux's deterministic
  JSON-safe codec; functions, symbols, cyclic objects, and unregistered class
  instances reject before publication;
- binary/data media is copied into a Thread-owned AssetStore object;
- a remote URL remains an external locator whose portability and lifetime are
  represented honestly—it is not silently downloaded and called durable;
- provider-hosted file handles remain provider sidecars unless an adapter
  explicitly materializes their bytes; and
- provider-only media that cannot be materialized or represented portably
  rejects when portable durable history is required.

“Canonical durable truth” means every committed model-visible value is either
encoded portably, represented honestly as an external locator, or rejected. It
does not pretend that every URL or provider handle is owned by Crux.

Committed messages expose canonical fields directly. Reads use a discriminated
entry because a privacy tombstone is deliberately not a valid model message:

```ts
type ThreadMessage = Message & {
  readonly kind: 'message'
  readonly id: string
  readonly createdAt: number
  readonly variants?: ThreadMessageVariants
}

interface RedactedThreadMessage {
  readonly kind: 'redacted'
  readonly id: string
  readonly createdAt: number
  readonly redactedAt: number
  readonly variants?: ThreadMessageVariants
}

type ThreadEntry = ThreadMessage | RedactedThreadMessage

interface ThreadMessageVariants {
  readonly index: number
  readonly count: number
  readonly previous?: string
  readonly next?: string
}
```

Callers use:

```ts
message.id
message.role
message.content
```

They do not unwrap `message.message.role`.

Provider continuation state, structural parent IDs, causal group IDs, content
asset refs, and internal storage versions are not ordinary enumerable canonical
message fields. Advanced inspection may expose safe projections separately.

### Message identity and retries

Message identity is also write-replay identity:

```ts
await conversation.append({
  id: clientMessage.id,
  role: 'user',
  content: clientMessage.content,
})
```

The storage scope for uniqueness is `(threadId, messageId)`.

- A new identity commits normally.
- Replaying the identical normalized message at the identical structural
  position returns the original committed result.
- Reusing an identity with different role, content, metadata, parent, causal
  group position, or edit target rejects with a typed conflict.
- Identical content remains legal when it has a different message identity.
- Redacted identities remain reserved and cannot be reused.
- Sessions and adapters derive stable identities from accepted input,
  activation, step, and content-part positions.

Crux documents this as **at-most-one commit per message identity**, not
exactly-once execution. The write may be attempted repeatedly.

Optional helpers may create an ID-bearing message before an in-process retry or
derive a safe ID from an external event/message identity. No separate
idempotency ledger, expiration window, or required `idempotencyKey` option is
introduced.

Omitting IDs is the ergonomic one-shot path, not a promise of retry safety
after an unknown network outcome. A caller, adapter, or durable activation that
may retry must retain or derive stable message IDs before the first attempt.

For a batch, Core also derives one deterministic causal-group fingerprint from
the ordered message identities, normalized messages and sidecars, exact parent,
operation/edit target, and group boundary. Replaying the same group returns its
original commit receipt, including the head selected by that original commit,
without selecting it again if current selection has since moved. Reuse of only
part of a committed group, different grouping of existing identities, or any
different fingerprint is a typed conflict.

### Canonical normalization equality

Core owns one deterministic persisted-message normalization and fingerprint.
Replay equality includes every canonical field that could change model meaning
or durable application meaning, while excluding Crux-generated timestamps,
storage versions, and observation metadata.

Provider sidecars are validated under their adapter identity. They may be
enriched only as part of the original append commit; an adapter cannot later
rewrite the canonical message or silently replace another adapter's state.

## Append

The common API is:

```ts
interface Thread {
  append(
    message: NewThreadMessage,
    options?: ThreadAppendOptions,
  ): Promise<ThreadCommit>

  append(
    messages: readonly NewThreadMessage[],
    options?: ThreadAppendOptions,
  ): Promise<ThreadCommit>
}

interface ThreadAppendOptions {
  /**
   * Attach the group after this exact message rather than after the current
   * standalone path. The target must end its causal group.
   */
  readonly after?: string
}

interface ThreadCommit {
  /** Internal atomic causal-group identity. */
  readonly id: string
  /** Whether this commit selected its path when it first committed. */
  readonly status: 'selected' | 'alternative'
  readonly messages: readonly ThreadMessage[]
  /** Exact structural parent observed or supplied by this append. */
  readonly parent: string | null
  /** Standalone selected path immediately after the original commit. */
  readonly currentAtCommit: string
  readonly committedAt: number
  /** `true` only when returning a previously committed receipt. */
  readonly replayed: boolean
}
```

Examples:

```ts
await conversation.append({
  role: 'user',
  content: 'Hello',
})

await conversation.append([
  assistantToolCall,
  toolResult,
  assistantResponse,
])

await conversation.append(alternativeAssistantResponse, {
  after: earlierUserMessage.id,
})
```

Semantics:

- An empty batch rejects before storage.
- Input order is preserved.
- A batch is one causal group.
- The group becomes visible atomically.
- Ordinary append attaches to the standalone position it actually observed. It
  never rebases identified messages onto a newer selected path.
- If that observed parent remains selected at publication, the ordinary append
  selects its resulting path and returns `status: 'selected'`.
- If another operation has already changed selection, the ordinary append still
  commits durably as a sibling alternative and returns
  `status: 'alternative'`. Losing selection is not a failed commit.
- An explicit `after` attaches to the exact target and deliberately selects the
  resulting path. It is an explicit path-changing operation, not the
  conservative ordinary-append rule. The target must be the final message of
  its causal group; a mid-group target rejects with a precise boundary error
  rather than silently normalizing or creating an incomplete lifecycle.
- An explicit `select()` racing an ordinary append wins selection; the append
  remains a durable alternative. Races among explicit path-changing operations
  are ordered by their linearizable selection mutations.
- Failure before publication leaves the visible Thread unchanged.
- Thread append only stores messages. It never invokes, wakes, resumes, or
  interrupts an Agent.

`status`, `currentAtCommit`, and `committedAt` describe the original commit and
never change when selection later moves. `replayed` is observation metadata:
`false` on the original call and `true` when an exact retry receives that same
receipt.

Exact replay identity is the same Thread, structural parent, ordered message
IDs, normalized message content, provider sidecars, and causal-group boundary:

- an exact replay returns the original receipt with only `replayed` changed;
- the same identity at a different parent or with different content/order is a
  conflict;
- partial overlap with a committed batch is a conflict; and
- the same content under different message identities is a new valid append.

Session-owned writes use a lower internal commit boundary carrying an owner
position and selection policy. Session concurrency controls do not become
ordinary public options such as `select: false`, leases, or activation tokens.

## Read

The common read returns the complete current path:

```ts
interface Thread {
  read(options?: ThreadReadOptions): Promise<ThreadSnapshot>
}

interface ThreadReadOptions {
  /** Read the exact path ending here without changing current selection. */
  readonly at?: string

  /** Opt into bounded pagination over the addressed path. */
  readonly before?: string
  readonly limit?: number
}

interface ThreadSnapshot {
  readonly threadId: string
  readonly messages: readonly ThreadEntry[]
  /** Addressed path head: `at` when supplied, otherwise standalone current. */
  readonly current: string | null
  readonly hasMore: boolean
}
```

Rules:

- `read()` never silently truncates the current path.
- `read({ at })` never changes current selection.
- Messages are ordered oldest to newest.
- Supplying `limit` explicitly opts into group-safe pagination over the newest
  suffix of the addressed path.
- Pagination returns the newest complete causal groups that fit within `limit`.
  It may return fewer messages rather than split the next group. If one
  indivisible group alone exceeds `limit`, it returns that whole group so the
  caller can make progress.
- `before` is an exclusive causal-group boundary on the addressed path, is
  valid only with `limit`, and rejects when it does not identify the first
  message of a group on that path.
- `read({ at })` is explicit structural inspection and may end within a causal
  group. Such a prefix is canonical history but is not a model-context
  projection.
- `current` is the addressed path head even when pagination returns an older
  page: `at` when supplied, otherwise the standalone selected position captured
  for this read.
- One read resolves against one consistent position snapshot; a concurrent
  selection cannot mix two paths within the result.
- Pagination does not reorder messages or mix alternatives.
- Redacted messages remain structural tombstones in their path and expose no
  original content.
- A missing untouched Thread reads as an empty snapshot.
- A deleted Thread produces a terminal deleted outcome rather than appearing
  empty.

Model execution should not use unbounded public `read()` as its default context
policy. The subsequent recent-messages and compaction designs own bounded model
projections.

## Edit

The familiar edit API preserves role and accepts replacement content:

```ts
type CanonicalUserMessageContent =
  Extract<Message, { role: 'user' }>['content']

interface ThreadEdit {
  readonly id?: string
  readonly content: CanonicalUserMessageContent
  readonly metadata?: Readonly<Record<string, unknown>>
}

interface Thread {
  edit(messageId: string, replacement: ThreadEdit): Promise<ThreadCommit>
}
```

V1 `edit()` accepts only a user message that is the sole member of its causal
group. This keeps the familiar operation safe without pretending a single
replacement message can repair an assistant/tool lifecycle.

Editing:

1. resolves the target's causal position;
2. creates a new immutable sibling message with a new or supplied identity;
3. retains the original message and all descendants as an alternative;
4. starts a fresh continuation from the replacement;
5. advances standalone current selection to the replacement path; and
6. returns the new commit.

It never:

- mutates the original message;
- carries old descendants onto content they did not answer;
- changes the original role;
- invokes an Agent;
- regenerates an assistant response; or
- deletes the original alternative.

Assistant-message or multi-message causal-group replacement is deferred to a
separate group-aware operation. Provider/Session internals may branch by
appending a complete alternative group after an exact earlier position, but
that mechanism is not exposed as a misleading single-message edit.

## Selection and variants

Standalone selection is:

```ts
interface ThreadSelectOptions {
  /** Explicitly return only the newest group-safe suffix of the selected path. */
  readonly limit?: number
}

interface Thread {
  select(
    messageId: string,
    options?: ThreadSelectOptions,
  ): Promise<ThreadSnapshot>
}
```

`select()` makes an existing alternative current and restores its most recently
selected continuation. It does not truncate at the selected message. The
returned snapshot is pinned to the path selected by this operation, even if a
later concurrent operation moves standalone selection again.

Without `limit`, `select()` returns the complete selected path, matching
`read()` and never silently truncating. Supplying `limit` returns the newest
group-safe suffix and sets `hasMore`; older pages use
`read({ at: snapshot.current, before, limit })`. `select()` does not accept
`before`, because historical pagination remains a read concern.

Selection is a linearizable current-position mutation. Concurrent explicit
path-changing operations such as `select()`, `edit()`, and `append({ after })`
are ordered by the effective Storage's conditional mutation. Ordinary append is
different: it selects only while its observed parent remains selected and
otherwise commits as an alternative. No operation reparents an immutable
message to manufacture causality.

The standalone owner-position record contains the selected head and a small
remembered-tip mapping for alternatives the owner previously traversed.
Variant metadata decorates the first visible entry of each alternative causal
group. Selecting that entry restores this owner's remembered descendant. On
first selection, where no remembered tip exists, it selects the end of that
causal group—not an arbitrary deepest descendant. Appending on the branch
advances and remembers its tip.

This state is per standalone owner or future Session, so one Session's
navigation cannot move another's path.

Exact inspection and fresh continuation remain explicit:

```ts
await conversation.read({ at: messageId })
await conversation.append(newMessage, { after: messageId })
```

Messages that participate in alternatives expose small navigation metadata:

```ts
if (message.variants?.next) {
  await conversation.select(message.variants.next)
}
```

Variant metadata:

- is omitted for the ordinary one-path case;
- identifies logical causal-group alternatives rather than fragmenting one
  tool exchange into several UI variants;
- permits previous/next controls without exposing the complete graph; and
- remains non-model-visible Thread metadata.

Redaction does not erase topology. `select()` may target a redacted structural
entry, and variant links may point to one. The returned snapshot exposes only
the tombstone; this navigation never restores content or makes the path a valid
model-context projection.

Tree-wide graph inspection belongs to Devtools or an advanced API, not the
ordinary read result.

## Multimodality and assets

Thread supports the complete canonical multimodal contract from V1:

- text;
- images;
- audio;
- video;
- general files;
- assistant tool-call parts;
- tool results;
- persistable reasoning; and
- provider-neutral metadata.

At append:

1. Core validates canonical content.
2. Raw durable media is written through the effective `AssetStore`.
3. The private persisted-message codec stores durable asset references.
4. The structural message group is published only after required assets are
   available.
5. Failed publication leaves unpublished Thread-owned assets eligible for
   deterministic orphan cleanup.

If a durable append contains raw media but effective Storage lacks `assets`,
Crux rejects before publishing with a precise remediation. It never silently
stores process-local `Blob`, `Uint8Array`, or provider file handles in a durable
Thread.

The generic V1 path stores each copied binary asset under a unique
Thread/message-owned identity and does not deduplicate physical objects across
Threads or activation results. It therefore deletes only assets created for
that owning payload and needs no cross-store reference-count race. Application
supplied external locators are not Thread-owned and are not deleted.

An optimized adapter may deduplicate internally only if it supplies an
equivalent atomic ownership/reference protocol and passes the same erasure
conformance tests. Cross-owner shared asset roots are otherwise deferred.

## Provider normalization and continuation

Thread never changes its durable shape based on the active SDK:

```text
OpenAI / Anthropic / Google / AI SDK message
                    |
                    v
             canonical Message
                    |
                    v
                  Thread
```

Adapters:

- normalize native input/output into canonical messages;
- persist compatible opaque continuation state under an adapter/provider
  identity;
- reconstruct native requests from canonical messages plus compatible
  sidecars;
- ignore incompatible sidecars on provider switch; and
- preserve canonical replay even when provider-hosted history is unavailable.

Native provider IDs may become canonical Thread IDs only when their semantics
are stable and compatible. Otherwise adapters derive Crux message identity from
durable activation/step identity and retain native IDs in the sidecar.

Provider continuation state is an optimization or fidelity aid, never the sole
history. A provider switch may cost cache or continuation efficiency but cannot
erase the portable conversation.

## Structured output and Session turns

Structured output is not a new canonical message part merely because a
provider returned it through `response_format`, a synthetic Tool, or
text-plus-parse.

The durable relationship is:

```text
Session turn
|- typed validated output
`- canonical Thread message/group
```

The owning activation/Session record reserves:

- activation ID;
- Agent definition/version identity;
- output schema identity, version, or fingerprint;
- parse mode and validator identity;
- producing Thread/message IDs and relevant part positions;
- durable value encoding; and
- asset roots when the structured value contains media.

Those lineage links are internal and observable in Devtools. Users never carry
an activation ID or manually fetch a result in the common path.

A typed Session automatically joins the evidence and exposes completed
interactions as turns:

```ts
type CompletedSessionTurn<Output> = {
  readonly id: string
  readonly status: 'completed'
  readonly messages: readonly ThreadEntry[]
  readonly output: Output
}

const chat = session(invoiceAgent, { id: 'invoice:42' })
const { turns } = await chat.history()

for (const turn of turns) {
  if (turn.status === 'completed') {
    renderInvoice(turn.output)
  }
}
```

`thread.read()` returns canonical Thread history, not a ready-made model-input
array: it may contain redaction tombstones or a causally incomplete group.
Every model-context projection must exclude the whole affected group or fail
with a precise policy error. The later `recentMessages()` design owns that
projection.

`session.history()` returns typed interaction turns. Reopening the Session with
its Agent or other runnable primitive supplies the decoder and output type
without additional Thread schema configuration. The Session design owns schema
evolution, result decoding, and activation-result deletion; it must reject
incompatible evidence rather than make a lying TypeScript cast.

If structured output is implemented as a provider-visible Tool exchange, the
canonical Tool exchange remains in Thread. The typed parsed/validated value is
still Session-turn output.

Thread V1 exposes no public annotation API or application-only content parts.
Ordinary generative UI renders typed Session-turn output. A broader typed event
or annotation facility is deferred until concrete use cases define its
authoring, ordering, projection, and erasure contracts.

Future helpers may make deliberate projection of a typed result back into model
context simple, but that projection is never automatic.

## Redaction and deletion

Immutable conversational history does not override privacy and compliance
requirements.

```ts
const redaction = await conversation.redact(messageId)
const groupRedaction = await conversation.redact([
  assistantToolCall.id,
  toolResult.id,
])
const deletion = await conversation.delete()
```

```ts
interface ThreadErasureReceipt {
  readonly operationId: string
  readonly threadId: string
  readonly operation: 'redact' | 'delete'
  readonly messageIds?: readonly string[]
  readonly committedAt: number
  /** Model/API visibility has already changed at the commit barrier. */
  readonly logical: 'complete'
  readonly cleanup: 'complete' | 'pending' | 'failed'
}
```

### Message redaction

`redact(messageId | messageIds)`:

- is idempotent and returns the same operation identity and commit time on
  replay, with the latest cleanup state;
- accepts either one message ID or an array that is redacted atomically;
- publishes the redacted tombstone through the same linearizable position
  boundary used by other Thread mutations;
- makes canonical content and provider continuation sidecars inaccessible to
  all reads at that boundary;
- retains the minimum structural tombstone necessary for tree integrity;
- preserves the message ID as permanently reserved; and
- invalidates registered derived projections that included the content.

An array must be non-empty and is normalized as an order-independent,
deduplicated set of message IDs. The same normalized set returns the original
operation receipt. A different overlapping set creates a new atomic redaction;
members already redacted are no-ops within its postcondition while newly named
members become redacted together.

The design splits immutable structural nodes from separately erasable payload
records or assets so redaction does not require rewriting ancestry.

The barrier publishes `pending-erasure` internally but exposes only the public
redacted tombstone. `redact()` resolves only after logical erasure is durable
and physical cleanup is either complete or durably owned by a capable Runtime.
Without such a Runtime, cleanup runs inline and the operation returns complete
or throws. Once the logical barrier commits, content never becomes readable
again; later cleanup failure is observable and retryable.

All Crux-owned derived artifacts register lineage through `derivedFrom`.
Redaction automatically makes matching cached projections, summaries, indexes,
and other registered artifacts inaccessible and transfers their cleanup to
their owning primitive. Independently authored user or Agent messages are never
deleted merely because they may have been influenced by redacted content.
External application copies are outside Crux ownership and cannot be claimed as
erased.

Registration is a read-barrier contract, not cleanup bookkeeping alone:

- the redaction commit publishes a durable lineage invalidation token;
- every registered Crux-owned derived read path checks that token before
  returning an artifact;
- an owner that cannot verify the token fails closed rather than serving
  possibly invalidated data;
- the owner durably accepts physical cleanup before redaction may return
  `cleanup: 'pending'`; and
- conformance tests cover the interval between logical invalidation and
  physical deletion.

Thread receipts claim logical and physical erasure only for Crux-owned storage.
Provider-hosted files or response objects require confirmation from their
owning provider before being reported deleted. Previously exported bearer
references, downloaded bytes, observability exports, and application copies are
outside the receipt unless their owning system participates and confirms
deletion.

Redacting one member does not erase unrelated content in the same causal group.
The group remains structurally visible with a tombstone, but any model-context
projection must treat the tool lifecycle as incomplete and exclude the whole
group or produce a precise policy error. Atomic-group publication still means
that the original group first became visible wholly; redaction is a later,
explicit privacy transition.

Only an atomic commit containing a redacted message becomes unavailable for
exact replay, because its original normalized payload no longer exists. Other
commits in the Thread remain replayable.

### Whole-Thread deletion

`delete()`:

- is idempotent and returns the same operation identity and commit time on
  replay, with the latest cleanup state;
- commits the same minimal permanent deletion marker when no message has ever
  been written under the Thread ID;
- durably marks the Thread deleted and immediately inaccessible;
- prevents ordinary resurrection under the same Thread ID;
- removes message payloads, provider sidecars, and Thread-owned derived
  projections;
- coordinates linked Session/activation ownership in the later Session design;
  and
- cleans unreferenced assets and indexes.

The receipt never exposes whether the Thread previously contained messages.
Deleting an untouched ID returns `cleanup: 'complete'` after its marker commits.
Authorization is evaluated against the tenant/Storage scope before the record
exists, not against absent Thread content. Deleted markers count against the
same tenant quotas and rate limits as live Threads so callers cannot use
deletion for unbounded ID squatting or storage amplification.

The minimal deletion marker is retained permanently by default. Crux does not
silently expire the anti-resurrection guarantee; any future retention policy
that permits ID reuse must be an explicit separate contract.

The visible destructive transition is a commit barrier. Physical cleanup may
run after it only when cleanup ownership is durably accepted; otherwise cleanup
runs inline. The receipt distinguishes `cleanup: 'pending'` from
`cleanup: 'complete'` or `cleanup: 'failed'`; a later cleanup-wait API may be
added for compliance-sensitive callers.

The tombstone or deleted marker is the linearization point. Operations whose
publication wins before that point are covered by the erasure. Reads and
writes linearized afterward observe redaction or deletion. A write that loses
to deletion cannot retry into resurrection.

Devtools distinguish:

- an unselected alternative;
- a redacted structural tombstone;
- a deleted Thread; and
- pending versus completed physical cleanup.

## Storage and configuration

### One standard Storage vocabulary

Current Crux exposes both:

- `config({ persistence: { records } })`; and
- the standard `Storage` bundle `{ records, vectors?, assets? }`.

Thread requires records plus optional assets, making two global vocabularies
increasingly confusing. Before the public Thread contract graduates, Crux
should converge on:

```ts
config({
  storage: postgres(),
})
```

The standard `Storage` bundle becomes the global config type and the same type
accepted by per-primitive overrides. Because Crux is pre-launch,
`config.persistence` is removed rather than retained as an alias. Supplying the
old key produces a targeted migration diagnostic; the two settings never
coexist and need no precedence rule.

Users never configure:

```ts
config({
  threads: ...,
  memory: ...,
  flows: ...,
})
```

### Capability provision

Storage, Runtime, and Host remain separate capability slots, but ordinary users
do not fill all three.

Every persistence-bearing storage port declares:

```ts
interface StoragePortProvenance {
  readonly durability: 'durable' | 'ephemeral'
  /** Safe adapter/source identity, not a connection string or tenant key. */
  readonly source: string
}
```

`RecordStoreCapabilities` and `VectorStoreCapabilities` include this
provenance. `AssetStore` gains the same capability method. Adapter factories
declare it once; application users do not repeat a durability flag.

The standard `storage()` bundle preserves per-port provenance. A primitive
checks only the ports it actually uses: a text Thread requires durable records,
a Thread that copies media requires durable records and assets, and an
ephemeral vector index does not weaken an otherwise durable Thread.

A Runtime composer may explicitly declare that it provides a standard Storage
bundle through a typed capability facet.

A platform lifecycle boundary may bind Host for the active invocation.

Examples:

```ts
// Stateless Crux
config({})

// Thread/Memory only
config({
  storage: postgres(),
})

// Durable Node Sessions, only when this composer explicitly provides both
config({
  runtime: node({
    store: postgres(),
  }),
})

// Platform-native composition
config({
  runtime: convex(),
})

// Serverless durable execution; withCrux binds request retention
config({
  runtime: serverless({
    store: postgres(),
    wake: qstash(),
  }),
})
```

Capability provision is declared in the composer contract. Core never relies on
duck-typing or environment/package discovery. Today's RuntimeStoreAdapter and
Storage contracts are separate; a composer does not provide Storage merely
because its runtime store happens to use the same database. Until a composer
implements the typed facet, users configure `runtime` and `storage` separately.

### Storage resolution

Effective Storage resolves atomically:

```text
explicit per-primitive storage
> config.storage
> storage explicitly provided by configured runtime
> development in-memory fallback
> production error
```

Core does not silently merge bundles across sources. If `config.storage` wins
but lacks `assets`, Crux does not secretly borrow assets from Runtime-provided
Storage. Users compose mixed backends explicitly with `storage({...})`.

Devtools and diagnostics report the exact selected source and whether it came
from a primitive override, global config, Runtime provision, or automatic
development fallback.

### Host remains separate

Host retention and durable Runtime execution remain distinct:

- Host retains local work within the current invocation/process lifecycle.
- Runtime owns durable state, wake, timers, and resumable execution.

Normal framework code obtains Host from its lifecycle boundary:

```ts
export const POST = withCrux(handler)
```

`config.host` remains an advanced escape hatch for ambient retention outside a
native boundary. Runtime/platform composers may provide a Host fallback only
when they genuinely own the same lifecycle.

Host resolution is:

```text
active platform invocation
> explicit config.host
> host explicitly provided by runtime/platform composer
> development warning/fallback where safe
> production capability error
```

Thread append itself does not need Host. Derived post-commit work may use it.

## Generic storage algorithm

Thread correctness should be implemented once in Core over standard Storage,
not once per database.

The load-bearing generic guarantees are:

- atomic `RecordStore.create(key, value)`;
- mandatory linearizable single-key `RecordStore.mutate()` for mutable owner
  positions and deletion/redaction barriers;
- read-your-writes or bounded causal read visibility;
- deterministic key identity;
- durable JSON records; and
- AssetStore durability when canonical content requires assets.

`mutate()` is additive to the existing public RecordStore vocabulary. The
excerpt below omits unchanged batch, list, scan, watch, and capability methods:

```ts
interface RecordStore<T extends JsonObject> {
  get(key: string): Promise<T | null>
  put(key: string, value: T, options?: RecordWriteOptions): Promise<void>
  create(key: string, value: T, options?: RecordWriteOptions): Promise<boolean>
  delete(key: string): Promise<void>

  mutate(
    key: string,
    reducer: (
      current: T | null,
      actions: {
        set(value: T, options?: RecordWriteOptions): MutationDecision<T>
        remove(): MutationDecision<T>
        keep(): MutationDecision<T>
      },
    ) => MutationDecision<T>,
  ): Promise<MutateResult<T>>
}

type MutationDecision<T> =
  | { type: 'set'; value: T; options?: RecordWriteOptions }
  | { type: 'remove' }
  | { type: 'keep' }

type MutateResult<T> =
  | { status: 'set'; value: T }
  | { status: 'removed'; value: null }
  | { status: 'kept'; value: T | null }
  | { status: 'conflict' }
```

The reducer is synchronous, invoked exactly once per `mutate()` call, and never
automatically retried. `set()` replaces the value and TTL, `remove()` deletes,
and `keep()` preserves both value and TTL. `conflict` is the only adapter result
that guarantees no mutation committed; backend failures throw.

`mutate()` is mandatory for every `RecordStore`, not an optional capability.
An adapter that cannot provide honest linearizable single-key mutation cannot
claim the RecordStore contract.

Core implements this API once over a narrower adapter seam:

```ts
interface RecordStoreAdapter<T> {
  read(key: string): Promise<Versioned<T> | null>

  write(
    key: string,
    expectation:
      | { type: 'any' }
      | { type: 'absent' }
      | { type: 'revision'; revision: Revision },
    operation:
      | { type: 'set'; value: T; ttlMs?: number }
      | { type: 'remove' },
  ): Promise<'applied' | 'conflict'>
}
```

Revisions remain private equality tokens. They are never exposed through the
public RecordStore, ordered, or used as fencing numbers. A revision observed
before delete, expiry, or recreation cannot mutate the replacement record.
Expected absence means absent at the atomic commit point; it does not require a
persistent versioned-absence tombstone.

TTL begins at commit. Expiry behaves as absence, `set()` without a TTL clears a
previous TTL, `keep()` preserves it, and the backend's authoritative clock owns
expiry. An adapter without TTL support rejects a TTL request precisely.

`MutateError` reports outcome only as `'not-applied'` or `'unknown'`. Core may
claim `not-applied` for validation and read failures before dispatch. Reducer
exceptions propagate unchanged and never dispatch a write. Any adapter write
throw is conservatively `unknown`; callers reconcile unknown outcomes using a
stable domain operation identity stored in the value.

This is general infrastructure for Thread, Session positions, leases, locks,
and other durable primitives—not a Thread-specific user configuration surface.

Thread does not depend on `putMany()` atomicity or require a general
transaction callback.

### Atomic group publication

A generic append can:

1. validate, normalize, fingerprint, and persist required assets;
2. atomically `create()` immutable structural/payload records by stable ID;
3. leave those records unreachable from any published position;
4. publish the causal group and update the standalone position through
   linearizable record mutation; and
5. return the immutable commit receipt.

The group publication boundary is the visibility linearization point. Readers
see the whole group or none of it. Selection is then resolved under the append
policy: an ordinary append advances only from the parent it observed and
otherwise remains an alternative; explicit path-changing operations update
selection in their own linearizable order.

A crash before publication can leave unreachable immutable records. They are
harmless and eligible for retained maintenance cleanup.

There is no weaker create-only fallback for mutable current positions. An
adapter without `mutate()` fails its RecordStore capability check with
exact remediation rather than exposing race-dependent history.

Delete and redact participate in the same Thread-control order as append, edit,
and select. Because their target and destructive meaning remain stable, they
may issue a fresh `mutate()` call after contention until they publish or
encounter a terminal state. No message operation semantically reparents an
immutable group. Ordinary append preserves a losing selection publication as a
durable alternative rather than reporting a failed commit.

### Adapter fast paths

Storage adapters may declare an optional optimized Thread execution capability
for:

- one native transactional mutation per group;
- indexed branch/path hydration;
- native reactive reads in external integrations;
- efficient cleanup; and
- fewer remote round trips.

This capability is an adapter-author API or private facet, not a user config
slot. Generic and optimized paths expose identical behavior and run the same
conformance suite.

Core may also store immutable path segments/checkpoints to keep generic branch
hydration efficient without changing public semantics.

### Consistency

If a reader observes a newly published position but a replica temporarily
cannot read the referenced nodes, Core performs a bounded causal retry.
Persistent inability to establish the path produces a structured storage
consistency diagnostic; it never returns a silently incomplete Thread.

## Development fallback and production readiness

When no durable Storage source is available:

- development may allocate one process-local in-memory Storage bundle;
- the first Thread operation emits one deduplicated warning;
- console, observability, and Devtools show `durability: ephemeral`;
- the warning states explicitly that history is process-local and production
  will reject;
- the warning includes copy-pasteable Storage configuration remediation; and
- strict development diagnostics may promote it to an error.

Example diagnostic:

```text
[Crux THREAD_EPHEMERAL_FALLBACK]

Thread [thr_7fb31c…] is using in-memory storage because no durable
Storage is configured.

History will be lost on restart and is not shared across processes.
Production will reject this configuration.

Configure `storage: ...`, use a Runtime that provides Storage, or explicitly
opt into ephemeral behavior.
```

Explicit `inMemoryStorage()` suppresses the warning because reduced guarantees
were intentionally selected.

A Storage adapter declares its durability; Core does not infer durability from
its package name or from the fact that it implements records.

- configured durable or explicitly configured ephemeral Storage wins;
- explicitly passing in-memory Storage is allowed in production because the
  reduced guarantee was deliberately selected; and
- only the automatic development fallback warns and production rejects.

A durable Session may never silently bind an ephemeral Thread. It fails before
accepting input with exact remediation.

## Deferred derived work

Authoritative Thread writes are commit barriers:

```ts
await conversation.append(messages)
```

When this resolves, the committed path is durably visible according to the
selected Storage contract.

Low-level `defer()` or Runtime work may handle consequences after commit:

- Memory extraction;
- embeddings;
- search indexes;
- transcript-compaction checkpoints;
- analytics;
- observability delivery; and
- orphan/asset cleanup.

Derived work never becomes a substitute for the canonical append. If the
append itself should happen later, the application explicitly schedules a
named/background task whose eventual operation calls `append()`.

## Future Session integration seam

Thread owns one immutable message tree. A future durable Session owns:

- one independent position into that tree;
- an ordered input/activity log;
- activation state;
- pending approvals/work/timers; and
- Agent setup/version policy.

Multiple Sessions may continue concurrently from different positions without
racing over one execution position.

`session.fork()` is expected to create a child Session on the same Thread,
snapshotting a chosen message position. The product-visible path follows an
explicitly active Session or standalone position; background child activity
cannot make the visible conversation jump unexpectedly.

Session is not required for standalone Thread. Internally, standalone selection
and Session positions should share one small owner-position contract rather
than making every Thread secretly allocate a full Session.

The exact atomic Session-input/Thread-message commit, inheritance rules, and
public Session methods remain owned by the Session design.

## Memory and context boundary

Thread is the canonical conversation write model.

Memory, `recentMessages()`, and transcript compaction are read-side projections:

```text
Thread                 what was committed
Memory                 what was learned
Transcript projection  what message representation enters this invocation
Context budgeting      how all context contributors share a model budget
Session                what durable execution owns a position and reacts
```

Thread does not automatically:

- render history as system text;
- decide how many messages a model sees;
- summarize old content;
- extract facts or episodes;
- send Session-turn output to the model; or
- treat the current Thread as every step's mandatory context.

Those decisions remain composable and can vary per invocation or future
step-level context policy.

## Failure model

V1 needs typed failures for at least:

- invalid canonical message content;
- empty append batch;
- message identity conflict;
- target message not found;
- target not present in the addressed Thread;
- invalid edit role or causal-group boundary;
- append target that does not end its causal group;
- invalid selection target;
- Storage without linearizable single-key mutation;
- unknown mutation outcome requiring domain-level reconciliation;
- missing required durable Storage;
- missing AssetStore for durable raw media;
- storage consistency failure;
- empty redaction set;
- operation that requires erased content from a redacted target;
- exact replay unavailable because its commit contains redacted content;
- deleted Thread;
- redaction failure;
- deletion/cleanup failure; and
- incompatible provider continuation state when no canonical fallback exists.

User-facing diagnostics:

- name the Thread and operation;
- distinguish retryable storage contention from permanent contract errors;
- state whether visible history changed;
- avoid exposing message payloads or tenant identifiers by default;
- include exact adapter/config remediation; and
- remain visible in Runs and Project Health.

“Name the Thread” means its stable privacy-safe diagnostic fingerprint unless
raw identity capture is explicitly enabled. The exact `threadId` remains
available on the programmatic error or receipt returned to the authorized
caller.

## Observability and Devtools

Thread should expose provider-neutral evidence for:

- definition/handle identity where authored;
- effective storage source and durability;
- append attempt, replay, conflict, and commit;
- causal group identity and message counts;
- parent/alternative relationships;
- current-path changes;
- exact-path and paginated reads;
- provider normalization and compatible-sidecar use;
- asset persistence and cleanup;
- internal Session-turn/result provenance links;
- deferred projection scheduling/outcome;
- redaction;
- deletion and cleanup state;
- storage contention/retry; and
- consistency diagnostics.

Payload capture follows existing Crux privacy policy. Default traces should use
scoped identity fingerprints, counts, roles, content types, hashes, and bounded
safe previews rather than raw application IDs or conversation content.

Devtools should render:

- the current linear transcript by default;
- alternative branches on demand;
- causal groups for tool lifecycle;
- Session-turn/result provenance links when their owning primitive is available;
- provider sidecar availability without exposing secret contents;
- multimodal asset state;
- redacted tombstones;
- deleted Threads and cleanup progress; and
- storage/durability diagnostics.

The graph view can later reuse the same immutable parent relations for visual
conversation maps without making visualization part of Thread's runtime API.

## Project Index

The Project Index should recognize:

- authored `thread()` definitions when statically identifiable;
- Agent/Prompt/Session dependencies on Thread;
- explicit Storage overrides;
- runtime-provided Storage capability;
- message/context projection policies;
- redaction/deletion policy contributions; and
- platform/runtime capability gaps.

Lint rules should detect likely production misconfiguration:

- durable Thread use with no Storage source;
- Runtime that does not provide Storage plus no `config.storage`;
- durable multimodal Thread use with no AssetStore;
- explicit ephemeral Thread used by a durable Session;
- ambiguous provider-native-only history;
- ignored development fallback warnings; and
- unsafe raw-content observability policy.

Project discovery records authored relationships; it does not create Threads,
register them globally, or infer tenant authorization.

## Eval support

Evals should be able to:

- construct isolated in-memory Threads explicitly;
- seed canonical paths and alternatives;
- test exact replay and identity conflict behavior;
- select deterministic alternatives;
- inspect exact model-visible transcript projections;
- simulate missing storage/assets and consistency failures;
- verify redaction/deletion evidence;
- compare generic and optimized storage paths; and
- test Agent/Session behavior against a stable Thread fixture.

Eval isolation must never mutate a production Thread unless the Eval explicitly
uses a real external target.

## Security and privacy

- Thread IDs are addresses, not access-control tokens.
- Storage scoping is deterministic namespacing, not authorization.
- Storage keys encode and namespace application IDs so composite IDs are not
  casually exposed by backend listings.
- Applications enforce tenant/user permissions before obtaining or mutating a
  handle.
- Provider sidecars and reasoning signatures are opaque and excluded from
  ordinary output.
- Raw content is not included in diagnostics by default.
- Raw application Thread IDs in emitted diagnostics require explicit
  observability capture-policy opt-in.
- Asset references are treated as bearer references under the owning
  AssetStore's policy.
- Redaction removes content-bearing sidecars and derived references.
- Delete/redact operations are separately authorized from append/edit/select.
- Custom Storage and provider adapters are trusted code and must pass
  conformance/privacy tests.

## Compatibility and migration

Thread is additive, but it exposes inconsistencies in current message-memory
ownership:

- canonical `Message` remains the portable message format;
- current `recentMessages()` remains functional until its separate design
  changes capture/storage semantics;
- existing caller-owned `messages` arrays remain supported;
- current stateless compaction utilities remain usable;
- no provider package becomes a dependency of `@use-crux/core`; and
- provider adapters continue to own native conversion.

The config migration is:

```ts
// Before
config({
  persistence: { records },
})

// After
config({
  storage: storage({ records }),
})
```

The repository-wide implementation must update Runtime, Flow, Plans, Memory,
Retrieval, adapters, documentation, and Project Index inspection together.
`config.persistence` is not retained as a compatibility alias; runtime
validation emits a precise replacement message for JavaScript or stale
configuration that bypasses TypeScript.

## Invariants

An implementation conforms only if all of these remain true:

1. One Thread ID owns one immutable message tree.
2. Canonical Crux messages are always durable portable truth.
3. Provider-native continuation state is never the only history.
4. Committed message identity never changes or becomes reusable.
5. The same identity cannot represent two canonical writes or positions.
6. Atomic causal groups are wholly published or wholly absent. Ordinary
   pagination preserves group boundaries; exact structural inspection may
   deliberately return a prefix.
7. Ordinary `read()` never silently truncates.
8. Exact-path reads never mutate selection.
9. Edit never rewrites the target or carries its descendants onto new content.
10. Selection never deletes alternatives.
11. Session-turn output never becomes model-visible without deliberate
    projection.
12. Structured activation results never become a parallel canonical message
    representation or an accidental Thread-owned store.
13. Durable raw media is asset-backed before message publication.
14. Append resolves only after canonical publication.
15. Deferred work may derive from a commit but cannot substitute for it.
16. Standard Storage is configured once; no Thread-specific user store exists.
17. Generic and optimized storage paths have identical observable semantics.
18. Development fallback warns that production will reject.
19. Durable Sessions never silently bind ephemeral Threads.
20. Redaction removes content while retaining only required topology and makes
    incomplete causal groups unavailable to model projection.
21. Deletion prevents accidental resurrection.
22. Thread remains usable without Runtime, Host, Agent, or Session.

## Follow-up designs

The Thread contract deliberately leaves these concerns to their owning designs:

- typed Session schema evolution and historical-output decoding;
- Session events or annotations, if concrete application use cases require
  them;
- physical-cleanup waiting through the Background Work contract; and
- the repository-wide `persistence` to `storage` config migration.

The next design should address `recentMessages()` and explicit message-source
precedence. Compaction and Session integration follow only after that
projection contract is settled.
