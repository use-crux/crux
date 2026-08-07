/**
 * Provider-neutral managed WebSocket transport authoring (provider ingress).
 *
 * @remarks This is the managed **ingress** WebSocket transport for Signal
 * providers on `@use-crux/core/signal/transport`. Adapters own socket connect,
 * subscribe, ping/pong, wire parsing, and cleanup; Core freezes a distinct
 * `kind: "websocket"` definition and lowers items onto the managed stream fiber.
 *
 * Ordinary receive-only use yields envelope/cursor items only. Optional
 * {@link WebSocketEnvelopeItem.acknowledge} is invoked by Runtime only after
 * durable envelope acceptance (and cursor checkpoint when present).
 *
 * @module
 */

import type { JsonValue } from "../../storage/types";
import type { RuntimeAcceptedTransportPayload } from "../../runtime/transport/contracts";
import type { StreamOpenContext } from "./stream";

/**
 * Context for one supervised WebSocket connection.
 *
 * @remarks Same shape as {@link StreamOpenContext}. `cursor` is the durable
 * resume value (or `null` when none / config invalidates). Live credentials and
 * sockets stay inside the adapter closure; `configRef` is secret-free identity
 * only.
 */
export type WebSocketOpenContext = StreamOpenContext;

/**
 * Optional post-accept provider acknowledgement.
 *
 * @remarks Runtime invokes this only after durable #337 accept (or same-digest
 * duplicate) and, when the item carries a cursor, after that cursor is
 * successfully checkpointed (or checkpoint is skipped because the store port
 * is absent). Failure must not undo acceptance or clear the durable cursor —
 * see stream connection ack law and ARCHITECTURE notes.
 */
export type WebSocketAcknowledge = () => void | Promise<void>;

/**
 * One authenticated WebSocket application message, ready for durable accept.
 *
 * @remarks Optional `cursor` is progress **through this item inclusive**.
 * Optional {@link acknowledge} is process-local only and never enters inert
 * bindings or program JSON.
 */
export interface WebSocketEnvelopeItem {
  readonly kind: "envelope";
  readonly accountId: string;
  readonly eventId: string;
  readonly authenticatedRouting: Readonly<Record<string, JsonValue>>;
  readonly payload: RuntimeAcceptedTransportPayload;
  /**
   * Opaque resume position after this envelope has been fully accepted.
   *
   * @remarks Omitted means "no new checkpoint from this item". `null` clears
   * the durable resume position only when the provider truly has none.
   */
  readonly cursor?: string | null;
  /**
   * Optional provider ack after durable accept (and cursor checkpoint when set).
   *
   * @remarks Omit for ordinary receive-only WebSocket ingress. When provided,
   * Runtime awaits this only after durable progress; ack failure is observed as
   * a transient connection fault without rolling back accept or cursor.
   */
  readonly acknowledge?: WebSocketAcknowledge;
}

/**
 * Resume progress without a new envelope (heartbeat / seq-only advance).
 *
 * @remarks Yield only when the adapter has a genuine new resume position.
 * Must never cover unyielded messages (adapter contract violation).
 */
export interface WebSocketCursorItem {
  readonly kind: "cursor";
  readonly cursor: string | null;
}

/** Exactly one protocol item per yield. Do not batch. */
export type WebSocketItem = WebSocketEnvelopeItem | WebSocketCursorItem;

/**
 * Open one WebSocket connection and yield items under Runtime pull backpressure.
 *
 * @remarks The adapter owns connect/subscribe/ping-pong/parser/auth/close.
 * Must honor `signal` and clean up sockets on abort or iterator `return`.
 * Clean iterator completion is disconnect, not terminal binding success.
 * Throw ordinary errors for transient failure; throw
 * `ManagedStreamTerminalError` (or duck-typed `{ terminal: true, code }`)
 * for non-reconnectable faults such as revoked credentials.
 *
 * Push-based sockets must buffer only within a bound and fail the connection
 * on overflow — never silently drop messages. Prefer
 * {@link createBoundedPushBuffer}.
 */
export type WebSocketOpen = (
  context: WebSocketOpenContext,
) => AsyncIterable<WebSocketItem> | Promise<AsyncIterable<WebSocketItem>>;

/** Options accepted by {@link websocket}. */
export interface WebSocketOptions {
  /**
   * Provider connection open function for the managed WebSocket transport.
   *
   * @remarks Kept on the live transport definition only. Inert
   * `RuntimeManagedTransportBinding` projections never capture this handle.
   */
  readonly open: WebSocketOpen;
}

/**
 * Distinct WebSocket transport definition that lowers to the managed stream protocol.
 *
 * @remarks Frozen and free of credentials and live sockets. Runtime supervision
 * treats this as a managed-stream binding after pure item lowering. `open`
 * remains the WebSocket-shaped authoring handle; fibers never receive raw frames.
 */
export interface WebSocketTransport {
  /** Stable definition discriminant. */
  readonly _tag: "WebSocketTransport";
  /** Transport kind retained for diagnostics and host bindings. */
  readonly kind: "websocket";
  /** Provider WebSocket connection open function. */
  readonly open: WebSocketOpen;
}

/**
 * Declare a managed WebSocket transport without opening sockets or storing secrets.
 *
 * @param options - Connection open handle for this transport.
 * @returns A frozen managed WebSocket transport definition.
 *
 * @example
 * ```ts
 * import { websocket } from "@use-crux/core/signal/transport";
 *
 * const ingress = websocket({
 *   async *open({ cursor, signal }) {
 *     const socket = await connectProvider({ cursor, signal });
 *     try {
 *       for await (const message of socket.messages) {
 *         yield {
 *           kind: "envelope",
 *           accountId: message.accountId,
 *           eventId: message.eventId,
 *           authenticatedRouting: { source: "websocket" },
 *           payload: message.payload,
 *           cursor: message.cursor,
 *           // Optional: only after durable accept + cursor checkpoint.
 *           acknowledge: () => socket.ack(message.wireId),
 *         };
 *       }
 *     } finally {
 *       await socket.close();
 *     }
 *   },
 * });
 * ```
 */
export function websocket(options: WebSocketOptions): WebSocketTransport {
  if (typeof options?.open !== "function") {
    throw new TypeError("websocket({ open }) requires an open function.");
  }

  return Object.freeze({
    _tag: "WebSocketTransport" as const,
    kind: "websocket" as const,
    open: options.open,
  });
}
