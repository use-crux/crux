/** RecordStore-backed Flow snapshot contracts. */

import type { JsonObject, JsonValue } from "../storage";

/** Persisted, occurrence-keyed local signal delivery used for suspend replay. */
export interface DeliveredFlowSignal extends JsonObject {
  /** Signal name delivered to a suspend point. */
  signalName: string;
  /** Validated payload replayed for this suspend occurrence. */
  payload: JsonValue;
  /** Unix timestamp recorded when the pending signal was consumed. */
  deliveredAt: number;
}

/** Persisted, occurrence-keyed local suspend payloads used for resume replay. */
export interface DeliveredFlowSignals extends JsonObject {
  [key: string]: DeliveredFlowSignal | undefined;
}

/**
 * Persisted Flow snapshot stored in a RecordStore.
 *
 * @remarks Runtime Engine Flow snapshots use the separate provider-neutral
 * state-port contract; this shape preserves the existing RecordStore path.
 */
export interface FlowSnapshot extends JsonObject {
  /** Stable Flow instance identity. */
  flowId: string;
  /** Authored Flow definition name. */
  name: string;
  /** Current lifecycle state. */
  status: string;
  /** Most recent authored suspend point. */
  suspendedAt: string;
  /** Completed step results available for skip replay. */
  completedSteps: Record<
    string,
    {
      output: JsonValue;
      durationMs: number;
    }
  >;
  /** Validated suspend payloads keyed by source-order occurrence. */
  deliveredSignals?: DeliveredFlowSignals;
  /** Existing local trace correlators. */
  traceContext: JsonObject;
  /** Serializable carrier used to resume this Flow in a fresh run segment. */
  continuation?: JsonObject;
  /** Unix timestamp when the Flow was created. */
  createdAt: number;
  /** Unix timestamp of the latest snapshot update. */
  updatedAt: number;
  /** Unix timestamp recorded when the Flow reaches `completed`. */
  completedAt?: number;
  /** Unix timestamp recorded when the Flow reaches `cancelled`. */
  cancelledAt?: number;
  /** Unix timestamp recorded when the Flow reaches `expired`. */
  expiredAt?: number;
  /** Optional cancellation reason stored with terminal cancelled snapshots. */
  cancelReason?: string;
}
