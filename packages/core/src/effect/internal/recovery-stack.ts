/**
 * Append-only registration for custom recovery units.
 *
 * @internal
 * @module
 */

import type {
  EffectReceiptRef,
  EffectResource,
} from "../types";
import {
  effectLedger,
  type RegisteredRecoveryUnit,
  type StoredRecoveryEnvelope,
} from "./ledger";

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
  readonly execute: RegisteredRecoveryUnit["execute"];
}

/** Retain recovery data and activate a single-receipt unit. */
export function registerRecoveryUnit(
  registration: RecoveryUnitRegistration,
): void {
  effectLedger.putEnvelope(registration.envelope);
  effectLedger.registerUnit(
    registration.boundaryId,
    Object.freeze({
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
