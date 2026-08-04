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
  RuntimePruneOptions,
  RuntimePruneResult,
} from "./retention";
import type {
  DurableEffectExecutionSettlement,
  DurableEffectPreparation,
  DurableEffectReceiptRecord,
  DurableEffectReconciliationSettlement,
  DurableEffectRecoveryPreparation,
  DurableEffectRecoverySettlement,
  DurableEffectRecoveryUnitRecord,
  DurableEffectScopeRecord,
  DurableEffectScopeSnapshot,
  DurableEffectScopeSynchronization,
} from "../../effect/internal/durable-records";
import type { EffectScopeRef } from "../../effect/types";
import type { EvidenceArtifactRef } from "../../evidence/subjects";

export type {
  DurableEffectEnvelopeRecord,
  DurableEffectExecutionSettlement,
  DurableEffectPlanStep,
  DurableEffectPreparation,
  DurableEffectReceiptRecord,
  DurableEffectReconciliationRequirement,
  DurableEffectReconciliationRecord,
  DurableEffectReconciliationSettlement,
  DurableEffectRecoveryAttemptRecord,
  DurableEffectRecoveryPreparation,
  DurableEffectRecoverySettlement,
  DurableEffectRecoveryUnitRecord,
  DurableEffectScopeRecord,
  DurableEffectScopeSnapshot,
  DurableEffectScopeSynchronization,
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

/** Monotonic journal evidence linkage for a settled durable receipt. */
export interface RuntimeEffectReceiptEvidenceLink {
  /** Runtime namespace that owns the receipt. */
  readonly namespace: string;
  /** Receipt to link. */
  readonly receiptId: string;
  /** Expected current revision. */
  readonly revision: number;
  /** Canonical raw tool-outcome artifact. */
  readonly toolOutcomeRef?: EvidenceArtifactRef;
  /** Monotonic retry count inspected from the linked request receipt. */
  readonly requestRetryCount?: number;
}

/** Bounded recovery-envelope retention sweep. */
export interface RuntimeEffectPruneOptions extends RuntimePruneOptions {
  /** Wall-clock time used for explicit envelope expiry. */
  readonly now: Date;
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
  /** Link canonical journal evidence without changing settlement. */
  linkReceiptEvidence(
    link: RuntimeEffectReceiptEvidenceLink,
  ): Promise<DurableEffectReceiptRecord | null>;
  /** Settle receipt, envelope, and unit activation in one transaction. */
  settleExecution(
    settlement: DurableEffectExecutionSettlement,
  ): Promise<DurableEffectExecutionSettlement | null>;
  /** Apply one legal optimistic scope transition. */
  transitionScope(
    transition: RuntimeEffectScopeTransition,
  ): Promise<DurableEffectScopeRecord | null>;
  /** Transition a scope and insert newly completed child units atomically. */
  synchronizeScope(
    synchronization: DurableEffectScopeSynchronization,
  ): Promise<DurableEffectScopeSynchronization | null>;
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
  /** Atomically settle ambiguous work and append its reconciliation audit. */
  reconcile(
    settlement: DurableEffectReconciliationSettlement,
  ): Promise<DurableEffectReconciliationSettlement | null>;
  /** Purely read and reconstruct one scope for the existing rollback planner. */
  reconstructScope(
    scope: EffectScopeRef,
    options: RuntimeEffectReadOptions,
  ): Promise<DurableEffectScopeSnapshot | null>;
  /** Delete a bounded batch of expired recovery envelopes while retaining receipts. */
  prune(options: RuntimeEffectPruneOptions): Promise<RuntimePruneResult>;
}
