/**
 * Pure planning for effect rollback.
 *
 * @internal
 * @module
 */

import type {
  EffectReceipt,
  RecoveryUnitRecord,
} from "../receipt-types";
import type {
  EffectReceiptRef,
  RecoveryUnitResult,
  RollbackResult,
} from "../types";

/** One ordered action or expected settlement in a rollback plan. */
export type RollbackPlanStep =
  | {
      readonly kind: "recover";
      readonly receipt: EffectReceiptRef;
    }
  | {
      readonly kind: "settle";
      readonly result: RecoveryUnitResult;
    };

/** Build a causal LIFO plan without invoking recovery handlers. */
export function planRollback(
  receipts: readonly EffectReceipt[],
  units: readonly RecoveryUnitRecord[],
): readonly RollbackPlanStep[] {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const steps: RollbackPlanStep[] = [];

  for (const receipt of [...receipts].reverse()) {
    if (receipt.outcome !== "succeeded") continue;
    const unit = receipt.recoveryUnitId
      ? unitsById.get(receipt.recoveryUnitId)
      : undefined;
    if (unit) {
      steps.push({
        kind: "recover",
        receipt: receiptRef(receipt),
      });
      continue;
    }
    steps.push({
      kind: "settle",
      result: Object.freeze({
        unitId:
          receipt.recoveryUnitId ?? `effect-unit:${receipt.id}`,
        effectIds: [receipt.effectId],
        ...(receipt.resource === undefined
          ? {}
          : { resource: receipt.resource }),
        status: expectedStatus(receipt),
      }),
    });
  }

  return Object.freeze(steps);
}

/** Fold unit settlements into the RFC aggregate status. */
export function aggregateRollbackStatus(
  units: readonly RecoveryUnitResult[],
): RollbackResult["status"] {
  if (
    units.every(
      (unit) =>
        unit.status === "recovered" ||
        unit.status === "already_recovered",
    )
  ) {
    return "completed";
  }
  if (units.some((unit) => unit.status === "cancelled")) {
    return "cancelled";
  }
  const succeeded = units.some(
    (unit) =>
      unit.status === "recovered" ||
      unit.status === "already_recovered",
  );
  if (succeeded) return "partial";
  if (units.some((unit) => unit.status === "failed")) {
    return "failed";
  }
  return "not_possible";
}

function expectedStatus(
  receipt: EffectReceipt,
): RecoveryUnitResult["status"] {
  if (receipt.recovery === "recovered") {
    return "already_recovered";
  }
  if (
    receipt.recovery === "expired" ||
    receipt.recovery === "conflict" ||
    receipt.recovery === "handler_unavailable" ||
    receipt.recovery === "ambiguous" ||
    receipt.recovery === "irreversible" ||
    receipt.recovery === "unavailable"
  ) {
    return receipt.recovery;
  }
  return "handler_unavailable";
}

function receiptRef(receipt: EffectReceipt): EffectReceiptRef {
  return Object.freeze({
    kind: "effect.receipt",
    id: receipt.id,
    effectId: receipt.effectId,
  });
}
