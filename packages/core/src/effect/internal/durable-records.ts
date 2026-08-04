/**
 * JSON-safe durable Effect records owned by Runtime stores.
 *
 * @internal
 * @module
 */

import type {
  EffectReceipt,
  EffectScopeRecord,
  RecoveryEnvelope,
  RecoveryUnitLifecycle,
  RecoveryUnitRecord,
} from "../receipt-types";
import type { EffectScopeRef, RecoveryUnitResult } from "../types";

/** Store-owned receipt row with its stable execution identity. */
export interface DurableEffectReceiptRecord {
  readonly namespace: string;
  readonly receipt: EffectReceipt;
  readonly executionIdempotencyKey: string;
  readonly appendOrder?: number;
  readonly revision: number;
  readonly fenceToken?: string;
}

/** Store-owned rollback-scope row. */
export interface DurableEffectScopeRecord {
  readonly namespace: string;
  readonly scope: EffectScopeRecord;
  readonly revision: number;
  readonly fenceToken?: string;
}

/** Store-owned recovery unit without an executable handler closure. */
export interface DurableEffectRecoveryUnitRecord {
  readonly namespace: string;
  readonly kind: "effect" | "boundary";
  readonly scope?: EffectScopeRef;
  readonly unit: RecoveryUnitRecord;
  readonly effectVersion?: number;
  readonly appendOrder?: number;
  readonly revision: number;
  readonly fenceToken?: string;
}

/** Durable recovery state or an honest marker for process-only state. */
export interface DurableEffectEnvelopeRecord {
  readonly namespace: string;
  readonly receiptId: string;
  readonly durable: boolean;
  readonly envelope?: RecoveryEnvelope;
  readonly revision: number;
}

/** Store-owned recovery-attempt identity and lifecycle. */
export interface DurableEffectRecoveryAttemptRecord {
  readonly namespace: string;
  readonly attemptReceiptId: string;
  readonly originalReceiptId: string;
  readonly unitId: string;
  readonly revision: number;
  readonly fenceToken?: string;
}

/** Append-only audit row for one authorized reconciliation. */
export interface DurableEffectReconciliationRecord {
  readonly namespace: string;
  readonly receiptId: string;
  readonly outcome: "succeeded" | "failed";
  readonly reason: string;
  readonly reconciledAt: number;
  readonly revision: number;
}

/** Records inserted atomically before one custom executor starts. */
export interface DurableEffectPreparation {
  readonly scope: DurableEffectScopeRecord;
  readonly receipt: DurableEffectReceiptRecord;
  readonly unit?: DurableEffectRecoveryUnitRecord;
  readonly envelope?: DurableEffectEnvelopeRecord;
}

/** Atomic scope transition with newly registered nested-boundary units. */
export interface DurableEffectScopeSynchronization {
  readonly scope: DurableEffectScopeRecord;
  readonly units: readonly DurableEffectRecoveryUnitRecord[];
}

/** Atomic success settlement after one custom executor returns. */
export interface DurableEffectExecutionSettlement {
  readonly receipt: DurableEffectReceiptRecord;
  readonly unit?: DurableEffectRecoveryUnitRecord;
  readonly envelope?: DurableEffectEnvelopeRecord;
}

/** Atomic recovery-attempt preparation before invoking compensation. */
export interface DurableEffectRecoveryPreparation {
  readonly attempt: DurableEffectRecoveryAttemptRecord;
  readonly receipt: DurableEffectReceiptRecord;
  readonly unit: DurableEffectRecoveryUnitRecord;
}

/** Atomic known-success recovery settlement. */
export interface DurableEffectRecoverySettlement {
  readonly attemptReceipt: DurableEffectReceiptRecord;
  readonly originalReceipt: DurableEffectReceiptRecord;
  readonly unit: DurableEffectRecoveryUnitRecord;
}

/** Atomic operator-authorized settlement of ambiguous durable work. */
export interface DurableEffectReconciliationSettlement {
  readonly reconciliation: DurableEffectReconciliationRecord;
  readonly receipts: readonly DurableEffectReceiptRecord[];
  readonly unit?: DurableEffectRecoveryUnitRecord;
  readonly envelope?: DurableEffectEnvelopeRecord;
}

interface DurableEffectPlanStepBase {
  readonly unitId: string;
  readonly idempotencyKey: string;
  readonly status: RecoveryUnitLifecycle | RecoveryUnitResult["status"];
}

/** One executable planner step reconstructed only from durable records. */
export type DurableEffectPlanStep =
  | DurableEffectPlanStepBase & {
      readonly kind: "effect";
      readonly receiptId: string;
      readonly effectId: string;
      readonly effectVersion: number;
    }
  | DurableEffectPlanStepBase & {
      readonly kind: "boundary";
      readonly scope: EffectScopeRef;
    };

/** Ambiguous durable work that requires an explicit operator decision. */
export type DurableEffectReconciliationRequirement =
  | {
      readonly kind: "execution";
      readonly receiptId: string;
      readonly state: "prepared" | "unknown";
      readonly idempotencyKey: string;
    }
  | {
      readonly kind: "recovery";
      readonly receiptId: string;
      readonly originalReceiptId: string;
      readonly unitId: string;
      readonly state: "unknown";
      readonly idempotencyKey: string;
    };

/** Pure durable read model for one rollback scope. */
export interface DurableEffectScopeSnapshot {
  readonly scope: EffectScopeRef;
  readonly scopeRecord: DurableEffectScopeRecord;
  readonly receipts: readonly DurableEffectReceiptRecord[];
  readonly units: readonly DurableEffectRecoveryUnitRecord[];
  readonly envelopes: readonly DurableEffectEnvelopeRecord[];
  readonly attempts: readonly DurableEffectRecoveryAttemptRecord[];
  readonly reconciliations: readonly DurableEffectReconciliationRecord[];
  readonly plan: readonly DurableEffectPlanStep[];
  readonly reconciliationRequired: readonly DurableEffectReconciliationRequirement[];
}
