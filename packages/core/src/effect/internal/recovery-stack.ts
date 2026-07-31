/**
 * Append-only registration for custom recovery units.
 *
 * @internal
 * @module
 */

import type {
  EffectReceiptRef,
  EffectResource,
  EffectScopeRef,
} from "../types";
import type {
  RecoveryUnitLifecycle,
  RecoveryUnitRecord,
} from "../receipt-types";
import {
  effectLedger,
  type RecoveryHandlerInvocation,
  type RecoveryOperationResult,
  type StoredRecoveryEnvelope,
} from "./ledger";

/** Recovery unit for one custom effect with its in-process handler binding. */
export interface RegisteredEffectRecoveryUnit
  extends RecoveryUnitRecord {
  readonly kind: "effect";
  /** Invoke the exact definition version registered for this unit. */
  readonly execute: (
    invocation: RecoveryHandlerInvocation,
  ) => Promise<void>;
  readonly recoveryOperation?: Promise<RecoveryOperationResult>;
}

/** Recovery unit representing one completed child rollback boundary. */
export interface RegisteredBoundaryRecoveryUnit
  extends RecoveryUnitRecord {
  readonly kind: "boundary";
  /** Child boundary recursively traversed by this unit. */
  readonly scope: EffectScopeRef;
  readonly recoveryOperation?: Promise<RecoveryOperationResult>;
}

/** Recovery unit retained by the in-memory ledger. */
export type RegisteredRecoveryUnit =
  | RegisteredEffectRecoveryUnit
  | RegisteredBoundaryRecoveryUnit;

/** One append-only entry in a boundary's causal recovery stack. */
export type RecoveryStackEntry =
  | { readonly kind: "effect"; readonly receiptId: string }
  | { readonly kind: "boundary"; readonly unitId: string };

/** Input required to activate one single-receipt recovery unit. */
export interface RecoveryUnitRegistration {
  /** Owning boundary identifier. */
  readonly boundaryId: string;
  /** Stable unit identifier. */
  readonly unitId: string;
  /** Stable recovery idempotency key. */
  readonly idempotencyKey: string;
  /** Original receipt reference. */
  readonly receipt: EffectReceiptRef;
  /** Safe projected resource identity. */
  readonly resource?: EffectResource | readonly EffectResource[];
  /** Retained recovery data. */
  readonly envelope: StoredRecoveryEnvelope;
  /** Bound recovery handler. */
  readonly execute: RegisteredEffectRecoveryUnit["execute"];
}

/** Retain recovery data and activate a single-receipt unit. */
export function registerRecoveryUnit(
  registration: RecoveryUnitRegistration,
): void {
  effectLedger.putEnvelope(registration.envelope);
  effectLedger.registerUnit(
    registration.boundaryId,
    Object.freeze({
      kind: "effect",
      id: registration.unitId,
      boundaryId: registration.boundaryId,
      receiptIds: [registration.receipt.id],
      effectIds: [registration.receipt.effectId],
      status: "active",
      idempotencyKey: registration.idempotencyKey,
      execute: registration.execute,
    }),
  );
}

/** Append one settled effect occurrence to its boundary's causal stack. */
export function registerEffectStackEntry(
  boundaryId: string,
  receiptId: string,
): void {
  effectLedger.appendStackEntry(boundaryId, {
    kind: "effect",
    receiptId,
  });
}

/** Register one completed child boundary as a unit in its parent plan. */
export function registerNestedBoundaryUnit(
  parentId: string,
  scope: EffectScopeRef,
  status: RecoveryUnitLifecycle,
): void {
  if (effectLedger.stackFor(scope.id).length === 0) return;
  const childUnits = effectLedger.unitsFor(scope.id);
  const childReceipts = effectLedger.receiptsFor(scope.id);
  const effectIds = [
    ...new Set([
      ...childReceipts.map((receipt) => receipt.effectId),
      ...childUnits.flatMap((unit) => unit.effectIds),
    ]),
  ];
  const receiptIds = [
    ...new Set([
      ...childReceipts.map((receipt) => receipt.id),
      ...childUnits.flatMap((unit) => unit.receiptIds),
    ]),
  ];
  const unitId = `effect-boundary-unit:${scope.id}`;
  effectLedger.registerUnit(
    parentId,
    Object.freeze({
      kind: "boundary",
      id: unitId,
      boundaryId: parentId,
      receiptIds,
      effectIds,
      status,
      idempotencyKey: `effect-boundary-recovery:${scope.id}`,
      scope,
    }),
  );
  effectLedger.appendStackEntry(parentId, {
    kind: "boundary",
    unitId,
  });
}
