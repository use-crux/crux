/**
 * Durable managed-transport binding checkpoint contract.
 *
 * @remarks Checkpoints store only opaque cursor text and bounded health facts.
 * They never retain credentials, clients, sockets, Requests, raw payloads, or
 * unbounded event identity lists.
 *
 * @module
 */

import type { RuntimeTransportConfigRef } from "./contracts";

/** Maximum UTF-8 size for a durable provider cursor. */
export const MAX_TRANSPORT_BINDING_CURSOR_BYTES = 4 * 1024;

/**
 * Restart-safe supervision status for one managed-transport binding.
 *
 * @remarks Omitted or `"active"` means eligible for acquisition. `"faulted"` is
 * set by terminal/exhaustion paths. `"disabled"` is reserved for operator
 * disablement; supervision skips both non-active statuses.
 */
export type RuntimeTransportBindingStatus =
  | "active"
  | "faulted"
  | "disabled";

/**
 * Restart-safe checkpoint for one supervised managed-transport binding.
 *
 * @remarks Written only after a poll batch is fully accepted through the shared
 * envelope kernel (accepted or same-digest duplicate), or after a stream item is
 * durably accepted / cursor-only progress is applied. Lease ownership uses the
 * existing Runtime {@link import("../ports/leases").LeasePort}, not this record.
 *
 * Additive optional fields (`configRef`, `status`) keep schemaVersion `1` for
 * row compatibility. Readers treat omitted fields as polling-era defaults
 * (no config identity check; effective status active).
 */
export interface RuntimeTransportBindingCheckpoint {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly bindingId: string;
  /**
   * Opaque provider cursor, or `null` when no resume position is known.
   */
  readonly cursor: string | null;
  /** Canonical UTC ISO-8601 instant of the last durable checkpoint write. */
  readonly updatedAt: string;
  /**
   * Canonical UTC ISO-8601 instant of the start of the latest acquisition.
   *
   * @remarks Updated for both successful and failed attempts so interval
   * spacing and health views reflect the most recent poll or stream open.
   * Name retained for polling compatibility.
   */
  readonly lastPolledAt?: string;
  /**
   * Optional worker/process owner id observed at the last successful acquisition.
   *
   * @remarks Diagnostic only. Exclusive ownership is enforced by leases.
   */
  readonly lastOwnerId?: string;
  /**
   * Optional safe failure code from the last acquisition attempt.
   *
   * @remarks Never a stack, credential, raw payload, or provider secret.
   */
  readonly lastErrorCode?: string;
  /**
   * When `true`, the provider reported more pages after the last successful
   * batch. The next worker tick may poll without waiting for `intervalMs`.
   *
   * @remarks Polling only; ignored for stream checkpoints.
   */
  readonly morePending?: boolean;
  /**
   * Config identity under which `cursor` was produced.
   *
   * @remarks Required on every successful stream checkpoint write. When the
   * live binding `configRef` differs, Runtime treats the stored cursor as
   * invalid (over-invalidate) and does not inherit faulted status from the
   * prior config identity. Polling may leave this unset.
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

/** Identity of one binding checkpoint within a Runtime namespace. */
export interface RuntimeTransportBindingCheckpointIdentity {
  readonly namespace: string;
  readonly bindingId: string;
}
