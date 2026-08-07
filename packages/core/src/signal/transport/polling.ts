/**
 * Provider-neutral polling transport authoring.
 *
 * @module
 */

import type { JsonValue } from "../../storage/types";
import type {
  RuntimeAcceptedTransportPayload,
  RuntimeTransportConfigRef,
} from "../../runtime/transport/contracts";

/**
 * One authenticated provider event returned by a poll pass.
 *
 * @remarks Fields feed durable #337 acceptance. Credentials, live clients, and
 * sockets must never appear here.
 */
export interface PollEvent {
  /** Provider account identity stable for idempotent acceptance. */
  readonly accountId: string;
  /** Provider event identity stable for idempotent acceptance. */
  readonly eventId: string;
  /** Detached, secret-free routing metadata retained with the envelope. */
  readonly authenticatedRouting: Readonly<Record<string, JsonValue>>;
  /** Opaque authenticated payload retained with the envelope. */
  readonly payload: RuntimeAcceptedTransportPayload;
}

/**
 * Context supplied to {@link PollHandle} for one supervised poll.
 *
 * @remarks `cursor` is the durable checkpoint from the last successful batch.
 * `signal` aborts when the Runtime worker is stopping or loses binding ownership.
 */
export interface PollContext {
  /**
   * Durable provider cursor from the last fully accepted batch, or `null`
   * when no checkpoint exists yet.
   */
  readonly cursor: string | null;
  /** Abort when the worker is stopping or the binding lease is abandoned. */
  readonly signal: AbortSignal;
  /** Secret-free config reference from the inert binding declaration. */
  readonly configRef: RuntimeTransportConfigRef;
}

/**
 * Bounded result of one poll acquisition.
 *
 * @remarks `nextCursor` is persisted only after every returned event is
 * durably accepted (or treated as a same-digest duplicate). Partial failure
 * leaves the previous cursor in place so restart redelivers without loss.
 */
export interface PollResult {
  /** Authenticated events to accept, in provider order. */
  readonly events: readonly PollEvent[];
  /**
   * Opaque cursor that represents progress after this batch.
   *
   * @remarks May equal the input cursor when the provider has no newer events.
   * `null` clears the checkpoint (use only when the provider truly has no
   * resume position).
   */
  readonly nextCursor: string | null;
  /**
   * When `true`, the provider has additional pages available immediately.
   *
   * @remarks After durable acceptance, the Runtime worker may poll again on
   * the next tick without waiting for `intervalMs`. Omitted or `false` means
   * the configured interval (or worker cadence) applies.
   */
  readonly more?: boolean;
}

/**
 * Acquire one bounded page of provider events for durable acceptance.
 *
 * @remarks Must throw or reject before returning when authentication or
 * request validation fails. Successful results feed durable acceptance only
 * after this function completes. Live credentials and clients stay inside the
 * adapter closure, never on the frozen transport value.
 */
export type PollHandle = (
  context: PollContext,
) => PollResult | Promise<PollResult>;

/** Options accepted by {@link polling}. */
export interface PollingOptions {
  /**
   * Provider poll acquisition function.
   *
   * @remarks Kept on the live transport definition only. Inert
   * `RuntimeManagedTransportBinding` projections never capture this handle.
   */
  readonly poll: PollHandle;
  /**
   * Optional minimum milliseconds between poll starts for one binding.
   *
   * @remarks Defaults to the Runtime worker maintenance cadence when omitted.
   * Values must be positive and finite.
   */
  readonly intervalMs?: number;
}

/**
 * Inert polling transport definition used by Signal providers.
 *
 * @remarks Frozen and free of credentials. The `poll` function is process
 * code retained by the definition for worker supervision, not serializable
 * declaration data.
 */
export interface PollingTransport {
  /** Stable definition discriminant. */
  readonly _tag: "PollingTransport";
  /** Transport kind retained for diagnostics and host bindings. */
  readonly kind: "polling";
  /** Provider poll acquisition function. */
  readonly poll: PollHandle;
  /** Optional minimum interval between poll starts. */
  readonly intervalMs?: number;
}

/**
 * Declare a polling transport without opening sockets or storing secrets.
 *
 * @param options - Poll acquisition handle and optional interval.
 * @returns A frozen polling transport definition.
 *
 * @example
 * ```ts
 * import { polling } from "@use-crux/core/signal/transport";
 *
 * const ingress = polling({
 *   intervalMs: 5_000,
 *   async poll({ cursor, signal }) {
 *     const page = await fetchPage(cursor, signal);
 *     return {
 *       events: page.events,
 *       nextCursor: page.cursor,
 *     };
 *   },
 * });
 * ```
 */
export function polling(options: PollingOptions): PollingTransport {
  if (typeof options.poll !== "function") {
    throw new TypeError("polling({ poll }) requires a poll function.");
  }
  if (options.intervalMs !== undefined) {
    if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
      throw new RangeError(
        "polling({ intervalMs }) must be a positive finite number when set.",
      );
    }
  }
  return Object.freeze({
    _tag: "PollingTransport" as const,
    kind: "polling" as const,
    poll: options.poll,
    ...(options.intervalMs !== undefined
      ? { intervalMs: options.intervalMs }
      : {}),
  });
}
