/**
 * Provider-neutral managed SSE transport authoring (provider ingress).
 *
 * @remarks This is the managed **ingress** SSE transport for Signal providers
 * on `@use-crux/core/signal/transport`. Adapters own `fetch` / EventSource /
 * wire parsing; Core freezes a distinct `kind: "sse"` definition and lowers
 * items onto the managed stream fiber.
 *
 * Distinct from `@use-crux/react` browser SSE (`createSSETransport` /
 * `cruxSSEHandler`), which is **egress** from Crux state to the browser.
 * Do not share types, checkpoints, or supervision with that surface.
 *
 * @module
 */

import type { JsonValue } from "../../storage/types";
import type { RuntimeAcceptedTransportPayload } from "../../runtime/transport/contracts";
import type { StreamOpenContext } from "./stream";

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
 * `ManagedStreamTerminalError` (or duck-typed `{ terminal: true, code }`)
 * for non-reconnectable faults such as revoked credentials.
 */
export type SseOpen = (
  context: SseOpenContext,
) => AsyncIterable<SseItem> | Promise<AsyncIterable<SseItem>>;

/** Options accepted by {@link sse}. */
export interface SseOptions {
  /**
   * Provider connection open function for the managed SSE transport.
   *
   * @remarks Kept on the live transport definition only. Inert
   * `RuntimeManagedTransportBinding` projections never capture this handle.
   */
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
  /** Stable definition discriminant. */
  readonly _tag: "SseTransport";
  /** Transport kind retained for diagnostics and host bindings. */
  readonly kind: "sse";
  /** Provider SSE connection open function. */
  readonly open: SseOpen;
}

/**
 * Declare a managed SSE transport without opening sockets or storing secrets.
 *
 * @param options - Connection open handle for this transport.
 * @returns A frozen managed SSE transport definition.
 *
 * @example
 * ```ts
 * import { sse } from "@use-crux/core/signal/transport";
 *
 * const ingress = sse({
 *   async *open({ cursor, signal }) {
 *     // Adapter maps cursor → Last-Event-ID and owns fetch/parser.
 *     for await (const frame of connectAndParse({ lastEventId: cursor, signal })) {
 *       if (frame.kind === "event") {
 *         yield {
 *           kind: "envelope",
 *           accountId: frame.accountId,
 *           eventId: frame.eventId,
 *           authenticatedRouting: { source: "sse" },
 *           payload: frame.payload,
 *           lastEventId: frame.id,
 *         };
 *       }
 *     }
 *   },
 * });
 * ```
 */
export function sse(options: SseOptions): SseTransport {
  if (typeof options?.open !== "function") {
    throw new TypeError("sse({ open }) requires an open function.");
  }

  return Object.freeze({
    _tag: "SseTransport" as const,
    kind: "sse" as const,
    open: options.open,
  });
}
