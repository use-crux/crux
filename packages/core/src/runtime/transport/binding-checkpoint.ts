/**
 * Durable managed-transport binding checkpoint contract.
 *
 * @remarks Checkpoints store only opaque cursor text and bounded health facts.
 * They never retain credentials, clients, sockets, Requests, raw payloads, or
 * unbounded event identity lists.
 *
 * @module
 */

/** Maximum UTF-8 size for a durable provider cursor. */
export const MAX_TRANSPORT_BINDING_CURSOR_BYTES = 4 * 1024;

/**
 * Restart-safe checkpoint for one supervised managed-transport binding.
 *
 * @remarks Written only after a poll batch is fully accepted through the shared
 * envelope kernel (accepted or same-digest duplicate). Lease ownership uses the
 * existing Runtime {@link import("../ports/leases").LeasePort}, not this record.
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
   * Canonical UTC ISO-8601 instant of the start of the latest poll attempt.
   *
   * @remarks Updated for both successful and failed attempts so interval
   * spacing and health views reflect the most recent acquisition start.
   */
  readonly lastPolledAt?: string;
  /**
   * Optional worker/process owner id observed at the last successful poll.
   *
   * @remarks Diagnostic only. Exclusive ownership is enforced by leases.
   */
  readonly lastOwnerId?: string;
  /**
   * Optional safe failure code from the last poll attempt.
   *
   * @remarks Never a stack, credential, raw payload, or provider secret.
   */
  readonly lastErrorCode?: string;
  /**
   * When `true`, the provider reported more pages after the last successful
   * batch. The next worker tick may poll without waiting for `intervalMs`.
   */
  readonly morePending?: boolean;
}

/** Identity of one binding checkpoint within a Runtime namespace. */
export interface RuntimeTransportBindingCheckpointIdentity {
  readonly namespace: string;
  readonly bindingId: string;
}
