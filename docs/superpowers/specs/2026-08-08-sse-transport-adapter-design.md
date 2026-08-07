# SSE transport adapter — design

Status: **accepted for implementation** (spec/plan phase only; no production code in this commit)

Parent: [use-crux/crux#340](https://github.com/use-crux/crux/issues/340)
Depends on: generic managed stream transport (#392, merged on main as `feat(runtime): supervise managed stream transports`)
Baseline on main: `stream({ open })`, Memory/Postgres lease-fenced checkpoints (`configRef`, `status`), stream fiber reconnect/exhaustion, Project Index `transportKind: "stream"` / live `open` lint

## Summary

This design adds the **smallest useful first-party SSE authoring adapter** for Signal provider **ingress**. Authors declare `sse({ open })` beside `webhook()`, `polling()`, and `stream()`. Construction freezes a distinct transport definition (`_tag: "SseTransport"`, `kind: "sse"`) and **lowers** the SSE authoring protocol to the existing managed stream protocol. The single Runtime worker reuses one stream fiber, one lease/checkpoint port, one envelope kernel (#337), and the same reconnect / fault / abort / restart laws.

Core never owns `fetch`, `EventSource`, wire-frame parsing, credentials, or HTTP clients. The adapter author's `open` closure connects, authenticates, parses SSE, and yields small `SseItem` values. A pure lowerer maps those items to `StreamItem` before Runtime accept/checkpoint.

## Goals

1. Public authoring API: `sse({ open })` on `@use-crux/core/signal/transport`, accepted by `signalProvider({ transport })`.
2. Distinct provider transport definition (`kind: "sse"`) for Catalog, Project Index, docs, and type narrowing — not a zero-value alias of `stream()`.
3. Lower exactly onto the #392 managed stream seam: same worker fiber, lease, checkpoint, accept-before-cursor, reconnect, fault, config invalidation, and abort semantics.
4. SSE authoring vocabulary uses `lastEventId` (wire `Last-Event-ID` / event `id:`) while durable Runtime checkpoints remain the generic cursor contract.
5. One event per item; no batching; no Runtime byte parsing; no extra buffering beyond adapter-owned bounded parser state.
6. Pure, secret-free helpers classify HTTP connect/auth failures as terminal vs transient **without** Core importing provider SDKs or owning HTTP.
7. Ship authoring/JSDoc/type inference, adapter-boundary tests plus one end-to-end tracer through existing Memory stream supervision, Indexer static/native/lint parity as required, Catalog kind projection, progressive docs, and an append to the existing minor changeset `.changeset/reactive-durable-execution.md`.

## Non-goals

- A second worker, daemon, store, scheduler, registry, lease type, supervisor, reconnect loop, or checkpoint schema.
- Runtime-owned `fetch`, `EventSource`, SSE frame parser, credential storage, or header maps on inert bindings / program JSON.
- WebSocket adapter (follow-on child of #340).
- Post-accept ack API (reserved on the generic stream design; not required for SSE).
- New stats ledger fact kinds or live Devtools reconnect gauges beyond existing generic stream observation.
- Changing Memory/Postgres restart/lease/shutdown laws (reuse only).
- `@use-crux/react` browser SSE (`createSSETransport` / `cruxSSEHandler`) — opposite direction; do not share types or supervision.
- Major changeset.

## Why `sse()` is not a zero-value alias

`stream({ open })` is already a complete managed ingress protocol. A bare rename would not justify a new export. `sse()` is justified only because it adds **all** of the following with minimal surface:

| Value | What `sse()` provides |
| --- | --- |
| Vocabulary | Authoring uses `lastEventId` instead of generic `cursor` on items, matching SSE wire resume (`Last-Event-ID` / `id:`) |
| Kind / tooling | Distinct `kind: "sse"` for Project Index, Devtools Catalog, LSP, and operator docs |
| HTTP failure guidance | Pure `classifySseHttpStatus` / error-code helpers so adapters map 401/403/etc. to terminal vs transient without Core knowing SDKs |
| Docs boundary | Progressive guide/recipe/reference that separates **provider-ingress SSE** from **React browser SSE** |

If an adapter already speaks `StreamItem`, authors may keep using `stream({ open })` directly. Prefer `sse()` when the external system is SSE and tooling/docs should say so.

**Decision:** Keep a thin `SseItem` shape (isomorphic to `StreamItem` with `lastEventId` instead of `cursor`). Do **not** invent a second lifecycle, second item batch shape, or Runtime wire parser.

## Binding constraints from current main (#392)

These contracts already ship and this design **extends** them; it must not invent parallel kernels.

| Surface | Current contract (do not break) |
| --- | --- |
| Authoring | `stream({ open })` → `StreamTransport` `{ _tag: "StreamTransport", kind: "stream", open }` |
| Open context | `{ cursor, signal, configRef }` — durable cursor or `null`; lease-bound abort; secret-free config identity |
| Item protocol | `StreamItem` = envelope **or** cursor-only; one item per yield |
| Cursor law | Envelope cursor checkpoint only after durable #337 accept (or same-digest duplicate / progressable conflict with evidence) |
| Terminal errors | `ManagedStreamTerminalError` / duck-typed `{ terminal: true, code }` → durable `status: "faulted"` |
| Transient | Default for other throws; clean iterator EOF → reconnect with bounded backoff |
| Checkpoint | Additive `configRef` + `status` on `RuntimeTransportBindingCheckpoint` schemaVersion `1` |
| Supervision | `createWorkerTransportSupervision` filters `isPollingTransport \|\| isStreamTransport`; stream fibers via `startStreamFiber` / `runManagedStream` |
| Inert binding | `RuntimeManagedTransportBinding` pure data only; never captures `open` |
| Indexer | `transportKind: "webhook" \| "polling" \| "stream"`; live fields include `open` |
| Catalog | Devtools shows `facts.transportKind` for providers |

### Reviewed SSE → generic stream mapping (binding)

| SSE concern | Generic stream seam |
| --- | --- |
| Connect / resume | `open({ cursor, signal, configRef })`; adapter sends `Last-Event-ID: cursor` when `cursor` is non-null |
| One `data:` event | One envelope item (authenticated routing + payload + stable `eventId`) |
| Event `id:` / Last-Event-ID after that event | Item field `lastEventId` → lowered `StreamItem.cursor` (post-item progress) |
| Comment/heartbeat with a genuine new resume id | Cursor-only item with `lastEventId` |
| Comment/heartbeat with no new resume position | Do not yield (or yield nothing new); no fake cursor advance |
| HTTP stream EOF / clean body end | Iterator returns → Runtime reconnect/backoff |
| Network blip / 5xx / 429 after open starts | Throw ordinary error → transient reconnect |
| 401 / 403 / permanent auth or endpoint revocation | Throw `ManagedStreamTerminalError` (helper-suggested codes) → durable `faulted` |
| Abort | Runtime `AbortSignal` cancels connection/reader; adapter honors signal; `iterator.return()` cleanup |
| Pull backpressure | Serial `for await` on the stream fiber; no Runtime buffer |
| Post-accept ack | Not part of SSE; do not add |

## Public authoring API

Module: `@use-crux/core/signal/transport` (new `sse.ts`, re-export through `index.ts`).

**Name collision note:** This is **provider ingress** SSE for Signal transports. It is unrelated to:

- LLM generation `stream()` helpers
- `@use-crux/react` `createSSETransport` / `cruxSSEHandler` (browser RecordStore subscription **egress**)

Docs and JSDoc must say “managed SSE transport” / “provider-ingress SSE” where ambiguity is likely.

```ts
import type { JsonValue } from "@use-crux/core/storage";
import type {
  RuntimeAcceptedTransportPayload,
  RuntimeTransportConfigRef,
} from "@use-crux/core/runtime";
import type { StreamOpenContext } from "@use-crux/core/signal/transport";

/**
 * Context for one supervised SSE connection.
 *
 * @remarks Same shape as {@link StreamOpenContext}. `cursor` is the durable
 * Last-Event-ID resume value (or `null` when none / config invalidates).
 * Adapters map it to the HTTP `Last-Event-ID` request header when connecting.
 * Live credentials and clients stay inside the adapter closure; `configRef`
 * is secret-free identity only.
 */
export type SseOpenContext = StreamOpenContext;

/**
 * One authenticated SSE event, ready for durable accept after lowering.
 *
 * @remarks `lastEventId` is progress **through this event inclusive**
 * (wire `id:` / Last-Event-ID after the event). Omitted means no new resume
 * position from this item. `null` clears the durable resume position only when
 * the provider truly has none.
 */
export interface SseEnvelopeItem {
  readonly kind: "envelope";
  readonly accountId: string;
  readonly eventId: string;
  readonly authenticatedRouting: Readonly<Record<string, JsonValue>>;
  readonly payload: RuntimeAcceptedTransportPayload;
  readonly lastEventId?: string | null;
}

/**
 * Resume progress without a new envelope (heartbeat / id-only advance).
 *
 * @remarks Yield only when the adapter has a genuine new Last-Event-ID.
 * Must never cover unyielded events (adapter contract violation).
 */
export interface SseCursorItem {
  readonly kind: "cursor";
  readonly lastEventId: string | null;
}

/** Exactly one protocol item per yield. Do not batch. */
export type SseItem = SseEnvelopeItem | SseCursorItem;

/**
 * Open one SSE connection and yield items under Runtime pull backpressure.
 *
 * @remarks The adapter owns HTTP/EventSource/parser/auth. Must honor `signal`.
 * Clean iterator completion is disconnect, not terminal binding success.
 * Throw ordinary errors for transient failure; throw
 * {@link ManagedStreamTerminalError} (or duck-typed `{ terminal: true, code }`)
 * for non-reconnectable faults such as revoked credentials.
 */
export type SseOpen = (
  context: SseOpenContext,
) => AsyncIterable<SseItem> | Promise<AsyncIterable<SseItem>>;

export interface SseOptions {
  readonly open: SseOpen;
}

/**
 * Distinct SSE transport definition that lowers to the managed stream protocol.
 *
 * @remarks Frozen and free of credentials. Runtime supervision treats this as
 * a managed-stream binding after pure item lowering. `open` remains the
 * SSE-shaped authoring handle; fibers never receive wire bytes.
 */
export interface SseTransport {
  readonly _tag: "SseTransport";
  readonly kind: "sse";
  readonly open: SseOpen;
}

export function sse(options: SseOptions): SseTransport;
```

### Union membership and narrowing

```ts
export type SignalProviderTransport =
  | WebhookTransport
  | PollingTransport
  | StreamTransport
  | SseTransport;

export function isSseTransport(
  transport: SignalProviderTransport,
): transport is SseTransport;

/** True for generic stream or SSE (both use the stream fiber path). */
export function isManagedStreamTransport(
  transport: SignalProviderTransport,
): transport is StreamTransport | SseTransport;
```

`signalProvider` validation accepts `_tag: "SseTransport"` with a function `open`, parallel to stream. Error text lists `webhook()`, `polling()`, `stream()`, or `sse()`.

`isStreamTransport` remains **only** `_tag: "StreamTransport"` (no silent widening). Supervision uses `isManagedStreamTransport` (or explicit `isStreamTransport || isSseTransport`).

### Construction rules

- `open` must be a function; otherwise `TypeError`.
- Definition is frozen, performs no I/O, and does not register globally.
- Inert `managedTransportBinding()` never captures `open` (live-field lint already lists `open`).
- Optional pure helpers exported from the same module (or a sibling file re-exported through the transport barrel):
  - `lowerSseItem(item: SseItem): StreamItem` (and validation)
  - `lowerSseOpen(open: SseOpen): StreamOpen`
  - `classifySseHttpStatus(status: number): "terminal" | "transient"`
  - `sseHttpStatusErrorCode(status: number): string` (safe durable codes)

### Example (illustrative; adapter owns fetch)

```ts
import { sse, classifySseHttpStatus, ManagedStreamTerminalError } from "@use-crux/core/signal/transport";
// ManagedStreamTerminalError is exported from runtime; re-export or import path as shipped today.
import { signalProvider } from "@use-crux/core/signal/provider";

export const ordersSse = signalProvider({
  id: "orders.sse",
  transport: sse({
    async *open({ cursor, signal, configRef }) {
      const response = await connectOrdersSse({
        lastEventId: cursor,
        signal,
        configRef,
      });

      if (!response.ok) {
        const kind = classifySseHttpStatus(response.status);
        if (kind === "terminal") {
          throw new ManagedStreamTerminalError(
            sseHttpStatusErrorCode(response.status),
            `SSE connect rejected with HTTP ${response.status}`,
          );
        }
        throw new Error(`SSE connect transient HTTP ${response.status}`);
      }

      for await (const frame of parseSse(response.body, signal)) {
        if (frame.kind === "comment" && frame.id) {
          yield { kind: "cursor", lastEventId: frame.id };
          continue;
        }
        if (frame.kind === "event") {
          yield {
            kind: "envelope",
            accountId: frame.accountId,
            eventId: frame.eventId,
            authenticatedRouting: { source: "sse", eventType: frame.eventType ?? "message" },
            payload: frame.payload,
            lastEventId: frame.id ?? undefined,
          };
        }
      }
    },
  }),
  signals: { orderSubmitted },
  async onEvent(envelope, { signals }) {
    await signals.orderSubmitted.publish(map(envelope));
  },
});
```

`connectOrdersSse` / `parseSse` are **userland or future package helpers**, not Core Runtime.

## Lowering semantics

### Item map

| `SseItem` | `StreamItem` |
| --- | --- |
| `{ kind: "envelope", accountId, eventId, authenticatedRouting, payload, lastEventId? }` | `{ kind: "envelope", accountId, eventId, authenticatedRouting, payload, cursor: lastEventId? }` — omit `cursor` when `lastEventId` was omitted |
| `{ kind: "cursor", lastEventId }` | `{ kind: "cursor", cursor: lastEventId }` |

### Validation

1. Validate/lower through the **canonical** stream cursor contract (`validateStreamCursor` / `MAX_TRANSPORT_BINDING_CURSOR_BYTES`, non-empty trimmed, no ASCII controls).
2. Prefer one path: either `lowerSseItem` builds a candidate object and calls `validateStreamItem`, or validates SSE fields then constructs a frozen `StreamItem` with the same rules. Do not fork a second cursor byte limit.
3. Missing/unknown `kind`, bad identifiers, bad routing/payload → same class of contract violation as stream (`TRANSPORT_STREAM_CONTRACT_INVALID`), treated as **transient** connection failure by the existing fiber (unless the adapter throws terminal first).
4. One item per yield; arrays/batches reject.

### Where lowering runs

**Decision:** Lower at the **supervision → fiber boundary**, not inside Runtime accept, and not by making Runtime parse SSE bytes.

```text
signalProvider.transport: SseTransport
  → createWorkerTransportSupervision recognizes isSseTransport
  → lowerSseOpen(transport.open) produces StreamOpen
  → startStreamFiber({ transport: stream({ open: lowered }) })  // or structural StreamTransport
  → runManagedStream / runStreamConnection unchanged
```

Implications:

- `runStreamConnection` keeps `transport: StreamTransport` and continues to call `transport.open` expecting `StreamItem`.
- No second fiber module, no SSE branches in accept/checkpoint.
- Pure `lowerSseItem` / `lowerSseOpen` are unit-tested without stores.
- Construction does **not** eagerly open connections; lowering wraps the function only.

Alternatively, wrap once at `sse()` construction and store both tags — **rejected**: hiding a second `StreamTransport` on the public object risks Catalog/indexer confusion and dual `open` shapes. Prefer explicit lower at supervision start (or a single internal helper used only by supervision + tests).

### Open context

Reuse `StreamOpenContext` as `SseOpenContext`. Do **not** rename the context field to `lastEventId` at the Runtime boundary: durable checkpoints, config invalidation, and fiber open already speak `cursor`. JSDoc on `SseOpenContext` states that `cursor` **is** the Last-Event-ID resume value for SSE adapters.

## Error, abort, and HTTP classification

### Reuse generic stream error model

| Adapter behavior | Runtime effect (existing #392) |
| --- | --- |
| Clean iterator return | EOF reconnect with process-local backoff |
| Ordinary throw | Transient reconnect; optional safe `lastErrorCode`; cursor not advanced past unaccepted work |
| `ManagedStreamTerminalError` / `{ terminal: true, code }` | Durable `faulted`; no automatic reconnect until config identity changes or operator clears status |
| AbortError / aborted signal | Abort path; not a transient failure counter increment |
| Contract-invalid lowered item | Transient (existing stream contract path) |

### Pure HTTP status helper (no fetch)

Core may export a **pure** classifier used by adapters after they observe a connect response status. Core does not perform the request.

Recommended mapping (document in JSDoc + reference docs; implement as a single switch/table):

| HTTP status | Classification | Suggested durable `code` (safe pattern) |
| --- | --- | --- |
| 401 Unauthorized | terminal | `SSE_HTTP_401` |
| 403 Forbidden | terminal | `SSE_HTTP_403` |
| 404 Not Found | terminal | `SSE_HTTP_404` |
| 410 Gone | terminal | `SSE_HTTP_410` |
| 408 Request Timeout | transient | `SSE_HTTP_408` |
| 425 Too Early | transient | `SSE_HTTP_425` |
| 429 Too Many Requests | transient | `SSE_HTTP_429` |
| 5xx | transient | `SSE_HTTP_5XX` (or `SSE_HTTP_${status}` when 1..64 safe) |
| Other 4xx | terminal | `SSE_HTTP_${status}` when safe, else `SSE_HTTP_4XX` |
| Non-HTTP / network failures before status | transient | adapter-owned ordinary `Error` |

Notes:

- **2xx is success** — classifier is for failure statuses only; calling it on 2xx should not be required.
- **Content-Type mismatch** after 2xx is an adapter concern (throw transient or terminal by policy); Core does not inspect headers.
- Mid-stream HTTP is usually a single long-lived response; mid-body failure surfaces as reader/iterator throw (transient by default).
- Auth failures that appear only as SSE comment/error events without HTTP status remain adapter-owned: throw terminal when the provider documents permanent revocation.

Unsafe codes still fall back through existing `managedStreamTerminalErrorCode` → `TRANSPORT_STREAM_TERMINAL`.

### Abort

Unchanged from #392:

1. Worker stop / lease expiry / rebalance aborts the lease-bound signal.
2. Adapter must pass `signal` into fetch/reader and stop parsing.
3. Runtime calls `iterator.return?.()` and rejects stale checkpoint after lease fence.

## RuntimeProgram / supervision integration

1. Inert bindings remain kind-agnostic pure data (`id`, `adapter`, `configRef`, `target`).
2. Live provider authority retains the full `SseTransport` (process code).
3. `createWorkerTransportSupervision` supervised filter becomes polling **or** managed-stream (`stream` **or** `sse`).
4. Stream fiber path: if `isSseTransport`, lower open → temporary/structural `StreamTransport` for `startStreamFiber` only; do not mutate the provider definition.
5. Capability preflight (transports port + checkpoint methods) unchanged.
6. No new program JSON fields. Generated provider authority remains secret-free ids + live process providers as today.
7. Worker JSDoc: “supervises polling, stream, and SSE bindings” (SSE via stream fiber).

## Project Index, LSP, lint, cache identity

| Change | Detail |
| --- | --- |
| `SignalTransportFacts.transportKind` | Add `"sse"` |
| `SignalProviderFacts.transportKind` | Add `"sse"` |
| Static extractor | `extractSseStaticFacts` parallel to stream; `hasOpen: boolean`; call name `sse` on transport modules |
| Primitive manifest | Register `signal.transport.sse` / call extract; native parity fixtures |
| `authoredTransportKind` | Recognize callee `sse` |
| Live fields | `open` already forbidden on inert bindings — keep; no new live field names required |
| Lint | Existing `signal.transportBinding.live_value` covers `open` |
| Coverage identities | Add SSE extractor family to shared fixtures / inventory as required by current gates |
| Cache epochs | Bump `STATIC_PARSE_CACHE_EPOCH` (and semantic/Go snapshot epochs **only if** unchanged source would otherwise reuse stale output — same AGENTS.md rule as stream) |
| Devtools Catalog adapt types | Extend `transportKind?: "webhook" \| "polling" \| "stream" \| "sse"` so Catalog displays `sse` |

Rust/static/native: same class as `stream` / `polling` call extraction. Prefer mirror of `stream-static-facts.ts` rather than overloading the stream extractor with a dual kind switch that loses call-name fidelity.

## Observability and Devtools

- **Catalog:** show `transportKind: "sse"` from Project Index facts (generic provider projection).
- **Runtime observation:** reuse existing stream fiber counters, checkpoint status/cursor, envelope stats — no new ledger fact kinds, no live reconnect bus.
- Do not invent SSE-specific Devtools panels in this child.

## Documentation plan (same PR as implementation)

| Doc | Update |
| --- | --- |
| Guide `signals/providers.mdx` | Mark SSE shipped; minimal `sse({ open })` path; status table |
| Recipes `provider-recipes.mdx` | One SSE recipe with `lastEventId`, status classification, explicit non-React note |
| Reference `providers-and-transports.mdx` | Full `sse` API, item table, lowering note, HTTP classification table |
| `packages/core/src/signal/ARCHITECTURE.md` | SSE as thin lowerer over stream fiber; not a second supervisor |
| React docs cross-link (optional one-liner) | `reference/react.mdx` may note provider-ingress SSE is a different package surface — only if a single sentence avoids confusion without expanding scope |

### Hard distinction (required copy)

| Surface | Package | Direction | Owner of reconnect |
| --- | --- | --- | --- |
| Managed SSE transport `sse({ open })` | `@use-crux/core/signal/transport` | **Inbound** third-party SSE → durable envelopes → Signals | Runtime worker stream fiber |
| React SSE `createSSETransport` / `cruxSSEHandler` | `@use-crux/react` | **Outbound** Crux RecordStore/state → browser hooks | Browser EventSource helper |

Never share types, checkpoints, or supervision between these two.

## Changeset

Update **existing** `.changeset/reactive-durable-execution.md` only. Append a concise user-facing note that first-party `sse({ open })` is a thin managed SSE transport adapter over the existing stream supervision seam (distinct `kind: "sse"`, `lastEventId` authoring, pure HTTP status classification helpers). Packages: at least `@use-crux/core`, `@use-crux/indexer` (and `@use-crux/local` / Devtools only if Catalog types or Go epoch require). Keep **minor**. Do not add a duplicate changeset file. No major.

## Module layout (implementation target)

Prefer small focused files (&lt;300 lines preferred; hard max 1000):

| File | Role |
| --- | --- |
| `signal/transport/sse.ts` | `SseItem` types, `sse()`, `isSseTransport` export site if co-located carefully |
| `signal/transport/sse-lower.ts` | Pure `lowerSseItem` / `lowerSseOpen` + optional validation glue |
| `signal/transport/sse-http-status.ts` | Pure status classification + error codes |
| `signal/transport/index.ts` | Union + exports |
| `signal/provider/signal-provider.ts` | Accept SSE transport; `isSseTransport` / `isManagedStreamTransport` |
| `runtime/worker/worker-transport-supervision.ts` | Filter + lower SSE into stream fiber path |
| Indexer `sse-static-facts.ts` + primitive manifest + facts unions | Discover `sse()` |
| Devtools `adapt.ts` transportKind union | Catalog honesty |
| Docs + ARCHITECTURE + changeset | Progressive documentation |

Do **not** add `worker-transport-sse.ts` reconnect logic.

## Testing strategy

### Layers (keep thin)

1. **Authoring / types** — `sse()` freeze, missing `open` throws, union membership, `isSseTransport` / `isManagedStreamTransport` narrowing type tests.
2. **Lowering / contract** — `lastEventId` → cursor; omit/null rules; cursor byte/control validation via canonical path; batch rejection; envelope field mapping.
3. **HTTP classifier** — pure table cases; codes match safe pattern.
4. **Supervision boundary** — `signalProvider` + `createWorkerTransportSupervision` / `createRuntimeWorker` with **fake** async iterable (no real sockets): one envelope accept + checkpoint proves lowering reaches #337; optional terminal status via `ManagedStreamTerminalError`.
5. **One end-to-end tracer** — single Memory worker test: open → envelope with `lastEventId` → accept → checkpoint cursor equals lastEventId → stop/restart not required if covered by stream tests, but one restart assertion is allowed if cheap via existing helpers.
6. **Indexer** — static + native parity for `sse()` `transportKind: "sse"`, `hasOpen`; live `open` on binding still linted.
7. **Do not** re-matrix Postgres multi-worker, backoff exhaustion tables, or full reconnect fuzz — those laws are owned by #392 stream tests and must remain green.

### Sequential / OOM discipline

- Prefer fake iterables over network.
- Focused vitest files; small event counts.
- Reuse `stream-supervision-helpers` patterns where possible.

## Audit: no duplicate lifecycle; no React confusion

| Risk | Mitigation |
| --- | --- |
| Second reconnect loop | Forbidden; only wrap/lower into existing `runManagedStream` |
| Second checkpoint fields | Forbidden; `lastEventId` becomes generic `cursor` |
| Runtime fetch/EventSource | Forbidden; adapter closure only |
| Duplicate item protocol | Thin rename only; validate through stream contract |
| Catalog shows `stream` for SSE providers | Indexer + Devtools kind `"sse"` |
| Authors confuse React SSE | Required docs table; distinct packages and names (`sse` vs `createSSETransport`) |
| `isStreamTransport` true for SSE | Explicitly false; use `isManagedStreamTransport` for fiber selection |
| Post-accept ack / WebSocket creep | Out of scope |
| New stats/read model | Out of scope |

## Success criteria (implementation complete)

- [ ] `sse({ open })` authorable; accepted by `signalProvider`; frozen `_tag`/`kind`
- [ ] Pure lowering maps `lastEventId` → stream cursor contract
- [ ] Supervision runs SSE providers on the existing stream fiber after lower
- [ ] No second worker/daemon/registry/reconnect/checkpoint implementation
- [ ] HTTP classifier pure and documented; terminal vs transient without Core HTTP
- [ ] Adapter-boundary tests + one e2e tracer green; stream lifecycle suites still green
- [ ] Indexer/lint/epochs updated as required; Catalog kind includes `sse`
- [ ] Progressive docs + ARCHITECTURE distinguish provider-ingress SSE from React SSE
- [ ] Existing minor changeset updated only; no major; no forbidden agent/tool names in content

## Decision blockers

**None.** This design is ready to implement on current main after #392.

Resolved during design against code:

1. Stream fiber requires `StreamTransport` → lower at supervision boundary.
2. Open context keeps field name `cursor` for protocol unity; item field is `lastEventId`.
3. `SseItem` keeps `kind: "envelope" | "cursor"` (not a third event discriminant) to avoid dual kind vocabularies while still renaming the resume field.
4. React SSE remains a separate product surface; no shared types.
