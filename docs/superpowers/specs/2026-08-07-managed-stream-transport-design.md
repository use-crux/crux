# Managed async-stream transport supervision — design

Status: **accepted for implementation** (spec/plan phase only; no production code in this commit)

Parent: [use-crux/crux#340](https://github.com/use-crux/crux/issues/340)  
Depends on: shared durable envelope acceptance (#337), immutable Runtime Program / one worker (#336)  
Baseline on main: managed **polling** supervision (merged as #389 at `7dbf68adf`)

## Summary

This design adds the **generic managed async-stream lifecycle seam** for Signal providers. Provider authors declare `stream({ open })` beside the existing `webhook({ handle })` and `polling({ poll })` transports. The single Runtime worker owns connection lifetime, binding lease/fence, reconnect/backoff, durable envelope acceptance through the #337 kernel, cursor checkpointing, bounded pull backpressure, restart, and shutdown.

SSE and WebSocket adapters are **out of this PR**. They must later be thin authoring helpers that compile to this seam. This PR does not introduce a second worker, daemon, store, scheduler, registry, lease mechanism, or provider SDK dependency in `@use-crux/core`.

## Goals

1. Public provider-authoring API: `stream({ open })` on `@use-crux/core/signal/transport`, accepted by `signalProvider({ transport })`.
2. Runtime owns the full connection lifecycle for stream bindings on the existing #336 worker and #337 accept path.
3. One yielded item is exactly either an **envelope item** (optional post-item cursor) or a **cursor-only progress item**. No batching at the authoring protocol.
4. Cursor means opaque adapter-owned progress: all provider input through that point has been **yielded**. Runtime checkpoints a cursor only after every envelope it covers is **durably accepted** (or same-digest duplicate / progressable conflict with durable evidence — same rules as polling).
5. Clean iterator EOF means clean disconnect, not terminal binding completion: reconnect with bounded backoff from the durable cursor.
6. Thrown errors are **transient by default**. A minimal explicit terminal/fault shape marks non-reconnectable cases (for example revoked auth). Exhaustion and fault are durable, observable, and restart-stable without unbounded error history.
7. Abort is Runtime-initiated (shutdown, lease expiry/loss, rebalance). Abort the signal, call `iterator.return?.()`, bound cleanup, and prevent stale acceptance/checkpoint after the lease fence trips.
8. Durable checkpoint owns cursor **plus the config identity** it was produced under. Changed `configRef` over-invalidates the prior cursor. Backoff attempt/delay/connection phase is process-local. Durable `faulted` / `disabled` status prevents silent resurrection of terminal failure after restart.
9. Pull iteration is Runtime backpressure. Future push-based WebSocket adapters must use bounded buffering and disconnect/reconnect on overflow — never silent event loss.
10. Paper/type mapping proves future SSE and WebSocket can map to this seam. Reserve additive optional post-accept notification/ack support; do not implement SSE/WS or freeze a mandatory ack API here.
11. Ship Memory + PostgreSQL conformance, competing-worker / restart / shutdown behavior, inert RuntimeProgram declaration, Project Index static/native/semantic parity as needed, LSP/lint, Devtools observation **if** the current read model already supports the facts, progressive docs, and an update to the existing minor changeset `.changeset/reactive-durable-execution.md`.

## Non-goals

- A second worker, queue, scheduler, maintenance loop, transport daemon, Session head, mutable target registry, or global registration.
- RabbitMQ or any broker as a correctness dependency.
- SSE or WebSocket first-party adapters (follow-on PRs, thin over this seam).
- Channel exclusive conversation ownership (#302).
- Public durable Session construction (#338/#339).
- Storing live credentials, clients, sockets, `Request`s, or callbacks in Project Index, generated Runtime Program JSON, or inert bindings.
- Provider SDK clients inside `@use-crux/core`.
- Mandatory client acknowledgement API for WebSocket protocols (reserved only).
- Renaming or breaking the shipped `polling()` / webhook supervision contracts.
- Major changeset; package users see a **minor** extension of managed transport.

## Binding constraints from current code

These contracts already exist and this design **extends** them; it must not invent parallel kernels.

| Surface | Current contract (do not break) |
| --- | --- |
| Inert binding | `RuntimeManagedTransportBinding` is pure data: `id`, `adapter`, `configRef`, `target` only |
| Envelope | `RuntimeAcceptedTransportEnvelope` v1 via `acceptTransportEnvelope()` |
| Identity | `(namespace, provider, accountId, eventId)` + digest conflict rules |
| Normalization | Single worker drain via `createTransportNormalizationRunner` / `createWorkerTransportDrain` |
| Lease | `transport-binding:{namespace}:{bindingId}` on existing `LeasePort` |
| Checkpoint port | Optional `getBindingCheckpoint` / lease-fenced `putBindingCheckpoint` on `RuntimeTransportStorePort` |
| Polling authoring | `polling({ poll, intervalMs? })` → `PollContext` `{ cursor, signal, configRef }` → `PollResult` batch |
| Polling supervision | Tick-scoped: lease, one poll, accept each event, checkpoint `nextCursor` after full batch |
| Stats | Shared statistics ledger owner `{ kind: "transport", id: namespace }`, first-64 adapter/binding attribution |
| Program | `createRuntimeProgram({ providers, transports })`; live providers + inert bindings |
| Indexer | `signal.transport` facts with `transportKind: "webhook" \| "polling"`; live-field lint includes `poll` / `handle` / `onEvent` |

### Polling vs stream (intentional differences)

| Concern | Polling (shipped) | Stream (this design) |
| --- | --- | --- |
| Authoring unit | Bounded page `PollResult` | Pull `AsyncIterable<StreamItem>` |
| Tick interaction | One poll attempt per maintenance tick | Lease + fiber management on tick; **long-lived connection fiber** must not monopolize the tick |
| Progress API | Batch `nextCursor` after all page events | Per-item optional cursor or cursor-only item |
| Empty progress | Empty `events` + same/next cursor | Cursor-only item or clean EOF |
| Reconnect | Implicit next tick / `intervalMs` | Explicit bounded backoff after EOF or transient error |
| Terminal failure | Safe `lastErrorCode` only; keeps retrying | Durable `faulted` / `disabled` so restart does not silently resume |
| Config identity on checkpoint | Not stored today | **Required** on stream checkpoints; also extended for shared checkpoint record |

## Public authoring API

Module: `@use-crux/core/signal/transport` (export from `packages/core/src/signal/transport/stream.ts` and re-export through `index.ts`).

**Name collision note:** Generation adapters also expose `stream()` for LLM token streams (`@use-crux/ai`, provider packages). This design’s `stream()` is **only** the managed **ingress transport** constructor on `@use-crux/core/signal/transport`. Docs and JSDoc must say “managed stream transport” where ambiguity is likely. Do not merge the two APIs.

```ts
import type { JsonValue } from "@use-crux/core/storage"; // existing package-local JsonValue
import type {
  RuntimeAcceptedTransportPayload,
  RuntimeTransportConfigRef,
} from "@use-crux/core/runtime";

/**
 * Context supplied to {@link StreamOpen} when Runtime opens one connection.
 *
 * @remarks `cursor` is the durable checkpoint from the last fenced write under
 * the current config identity, or `null` when none exists / config invalidates.
 * `signal` aborts on worker stop, lease expiry/loss, or rebalance. `configRef`
 * is the secret-free identity from the inert binding.
 */
export interface StreamOpenContext {
  readonly cursor: string | null;
  readonly signal: AbortSignal;
  readonly configRef: RuntimeTransportConfigRef;
}

/**
 * One authenticated provider event, matching webhook/poll envelope fields.
 *
 * @remarks Optional `cursor` is progress **through this item inclusive**.
 * Runtime may checkpoint that cursor only after this envelope is durably
 * accepted (or same-digest duplicate / progressable conflict with evidence).
 */
export interface StreamEnvelopeItem {
  readonly kind: "envelope";
  readonly accountId: string;
  readonly eventId: string;
  readonly authenticatedRouting: Readonly<Record<string, JsonValue>>;
  readonly payload: RuntimeAcceptedTransportPayload;
  /**
   * Opaque resume position after this envelope has been fully accepted.
   *
   * @remarks Omitted means "no new checkpoint from this item". `null` clears
   * the durable resume position (only when the provider truly has none).
   */
  readonly cursor?: string | null;
}

/**
 * Progress without a new envelope.
 *
 * @remarks Runtime may checkpoint immediately. Use for heartbeats, SSE
 * comment/id advances, or provider "caught up" markers that do not carry
 * events. Must never cover unyielded input (adapter contract violation).
 */
export interface StreamCursorItem {
  readonly kind: "cursor";
  readonly cursor: string | null;
}

/** Exactly one protocol item per yield. Do not batch at authoring time. */
export type StreamItem = StreamEnvelopeItem | StreamCursorItem;

/**
 * Open one provider connection and yield items under Runtime backpressure.
 *
 * @remarks Live credentials and clients stay inside the adapter closure.
 * Must honor `signal`. Clean completion (iterator returns) is disconnect,
 * not terminal binding success. Throw for failures; use
 * {@link ManagedStreamTerminalError} (or compatible shape) for non-reconnectable
 * faults.
 */
export type StreamOpen = (
  context: StreamOpenContext,
) => AsyncIterable<StreamItem> | Promise<AsyncIterable<StreamItem>>;

export interface StreamOptions {
  readonly open: StreamOpen;
}

export interface StreamTransport {
  readonly _tag: "StreamTransport";
  readonly kind: "stream";
  readonly open: StreamOpen;
}

export function stream(options: StreamOptions): StreamTransport;
```

### Union membership

```ts
// packages/core/src/signal/transport/index.ts
export type SignalProviderTransport =
  | WebhookTransport
  | PollingTransport
  | StreamTransport;
```

`signalProvider` validation accepts `_tag: "StreamTransport"` with a function `open`, parallel to webhook/polling checks. Add `isStreamTransport()` beside `isPollingTransport` / `isWebhookTransport`.

### Construction rules

- `open` must be a function; otherwise `TypeError`.
- Definition is frozen, performs no I/O, and does not register globally.
- Inert `managedTransportBinding()` never captures `open` (same as `poll` / `handle` / `onEvent`).
- Live-field lint list gains `open` (and, for defense in depth, future `socket` already listed).

### Example (illustrative; not a provider SDK)

```ts
import { stream } from "@use-crux/core/signal/transport";
import { signalProvider } from "@use-crux/core/signal/provider";

export const ordersLive = signalProvider({
  id: "orders.stream",
  transport: stream({
    async *open({ cursor, signal, configRef }) {
      const connection = await connectProvider({ cursor, signal, configRef });
      try {
        for await (const message of connection.messages) {
          yield {
            kind: "envelope",
            accountId: message.accountId,
            eventId: message.eventId,
            authenticatedRouting: { source: "stream" },
            payload: message.payload,
            cursor: message.cursor,
          };
        }
      } finally {
        await connection.close();
      }
    },
  }),
  signals: { orderSubmitted },
  async onEvent(envelope, { signals }) {
    await signals.orderSubmitted.publish(map(envelope));
  },
});
```

## StreamItem protocol semantics

### Discriminant

Every yielded value **must** include `kind: "envelope" | "cursor"`. Missing or unknown `kind` is a contract violation (`TRANSPORT_STREAM_CONTRACT_INVALID`), treated as a **transient** failure of the current connection (close, reconnect with backoff) unless the adapter throws a terminal error first.

### Envelope item

Field meanings match `PollEvent` / webhook handle results so `envelopeFrom*` helpers stay isomorphic:

| Field | Rule |
| --- | --- |
| `accountId`, `eventId` | Non-empty trimmed identifiers; feed #337 identity |
| `authenticatedRouting` | Detached JSON, existing secret-key and size validation at accept |
| `payload` | `inline-base64url` or `durable-ref` as today |
| `cursor?` | Same string rules as polling `nextCursor` (`MAX_TRANSPORT_BINDING_CURSOR_BYTES`, trimmed, no ASCII controls), or `null` |

### Cursor-only item

| Field | Rule |
| --- | --- |
| `cursor` | Required; same validation as above including `null` |

### Adapter contract (documented; not silently repaired)

1. **Yield order is authority.** An item that appears later must not require earlier unyielded provider input for its cursor meaning.
2. **Cursor coverage.** When the adapter yields a cursor `C` (on an envelope or cursor-only item), `C` means *all provider input through that progress point has already been yielded as envelope items or intentionally skipped without needing acceptance*.
3. **Violation.** Yielding a cursor that covers unyielded input is an adapter bug. Runtime does not invent compensating fetches; it only accepts what was yielded and checkpoints only after durable accept of yielded envelopes.
4. **No authoring batch.** Adapters must not return arrays of envelopes in one yield. Runtime consumes one item at a time.

### Mapping into #337

For each envelope item, Runtime builds `RuntimeAcceptedTransportEnvelope` exactly as polling does from `PollEvent`:

- `bindingId`, `adapterId`, `provider`, `configRef`, `target` from the inert binding
- `accountId`, `eventId`, `authenticatedRouting`, `payload` from the item
- `receivedAt` from the worker clock at accept time

Then calls existing `acceptTransportEnvelope({ store, namespace, envelope, now })`.

Conflict handling **reuses** polling rules in `pollAndAccept`:

- same-digest → duplicate, progressable
- digest conflict → progressable **only if** `transports.get` still returns durable evidence for that identity; otherwise fail the connection attempt without checkpointing past the failed item
- other accept errors → fail without advancing cursor past unaccepted work

## Cursor checkpoint rules

### When Runtime may write a cursor

| Item sequence | Checkpoint |
| --- | --- |
| Envelope without `cursor` | Accept only; leave durable cursor unchanged |
| Envelope with `cursor: C` | Accept envelope, **then** lease-fenced checkpoint `C` (with config identity) |
| Cursor-only `C` | Lease-fenced checkpoint `C` with no new accept |
| Partial accept failure mid-stream | Do not checkpoint any cursor that covers the failed or subsequent items; prior successful checkpoints remain |
| Abort / lease fence reject | No further accept or checkpoint; drop held lease on reject (same as polling) |

Because consumption is **strictly serial** (pull → accept/checkpoint → pull next), a cursor on item *n* is only written after items `1..n` that carried envelopes have been accepted. That is the Runtime guarantee that “all envelopes the cursor covers” are durable.

### Crash between accept and checkpoint

1. Envelope is durable; normalization/drain can proceed independently.
2. Cursor not advanced → reconnect/redelivery may yield the same event ids.
3. #337 deduplicates same-digest identities; Signal publication idempotency remains scoped as today.
4. This is **at-least-once** ingress with durable dedupe — same class of guarantee as polling crash between accept and `nextCursor` write.

### Config identity

Extend `RuntimeTransportBindingCheckpoint` **additively** (keep `schemaVersion: 1` for row compatibility; new optional fields default when absent):

```ts
export type RuntimeTransportBindingStatus =
  | "active"
  | "faulted"
  | "disabled";

export interface RuntimeTransportBindingCheckpoint {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly bindingId: string;
  readonly cursor: string | null;
  readonly updatedAt: string;
  /** Last supervised acquisition start (poll or stream open/reconnect). */
  readonly lastPolledAt?: string;
  readonly lastOwnerId?: string;
  readonly lastErrorCode?: string;
  readonly morePending?: boolean; // polling only; ignored for stream
  /**
   * Config identity under which `cursor` was produced.
   *
   * @remarks Required on every successful stream checkpoint write. When the
   * live binding `configRef` differs, Runtime treats the stored cursor as
   * invalid (over-invalidate) and does not inherit faulted status from the
   * prior config identity.
   */
  readonly configRef?: RuntimeTransportConfigRef;
  /**
   * Restart-safe supervision status.
   *
   * @remarks Omitted or `"active"` means eligible for acquisition. `"faulted"`
   * is set by terminal/exhaustion paths. `"disabled"` is reserved for operator
   * disablement; supervision skips both non-active statuses.
   */
  readonly status?: RuntimeTransportBindingStatus;
}
```

**Over-invalidate algorithm** (on lease acquisition / before open):

```
checkpoint = getBindingCheckpoint(binding)
if checkpoint is null → cursor = null, status = active
else if checkpoint.configRef missing OR checkpoint.configRef ≠ binding.configRef
  → effectiveCursor = null
  → do not treat prior faulted/disabled as binding under the new config
    (treat effective status as active for the new config identity)
else
  → effectiveCursor = checkpoint.cursor
  → if checkpoint.status is faulted|disabled → skip open (remain idle under lease or skip lease)
```

When writing any successful stream checkpoint, always persist `configRef: binding.configRef` and `status: "active"` (unless writing a fault transition).

Polling may leave `configRef` / `status` unset; readers default to active and no config check for polling-only paths. **Optional follow-through in the same PR:** polling checkpoint writes may also stamp `configRef` for consistency without changing poll interval semantics.

### PostgreSQL columns

Extend `transport_binding_checkpoints` with additive nullable columns (via `ADD COLUMN IF NOT EXISTS`):

- `config_ref_id text`
- `config_ref_revision text`
- `status text` — check/app-level: `active` | `faulted` | `disabled`

Required-column lists and encode/decode updated in the same change. No second checkpoint table.

## Lifecycle state machine

### Process-local connection state (not durable)

Per stream binding, while a worker holds the lease:

```
idle
  → leasing (claim/extend)
  → opening          (await open())
  → consuming        (for-await items)
  → accepting        (per envelope; sub-state of consuming)
  → checkpointing    (per cursor write; sub-state of consuming)
  → reconnect_wait   (bounded backoff after EOF or transient error)
  → faulted_local    (mirrors durable faulted; no open)
  → aborting         (signal aborted; return(); cleanup)
  → released         (lease released / dispose)
```

Durable status is only `active | faulted | disabled`. Process-local phase is for supervision, stats, and tests.

### Who runs when

Critical difference from polling: **a stream connection must not block the entire maintenance tick.**

| Actor | Responsibility |
| --- | --- |
| `createRuntimeWorker` tick | Serial: effect recovery → `transportSupervision.runOnce` → envelope drain |
| `runOnce` for stream bindings | Bounded: claim/extend leases; skip non-active durable status; start missing connection fibers; schedule reconnect timers; observe fiber health; never await unbounded item streams |
| Connection fiber (process-local) | `open` → iterate → accept → checkpoint → on EOF/error decide reconnect or fault; honor abort |
| `dispose` / worker stop | Abort parent signal; cancel reconnect timers; `iterator.return?.()`; await bounded fiber cleanup; release leases |

Fibers are **not** a second worker process or daemon. They are tasks owned by the existing supervision runner inside the one Runtime worker, analogous to held polling leases that span ticks.

### Transitions

1. **Acquire lease** → if durable status non-active under current config, skip open (may still hold or not hold lease; prefer skip claim when faulted/disabled to allow another operator process — implementation: do not claim, or claim only to refresh diagnostic `lastOwnerId`? **Decision: do not claim** when durable status is non-active under current config, so operators/tools are not blocked by a stuck lease. Record skip in run counters.)

   **Lease-safe ordering (implementation note):** `getBindingCheckpoint` is unfenced and the skip path performs no status/cursor write, so reading durable status and skipping open **before claim** is correct with the existing store. Writes (`faulted`, successful cursor+configRef checkpoints) remain lease-fenced after claim. Do not invent a second store or lease for the skip decision.
2. **Open** with `{ cursor: effectiveCursor, signal: leaseBoundSignal, configRef }`.
3. **Consume** one item at a time under pull backpressure.
4. **Clean EOF** → enter `reconnect_wait` with attempt++ and `retryDelayMs`-style full jitter; then open again from durable cursor (not from process-local memory of uncheckpointed progress).
5. **Transient throw / contract invalid** → close iterator if needed → `reconnect_wait` → open from durable cursor; increment consecutive failure counter.
6. **Terminal error** → write durable `status: "faulted"`, `lastErrorCode: safe code`, **do not advance cursor**, stop reconnect until config invalidation or operator clears status.
7. **Exhaustion** → after `MAX_STREAM_TRANSIENT_FAILURES` consecutive transient failures (constant, e.g. 32), write durable `faulted` with `lastErrorCode: "TRANSPORT_STREAM_EXHAUSTED"`. No array of errors stored.
8. **Abort** → abort signal, `return()`, bound cleanup, release lease on dispose; no checkpoint after fence reject.
9. **Successful accept+checkpoint after failures** → reset process-local consecutive failure counter and backoff attempt to 0.

### Reconnect backoff

Reuse the pure Runtime full-jitter helper semantics from `packages/core/src/runtime/engine/retry.ts` (`retryDelayMs`):

- Default base 1s, max delay **60s** for streams (stricter than work-outbox 1h; document constant `DEFAULT_STREAM_MAX_BACKOFF_MS = 60_000`).
- Process-local only: attempt number, next deadline, active timer.
- Not written to checkpoint.
- Jitter source injectable in tests (optional `rng` on internal options only — not public authoring).

### Clean EOF vs terminal completion

There is **no** “stream finished forever” success state in V1. Bindings are long-lived ingress. Clean EOF always reconnects while durable status is `active` and the worker holds the lease. Operators stop ingress by stopping the worker, removing the binding from the program, or setting durable `disabled` / `faulted`.

## Error model

### Transient (default)

Any throw from `open`, the async iterator, or Runtime accept path that is **not** classified terminal:

- Close current connection (best-effort `return()`).
- Do not advance cursor past unaccepted work.
- Record safe `lastErrorCode` when available (same ASCII `[A-Za-z0-9_.-]{1,64}` rule as polling) on checkpoint **without** changing cursor, status remains `active`.
- Backoff and reconnect.

AbortError / aborted signal → **not** a failure counter increment; treated as abort path.

### Terminal

Minimal public shape:

```ts
/**
 * Non-reconnectable stream failure.
 *
 * @remarks Runtime sets durable checkpoint status to `faulted` and stops
 * automatic reconnect until config identity changes or an operator clears
 * status. Prefer a stable secret-free `code`.
 */
export class ManagedStreamTerminalError extends Error {
  readonly code: string;
  readonly terminal: true;
  constructor(code: string, message?: string);
}
```

Classification also accepts a duck-typed object:

```ts
error && typeof error === "object"
  && (error as { terminal?: unknown }).terminal === true
  && typeof (error as { code?: unknown }).code === "string"
  && SAFE_PROVIDER_ERROR_CODE.test(code)
```

Unsafe or missing codes fall back to `TRANSPORT_STREAM_TERMINAL`.

### Observability of exhaustion/fault without history

Durable fields only:

- `status`
- `lastErrorCode` (single code, overwritten)
- `updatedAt` / `lastPolledAt`

Process-local (lost on restart, acceptable for diagnostics):

- consecutive transient failures
- current backoff attempt / delay
- connection phase

## Abort, lease fence, and shutdown

Mirror and extend `createLeaseBoundPollSignal`:

1. Parent worker `AbortSignal` aborts derived stream signal.
2. Lease `expiresAt` aborts derived stream signal.
3. On abort: call `iterator.return?.()` if the iterator is open; bound the await (reuse stop timeout discipline — document internal bound, e.g. same order as poll cleanup; no unbounded hang on bad adapters).
4. `putBindingCheckpoint` remains lease-fenced; reject → `leaseLost`, drop held lease, no further accepts on that generation.
5. Worker `stop` → `recoveryAbort.abort()` → `transportSupervision.dispose()` which aborts fibers and releases stream + polling leases (already wired for polling).

Competing workers: only the lease holder runs a connection fiber. Loser skips. After lease expiry, another worker may claim and open from durable cursor.

## Backpressure

- Runtime pulls the next iterator item only after finishing accept/checkpoint work for the previous item (or deciding the previous item needed no checkpoint).
- Adapters that are push-based **must** buffer only within an adapter-chosen bound and then fail the connection (transient throw) rather than drop events. This PR’s reference `stream({ open })` surface is pull/`AsyncIterable`; the rule is documented for future WS helpers.
- No silent event loss at the Runtime seam.

## Future SSE / WebSocket mapping (paper + types only)

### SSE (follow-on adapter sketch)

| SSE concern | Seam mapping |
| --- | --- |
| Connect / `Last-Event-ID` | `open({ cursor })` passes durable cursor; adapter sets `Last-Event-ID` |
| `event:` / `data:` | Yield `kind: "envelope"` with stable `eventId` and payload |
| `id:` without data | Yield `kind: "cursor", cursor: id` |
| Stream HTTP end | Iterator returns → Runtime reconnect/backoff |
| 401/403 revoked | Throw `ManagedStreamTerminalError("AUTH_REVOKED")` |
| Network blip | Throw ordinary error → transient reconnect |

SSE helper would live outside core or as a thin package helper later; it only implements `open`.

### WebSocket (follow-on adapter sketch)

| WS concern | Seam mapping |
| --- | --- |
| Connect + subscribe | Inside `open` |
| Each message | One or more sequential yields of `StreamItem` (still one item per yield) |
| Push overflow | Bounded buffer; on overflow close socket and throw transient (reconnect) — never drop |
| Server ping / seq advance | Cursor-only items |
| Protocol requires client ack **after durable accept** | **Reserved** additive API (below); not implemented now |
| Auth revoked close code | Terminal error |

### Reserved post-accept notification (do not implement)

Some WebSocket protocols require an application ack only after the consumer has durably accepted the message. This PR **reserves** room for an additive, optional mechanism, for example:

```ts
// FUTURE — not part of this PR’s public surface; names not frozen.
interface StreamEnvelopeItemV2 extends StreamEnvelopeItem {
  /** Optional correlation for post-accept adapter notification. */
  readonly ackToken?: string;
}

// Possible Runtime → adapter callback, optional on StreamTransport:
// onEnvelopeAccepted?(info: { ackToken: string; eventId: string }): void | Promise<void>
```

Rules for any future design:

- Notification fires **only after** #337 durable accept (or duplicate).
- Never required for SSE or generic streams.
- Must not block the pull loop without a timeout.
- Must not be implemented or mandated in this PR.

## Observability

### Reuse existing envelope stats

`transportStatistics()` totals (`accepted`, `deduplicated`, `normalized`, `delivered`, `retried`, `deadLettered`) already cover stream-accepted envelopes once they enter #337. No parallel metrics store.

### Binding health

Prefer extending checkpoint + process-local supervision counters rather than new ledger fact kinds unless Devtools already requires them:

| Fact | Source |
| --- | --- |
| cursor, cursor age (`now - updatedAt`) | Durable checkpoint |
| status faulted/disabled/active | Durable checkpoint |
| lastErrorCode | Durable checkpoint |
| lease owner | Lease port / `lastOwnerId` diagnostic |
| reconnect attempt, backoff delay, phase | Process-local (best-effort; may be absent after restart) |
| accepted/deduped on this fiber | Existing envelope stats + optional runOnce counters |

### Devtools / Runtime Bridge

**Honest scope:** if the current Devtools Catalog / Runtime Bridge read model only surfaces provider + inert binding evidence (as with polling today) and not live reconnect phase, **do not invent a second live telemetry bus in this PR**. Document:

- Catalog: transport kind `stream`, binding id, config ref, provider lineage (Project Index).
- Operator envelope projection: existing `projectTransportEnvelope()`.
- Live reconnect gauges: only if an existing bridge resource can carry checkpoint status without new architecture; otherwise defer to a follow-on with an explicit read-model extension.

### Supervision run counters

Extend `TransportSupervisionRunResult` carefully (additive fields):

```ts
// additive optional or new fields with zeros for polling-only runs
readonly streamOpened?: number;
readonly streamReconnected?: number;
readonly streamFaulted?: number;
```

Or keep polling fields and add a nested `stream: { ... }` object. Prefer additive top-level counters with defaults `0` for minimal churn.

## Project Index, LSP, lint

| Change | Detail |
| --- | --- |
| `SignalTransportFacts.transportKind` | Add `"stream"` |
| `SignalProviderFacts.transportKind` | Add `"stream"` |
| Static extractor | `extractStreamStaticFacts` parallel to polling; `hasOpen: boolean` |
| Primitive manifest | Register `stream` call extract; native parity fixtures |
| Live fields | Add `open` to `SIGNAL_TRANSPORT_BINDING_LIVE_FIELDS` |
| Lint | Reject live `open` on inert bindings; unstable identities unchanged |
| Cache epochs | Bump static/semantic/compiler and Go snapshot epochs when output changes for unchanged source (same discipline as polling) |

Semantic/native: stream authoring is a call with a function property — same class as `polling` / `webhook`. Update parity fixtures even if semantic evidence is identity/kind only.

## RuntimeProgram / worker integration

1. Inert bindings remain kind-agnostic data; **kind lives on the live provider transport**, discovered via `resolveProgramProvider` + `isStreamTransport` / `isPollingTransport` (same pattern as polling filter in `createWorkerTransportSupervision`).
2. Supervision constructs when **any** polling **or** stream binding resolves.
3. Checkpoint capability check required for both.
4. Worker docs/JSDoc: “supervises polling and stream bindings”.
5. No program JSON schema change beyond whatever index generation already emits for transports.

## Module layout (implementation target)

Prefer small focused files (issue prefers &lt;300 lines production; hard max 1000):

| File | Role |
| --- | --- |
| `signal/transport/stream.ts` | Authoring types + `stream()` |
| `signal/transport/index.ts` | Union + exports |
| `signal/provider/signal-provider.ts` | Accept stream transport; `isStreamTransport` |
| `runtime/transport/binding-checkpoint.ts` | `status`, `configRef` fields + constants |
| `runtime/transport/stream-errors.ts` | `ManagedStreamTerminalError` + classifiers |
| `runtime/worker/worker-transport-stream.ts` | Connection fiber: open/iterate/accept/checkpoint/reconnect |
| `runtime/worker/worker-transport-stream-signal.ts` | Lease-bound abort (may share helpers with poll signal) |
| `runtime/worker/worker-transport-supervision.ts` | Filter stream bindings; start/stop fibers; counters |
| Memory + Postgres transport adapters | Encode/decode new checkpoint fields; DDL columns |
| Indexer signal extractors + findings | `stream` facts and live `open` |
| Docs under `apps/docs/...` | Progressive guide/reference/architecture |
| `.changeset/reactive-durable-execution.md` | Append stream supervision note (minor) |

## Testing strategy

### Layers

1. **Unit / contract** — `stream()` freeze, validation, terminal error classification, cursor validation, item contract.
2. **Supervision (Memory)** — open → envelope accept → checkpoint with configRef; cursor-only; EOF reconnect; transient backoff; terminal fault durable; config invalidation; abort/shutdown; lease fence reject; competing supervisor.
3. **Worker integration** — `createRuntimeWorker` with stream provider; normalize through existing drain; restart resume; stop aborts connection.
4. **PostgreSQL** — checkpoint columns, lease fence, worker restart, multi-worker claim exclusivity.
5. **Conformance** — extend transport store conformance or add stream-supervision conformance factory shared by Memory/Postgres (mirror polling tests).
6. **Indexer** — static + native parity for `stream()`; lint live `open`.
7. **Type tests** — `SignalProviderTransport` includes stream; inert binding rejects capturing open at type level where practical.

### Sequential / OOM discipline

- One focused vitest file group per commit stage.
- Prefer fake async iterables over real sockets.
- No parallel multi-worker stress that opens large process matrices in one file.
- Cap events per test (similar to `MAX_EVENTS_PER_POLL = 64` for polling; stream tests use small finite iterators).

### Constants to introduce

| Constant | Intent |
| --- | --- |
| `MAX_TRANSPORT_BINDING_CURSOR_BYTES` | Reuse |
| `DEFAULT_STREAM_BASE_BACKOFF_MS` | 1_000 |
| `DEFAULT_STREAM_MAX_BACKOFF_MS` | 60_000 |
| `MAX_STREAM_TRANSIENT_FAILURES` | 32 (durable fault after consecutive transients) |
| Internal cleanup await bound | Document; align with worker stop order of magnitude |

## Documentation plan (same PR, progressive)

| Doc | Update |
| --- | --- |
| Guide `signals/providers.mdx` | Stream path beside polling; lifecycle table |
| Reference `providers-and-transports.mdx` | `stream({ open })`, StreamItem table, terminal error, checkpoint status |
| Recipes | One minimal async generator provider |
| `packages/core/src/signal/ARCHITECTURE.md` | Stream fiber + checkpoint config/status |
| Operator notes | Faulted restart behavior; config revision invalidation |

## Changeset

Update **existing** `.changeset/reactive-durable-execution.md` only. Append a concise user-facing note that managed stream supervision lands on the same Runtime worker / transport store as polling (public `stream({ open })`, durable cursor+config checkpoint, reconnect/fault semantics). Packages: at least `@use-crux/core`, `@use-crux/postgres`, `@use-crux/indexer` (and `@use-crux/local` if Go epoch bumps). Keep **minor**. Do not add a duplicate changeset file.

## Audit notes (ambiguity resolved against code)

1. **No second accept API** — stream uses `acceptTransportEnvelope` unchanged.
2. **No second lease resource scheme** — same `transport-binding:{namespace}:{bindingId}`.
3. **Checkpoint schemaVersion stays 1** with additive fields; avoids forcing envelope schema churn.
4. **Polling batching stays** — stream does not change `PollResult.events[]`; different authoring mode by design.
5. **Worker tick must stay bounded** — stream fibers are mandatory for correctness of the one-worker model.
6. **Webhook remains host-edge** — stream does not replace edge HTTP acceptance.
7. **`lastPolledAt` name retained** as last acquisition timestamp for both poll and stream to avoid a breaking rename; docs clarify meaning.
8. **Devtools honesty** — do not invent live reconnect UI without read-model support; Project Index + checkpoint fields are the minimum.
9. **Disabled status** — durable value reserved; this PR’s automatic paths write `faulted` / `active`. Tests may write `disabled` via store to prove skip behavior.
10. **Channel semantics** — out of scope; Signal fan-out via existing provider `onEvent` only.

## Success criteria (implementation complete)

- [ ] `stream({ open })` authorable and accepted by `signalProvider`
- [ ] Memory + PostgreSQL: accept, checkpoint with configRef, restart, competing lease, shutdown abort
- [ ] EOF reconnect with backoff; terminal → durable faulted; config change invalidates cursor
- [ ] Crash between accept and checkpoint redelivers with dedupe
- [ ] No second worker/daemon/registry
- [ ] Indexer/lint/epochs updated; docs progressive; changeset updated
- [ ] SSE/WS not implemented; mapping documented; ack reserved only
