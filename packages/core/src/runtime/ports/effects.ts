/**
 * Runtime-store persistence port for durable Effects.
 *
 * The Effect ledger is the only caller allowed to write through this port.
 * Adapter methods enforce insert-if-absent identity, monotonic revisions, and
 * optional fencing; the ledger groups multi-record operations in `transact()`.
 *
 * @module
 */

import type {
  DurableEffectExecutionSettlement,
  DurableEffectPreparation,
  DurableEffectReceiptRecord,
  DurableEffectRecoveryPreparation,
  DurableEffectRecoverySettlement,
  DurableEffectRecoveryUnitRecord,
  DurableEffectScopeRecord,
  DurableEffectScopeSnapshot,
} from "../../effect/internal/durable-records";
import type { EffectScopeRef } from "../../effect/types";

export type {
  DurableEffectEnvelopeRecord,
  DurableEffectExecutionSettlement,
  DurableEffectPlanStep,
  DurableEffectPreparation,
  DurableEffectReceiptRecord,
  DurableEffectReconciliationRecord,
  DurableEffectRecoveryAttemptRecord,
  DurableEffectRecoveryPreparation,
  DurableEffectRecoverySettlement,
  DurableEffectRecoveryUnitRecord,
  DurableEffectScopeRecord,
  DurableEffectScopeSnapshot,
} from "../../effect/internal/durable-records";

/** Runtime partition used for one durable Effect read. */
export interface RuntimeEffectReadOptions {
  /** Runtime namespace that owns the Effect records. */
  readonly namespace: string;
}

/** Atomic receipt lifecycle update guarded by revision and fence. */
export interface RuntimeEffectReceiptTransition {
  /** Complete replacement row with revision incremented by one. */
  readonly next: DurableEffectReceiptRecord;
}

/** Atomic scope lifecycle update guarded by revision and fence. */
export interface RuntimeEffectScopeTransition {
  /** Complete replacement row with revision incremented by one. */
  readonly next: DurableEffectScopeRecord;
}

/** Atomic recovery-unit lifecycle update guarded by revision and fence. */
export interface RuntimeEffectUnitTransition {
  /** Complete replacement row with revision incremented by one. */
  readonly next: DurableEffectRecoveryUnitRecord;
}

/** Transaction-bound durable Effect record operations. */
export interface RuntimeEffectStorePort {
  /** Load one receipt from its Runtime namespace. */
  getReceipt(
    receiptId: string,
    options: RuntimeEffectReadOptions,
  ): Promise<DurableEffectReceiptRecord | null>;
  /** Insert receipt, scope, unit, envelope, and execution key atomically. */
  prepare(
    preparation: DurableEffectPreparation,
  ): Promise<DurableEffectPreparation>;
  /** Apply one legal optimistic receipt transition. */
  transitionReceipt(
    transition: RuntimeEffectReceiptTransition,
  ): Promise<DurableEffectReceiptRecord | null>;
  /** Settle receipt, envelope, and unit activation in one transaction. */
  settleExecution(
    settlement: DurableEffectExecutionSettlement,
  ): Promise<DurableEffectExecutionSettlement | null>;
  /** Apply one legal optimistic scope transition. */
  transitionScope(
    transition: RuntimeEffectScopeTransition,
  ): Promise<DurableEffectScopeRecord | null>;
  /** Apply one legal optimistic recovery-unit transition. */
  transitionUnit(
    transition: RuntimeEffectUnitTransition,
  ): Promise<DurableEffectRecoveryUnitRecord | null>;
  /** Insert a recovery attempt and fence its unit as recovering atomically. */
  prepareRecovery(
    preparation: DurableEffectRecoveryPreparation,
  ): Promise<DurableEffectRecoveryPreparation | null>;
  /** Settle a successful attempt, original receipt, and unit atomically. */
  settleRecovery(
    settlement: DurableEffectRecoverySettlement,
  ): Promise<DurableEffectRecoverySettlement | null>;
  /** Purely read and reconstruct one scope for the existing rollback planner. */
  reconstructScope(
    scope: EffectScopeRef,
    options: RuntimeEffectReadOptions,
  ): Promise<DurableEffectScopeSnapshot | null>;
}
