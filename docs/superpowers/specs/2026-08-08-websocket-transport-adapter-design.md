# WebSocket transport adapter — design

Status: **accepted for implementation**

Parent: [use-crux/crux#340](https://github.com/use-crux/crux/issues/340)
Depends on: generic managed stream transport (#392) and SSE thin adapter (#393)
Baseline: `stream({ open })`, `sse({ open })`, Memory/Postgres lease-fenced checkpoints, stream fiber reconnect/exhaustion, Project Index live `open` lint

## Summary

This design adds the **smallest useful first-party WebSocket authoring adapter** for Signal provider **ingress**. Authors declare `websocket({ open })` beside `webhook()`, `polling()`, `stream()`, and `sse()`. Construction freezes a distinct transport definition (`_tag: "WebSocketTransport"`, `kind: "websocket"`) and **lowers** the WebSocket authoring protocol to the existing managed stream protocol. The single Runtime worker reuses one stream fiber, one lease/checkpoint port, one envelope kernel (#337), and the same reconnect / fault / abort / restart laws.

Core never owns `WebSocket`, browser/Node socket factories, wire codecs, credentials, or ping/pong timers. The adapter author's `open` closure connects, authenticates, subscribes, parses frames, and yields small `WebSocketItem` values under Runtime pull backpressure. A pure lowerer maps those items to `StreamItem` before Runtime accept/checkpoint.

## Goals

1. Public authoring API: `websocket({ open })` on `@use-crux/core/signal/transport`, accepted by `signalProvider({ transport })`.
2. Distinct provider transport definition (`kind: "websocket"`) for Catalog, Project Index, docs, and type narrowing.
3. Lower exactly onto the #392 managed stream seam (same fiber, lease, checkpoint, accept-before-cursor, reconnect, fault, config invalidation, abort).
4. Ordinary receive-only WebSocket use stays as simple as stream/SSE: yield envelope/cursor items only.
5. Optional **post-accept acknowledgement** that runs only after Crux has durably accepted the envelope (and checkpointed its cursor when present). Ack failure is observable and never pretends acceptance failed or silently loses replay safety.
6. Bounded push buffering helper: never unbounded, never silent drop; overflow fails the connection so reconnect resumes from the durable cursor.
7. Pure close-code classification helpers so adapters map terminal vs transient without Core owning sockets.
8. Indexer static/native parity, Catalog kind projection, progressive docs, and append to `.changeset/reactive-durable-execution.md`.

## Non-goals

- A second worker, daemon, store, scheduler, registry, lease type, supervisor, reconnect loop, or checkpoint schema.
- Runtime-owned WebSocket client, browser/Node socket factory, ping/pong scheduler, credential storage, or live sockets on inert bindings / program JSON.
- Channel exclusive conversation ownership (#302).
- Major changeset.
- Changing Memory/Postgres restart/lease/shutdown laws (reuse only).

## Why `websocket()` is not a zero-value alias of `stream()`

| Value | What `websocket()` provides |
| --- | --- |
| Kind / tooling | Distinct `kind: "websocket"` for Project Index, Devtools Catalog, LSP, and operator docs |
| Optional post-accept ack | First-class authoring field that lowers onto the shared stream envelope seam |
| Push-buffer helper | Documented bounded queue for push sockets (overflow → reconnect, never drop) |
| Close-code guidance | Pure `classifyWebSocketCloseCode` / error-code helpers |
| Docs boundary | Progressive guide that separates provider-ingress WebSocket from browser/devtools sockets |

If an adapter already speaks `StreamItem` and needs no ack, authors may keep using `stream({ open })` directly.

## Binding constraints from current main

Do not invent parallel kernels:

| Surface | Contract (reuse) |
| --- | --- |
| Open context | `{ cursor, signal, configRef }` |
| Item protocol | One envelope **or** cursor-only item per yield |
| Cursor law | Envelope cursor only after durable #337 accept (or same-digest duplicate) |
| Terminal errors | `ManagedStreamTerminalError` → durable `faulted` |
| Transient | Ordinary throw / clean EOF → reconnect with backoff |
| Supervision | Managed-stream fiber after pure lowering |
| Inert binding | Never captures `open`, sockets, or ack closures |

## Smallest exact acknowledgement seam

### Decision

Add an **optional process-local** `acknowledge?: () => void | Promise<void>` field on:

1. `WebSocketEnvelopeItem` (authoring vocabulary)
2. `StreamEnvelopeItem` (shared managed-stream protocol Runtime already pulls)

Runtime invokes `acknowledge` **only after**:

1. Durable #337 accept **or** same-digest duplicate for that envelope, and
2. When the item carries a `cursor`, a successful lease-fenced cursor checkpoint for that item (or checkpoint skipped because the store port is absent).

### Why this shape (not tokens + transport-level callback)

| Alternative | Why rejected |
| --- | --- |
| Mandatory ack API on all streams | Breaks simple receive-only and SSE |
| `ackToken` + `onEnvelopeAccepted` map on transport | Larger surface; correlation bookkeeping for no gain when the item is still process-local |
| Ack before durable accept | Unsafe: provider could treat undurable progress as done |
| Ack failure rolls back accept/cursor | Violates #337 commit semantics and loses replay safety |

Process-local functions on live items are acceptable for the same reason `open` is live process code: they never enter inert `RuntimeManagedTransportBinding` / program JSON.

### Acknowledgement failure law

When `acknowledge` throws/rejects after durable progress:

1. **Acceptance remains accepted** (or remains a same-digest duplicate).
2. **Cursor remains at the checkpointed position** (never cleared, never rolled back).
3. Failure is **observable**: write `lastErrorCode` (prefer safe provider code, else `TRANSPORT_ACK_FAILED`) on an **active** checkpoint.
4. Connection outcome is **transient** so the fiber reconnects and resumes from the durable cursor; provider redelivery is #337-deduped.
5. Abort during acknowledge is cooperative abort, not ack failure.

This never pretends acceptance failed and never silently loses replay safety.

## WebSocket → generic stream mapping

| WS concern | Seam mapping |
| --- | --- |
| Connect + subscribe | Inside adapter `open` |
| Each application message | One envelope item (optional `cursor`, optional `acknowledge`) |
| Heartbeat / seq advance without payload | Cursor-only item |
| Push faster than Runtime pull | Bounded adapter buffer; overflow → close socket + throw transient |
| Server ping/pong | Adapter-owned; never yield wire control frames as envelopes |
| Clean close (e.g. 1000) | Iterator returns → Runtime reconnect/backoff |
| Auth / permanent policy close | `ManagedStreamTerminalError` |
| Network blip / abnormal close | Ordinary throw → transient reconnect |
| Abort / lease loss | Honor `signal`; close socket; `iterator.return()` cleanup |

## Public authoring API (sketch)

```ts
websocket({ open }): WebSocketTransport
// open(context) => AsyncIterable<WebSocketItem>
// WebSocketItem = envelope | cursor (cursor field, optional acknowledge on envelope)

lowerWebSocketItem(item): StreamItem
lowerWebSocketOpen(open): StreamOpen

classifyWebSocketCloseCode(code): "normal" | "transient" | "terminal"
webSocketCloseErrorCode(code): string

createBoundedPushBuffer<T>({ capacity, signal }): BoundedPushBuffer<T>
```

## Implementation notes

- Supervision: `isManagedStreamTransport` includes WebSocket; fiber boundary lowers with `lowerWebSocketOpen` exactly like SSE.
- `isStreamTransport` stays pure `_tag: "StreamTransport"`.
- Indexer: `signal.transport.websocket`, `transportKind: "websocket"`, live `open` lint unchanged.
- No new stats ledger kinds; reuse envelope stats + binding checkpoints.
- Cache: bump `STATIC_PARSE_CACHE_EPOCH` for new static producer facts.
