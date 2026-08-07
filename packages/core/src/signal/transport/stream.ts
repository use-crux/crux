/**
 * Provider-neutral managed stream transport authoring.
 *
 * @remarks This is the managed **ingress transport** constructor for Signal
 * providers on `@use-crux/core/signal/transport`. It is distinct from LLM
 * generation `stream()` helpers on provider packages and `@use-crux/ai`.
 *
 * @module
 */

import type { JsonValue } from "../../storage/types";
import type {
  RuntimeAcceptedTransportPayload,
  RuntimeTransportConfigRef,
} from "../../runtime/transport/contracts";

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
 * Optional post-accept provider acknowledgement for one stream envelope item.
 *
 * @remarks Process-local only. Runtime invokes this only after durable #337
 * accept (or same-digest duplicate) and, when the item carries a cursor, after
 * that cursor is successfully checkpointed (or checkpoint is skipped because
 * the store port is absent). Failure is observable as a transient connection
 * fault and must not undo acceptance or clear the durable cursor.
 *
 * Prefer omitting this for receive-only streams and SSE. WebSocket adapters
 * that must ack only after durable progress attach a closure here.
 */
export type StreamEnvelopeAcknowledge = () => void | Promise<void>;

/**
 * One authenticated provider event, matching webhook/poll envelope fields.
 *
 * @remarks Optional `cursor` is progress **through this item inclusive**.
 * Runtime may checkpoint that cursor only after this envelope is durably
 * accepted or same-digest duplicate. Digest conflicts never advance the cursor.
 * Optional {@link acknowledge} is the smallest post-accept seam for protocols
 * (typically WebSocket) that must notify the provider only after durable
 * progress — never before accept, and never as a rollback of accept.
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
  /**
   * Optional provider ack after durable accept (and cursor checkpoint when set).
   *
   * @remarks Omit for ordinary receive-only streams. Never serialized into
   * inert bindings, checkpoints, or program JSON.
   */
  readonly acknowledge?: StreamEnvelopeAcknowledge;
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

/**
 * Exactly one protocol item per yield. Do not batch at authoring time.
 *
 * @remarks Each yield is either an envelope item (optional cursor) or a
 * cursor-only progress item — never an array of envelopes.
 */
export type StreamItem = StreamEnvelopeItem | StreamCursorItem;

/**
 * Open one provider connection and yield items under Runtime backpressure.
 *
 * @remarks Live credentials and clients stay inside the adapter closure.
 * Must honor `signal`. Clean completion (iterator returns) is disconnect,
 * not terminal binding success. Throw for failures; use
 * `ManagedStreamTerminalError` (or a compatible `{ terminal: true, code }`
 * shape) for non-reconnectable faults.
 */
export type StreamOpen = (
  context: StreamOpenContext,
) => AsyncIterable<StreamItem> | Promise<AsyncIterable<StreamItem>>;

/** Options accepted by {@link stream}. */
export interface StreamOptions {
  /**
   * Provider connection open function for the managed stream transport.
   *
   * @remarks Kept on the live transport definition only. Inert
   * `RuntimeManagedTransportBinding` projections never capture this handle.
   */
  readonly open: StreamOpen;
}

/**
 * Inert managed stream transport definition used by Signal providers.
 *
 * @remarks Frozen and free of credentials. The `open` function is process
 * code retained by the definition for worker supervision, not serializable
 * declaration data.
 */
export interface StreamTransport {
  /** Stable definition discriminant. */
  readonly _tag: "StreamTransport";
  /** Transport kind retained for diagnostics and host bindings. */
  readonly kind: "stream";
  /** Provider connection open function. */
  readonly open: StreamOpen;
}

/**
 * Declare a managed stream transport without opening sockets or storing secrets.
 *
 * @param options - Connection open handle for this transport.
 * @returns A frozen managed stream transport definition.
 *
 * @example
 * ```ts
 * import { stream } from "@use-crux/core/signal/transport";
 *
 * const ingress = stream({
 *   async *open({ cursor, signal }) {
 *     const connection = await connectProvider({ cursor, signal });
 *     try {
 *       for await (const message of connection.messages) {
 *         yield {
 *           kind: "envelope",
 *           accountId: message.accountId,
 *           eventId: message.eventId,
 *           authenticatedRouting: { source: "stream" },
 *           payload: message.payload,
 *           cursor: message.cursor,
 *         };
 *       }
 *     } finally {
 *       await connection.close();
 *     }
 *   },
 * });
 * ```
 */
export function stream(options: StreamOptions): StreamTransport {
  if (typeof options?.open !== "function") {
    throw new TypeError("stream({ open }) requires an open function.");
  }

  return Object.freeze({
    _tag: "StreamTransport" as const,
    kind: "stream" as const,
    open: options.open,
  });
}
