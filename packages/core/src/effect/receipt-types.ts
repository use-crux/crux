/**
 * Public receipt records and internal recovery-state record contracts.
 *
 * @module
 */

import type { JsonObject, JsonValue } from "../storage/types";
import type {
  EffectReceiptRef,
  EffectResource,
  EffectScopeRef,
} from "./types";

/** Monotonic execution outcome recorded on an effect receipt. */
export type EffectOutcome =
  | "preparing"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

/** Current recovery availability for an effect receipt. */
export type RecoveryAvailability =
  | "available"
  | "unavailable"
  | "irreversible"
  | "expired"
  | "conflict"
  | "handler_unavailable"
  | "ambiguous"
  | "recovered";

/** Immutable read model folded from append-only receipt transitions. */
export interface EffectReceipt extends EffectReceiptRef {
  /** Receipt schema version. */
  readonly schemaVersion: 1;
  /** Effect definition version. */
  readonly effectVersion: number;
  /** Whether this receipt describes a custom or native effect. */
  readonly effectKind: "custom" | "native";
  /** Native primitive name when `effectKind` is `"native"`. */
  readonly nativePrimitive?: string;
  /** Owning execution scope identifier. */
  readonly scopeId: string;
  /** Nearest rollback boundary identifier. */
  readonly boundaryId: string;
  /** Parent custom-effect receipt identifier. */
  readonly parentReceiptId?: string;
  /** Containing run identifier. */
  readonly runId?: string;
  /** Correlated trace identifier. */
  readonly traceId?: string;
  /** Correlated span identifier. */
  readonly spanId?: string;
  /** Containing tool-call identifier. */
  readonly toolCallId?: string;
  /** Containing flow identifier. */
  readonly flowId?: string;
  /** Containing flow-step identifier. */
  readonly stepId?: string;
  /** Acting principal identifier. */
  readonly actorId?: string;
  /** Approval record identifier. */
  readonly approvalId?: string;
  /** Authored source identity. */
  readonly source?: {
    /** Stable definition identifier. */
    readonly definitionId?: string;
    /** Stable source identifier. */
    readonly sourceId?: string;
    /** Human-readable source reference. */
    readonly sourceRef?: string;
  };
  /** Safe domain resource identity. */
  readonly resource?: EffectResource | readonly EffectResource[];
  /** Number of execution attempts represented by the receipt. */
  readonly attemptCount: number;
  /** Current monotonic execution outcome. */
  readonly outcome: EffectOutcome;
  /** Current recovery availability. */
  readonly recovery: RecoveryAvailability;
  /** Registered recovery unit identifier. */
  readonly recoveryUnitId?: string;
  /** Execution start time in epoch milliseconds. */
  readonly startedAt: number;
  /** Execution completion time in epoch milliseconds. */
  readonly completedAt?: number;
  /** Structured failure summary. */
  readonly error?: {
    /** Stable diagnostic code. */
    readonly code: string;
    /** Safe failure message. */
    readonly message: string;
  };
}

/** JSON-safe state required to invoke recovery after execution. */
export interface RecoveryEnvelope extends JsonObject {
  /** Envelope schema version. */
  readonly schemaVersion: 1;
  /** Original receipt identifier. */
  readonly receiptId: string;
  /** Effect definition identifier. */
  readonly effectId: string;
  /** Effect definition version. */
  readonly effectVersion: number;
  /** Original JSON-safe input. */
  readonly input?: JsonValue;
  /** Settled JSON-safe output. */
  readonly output?: JsonValue;
  /** JSON-safe pre-state captured before execution. */
  readonly captured?: JsonValue;
  /** Opaque native-provider recovery reference. */
  readonly nativeRef?: JsonValue;
  /** Envelope creation time in epoch milliseconds. */
  readonly createdAt: number;
  /** Optional expiry time in epoch milliseconds. */
  readonly expiresAt?: number;
}

/** Internal recovery-unit lifecycle. */
export type RecoveryUnitLifecycle =
  | "prepared"
  | "active"
  | "recovering"
  | "recovered"
  | "failed";

/** Internal scope lifecycle. */
export type EffectScopeLifecycle =
  | "open"
  | "rolling_back"
  | "completed"
  | "closed";

/** Internal read model for one rollback boundary. */
export interface EffectScopeRecord {
  /** Public scope reference. */
  readonly ref: EffectScopeRef;
  /** Parent boundary identifier. */
  readonly parentId?: string;
  /** Current lifecycle state. */
  readonly status: EffectScopeLifecycle;
  /** Ordered recovery-unit identifiers. */
  readonly unitIds: readonly string[];
}

/** Internal read model for one recovery unit. */
export interface RecoveryUnitRecord {
  /** Stable recovery-unit identifier. */
  readonly id: string;
  /** Owning boundary identifier. */
  readonly boundaryId: string;
  /** Covered receipt identifiers. */
  readonly receiptIds: readonly string[];
  /** Covered authored effect identifiers. */
  readonly effectIds: readonly string[];
  /** Current recovery lifecycle. */
  readonly status: RecoveryUnitLifecycle;
  /** Stable recovery idempotency key. */
  readonly idempotencyKey: string;
}
