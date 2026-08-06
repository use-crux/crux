/**
 * Provider-neutral webhook transport authoring.
 *
 * @module
 */

import type { JsonValue } from "../../storage/types";
import type { RuntimeAcceptedTransportPayload } from "../../runtime/transport/contracts";

/**
 * Authenticated, size-checked fields extracted from one webhook request.
 *
 * @remarks Returned only after transport authentication and request validation
 * succeed. It never includes credentials, raw signature headers, or live
 * clients.
 */
export interface WebhookHandleResult {
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
 * Authenticate and validate one inbound webhook request at the host edge.
 *
 * @remarks Must throw or reject before returning when authentication or
 * request validation fails. Successful results feed durable acceptance only
 * after this function completes.
 */
export type WebhookHandle = (
  request: Request,
) => WebhookHandleResult | Promise<WebhookHandleResult>;

/** Options accepted by {@link webhook}. */
export interface WebhookOptions {
  /**
   * Edge authentication and request validation function.
   *
   * @remarks Kept on the live transport definition only. Inert
   * `RuntimeManagedTransportBinding` projections never capture this handle.
   */
  readonly handle: WebhookHandle;
}

/**
 * Inert webhook transport definition used by Signal providers.
 *
 * @remarks Frozen and free of credentials. The `handle` function is process
 * code retained by the definition for edge invocation, not serializable
 * declaration data.
 */
export interface WebhookTransport {
  /** Stable definition discriminant. */
  readonly _tag: "WebhookTransport";
  /** Transport kind retained for diagnostics and host bindings. */
  readonly kind: "webhook";
  /** Edge authentication and request validation function. */
  readonly handle: WebhookHandle;
}

/**
 * Declare a webhook transport without opening a listener or storing secrets.
 *
 * @param options - Edge authentication handle for this transport.
 * @returns A frozen webhook transport definition.
 *
 * @example
 * ```ts
 * import { webhook } from "@use-crux/core/signal/transport";
 *
 * const ingress = webhook({
 *   async handle(request) {
 *     // verify signature, enforce size limits, extract stable ids
 *     return {
 *       accountId: "acct_1",
 *       eventId: "evt_1",
 *       authenticatedRouting: { source: "webhook" },
 *       payload: { kind: "inline-base64url", value: "...", byteLength: 2, sha256: "..." },
 *     };
 *   },
 * });
 * ```
 */
export function webhook(options: WebhookOptions): WebhookTransport {
  if (typeof options.handle !== "function") {
    throw new TypeError("webhook({ handle }) requires a handle function.");
  }
  return Object.freeze({
    _tag: "WebhookTransport" as const,
    kind: "webhook" as const,
    handle: options.handle,
  });
}
