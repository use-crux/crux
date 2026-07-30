/**
 * Recover one custom effect receipt.
 *
 * @module
 */

import { CruxEffectError } from "./errors";
import {
  effectLedger,
  type RecoveryOperationResult,
} from "./internal/ledger";
import type {
  EffectReceiptRef,
  RecoverOptions,
  RecoveryUnitResult,
} from "./types";

/**
 * Internal recovery settlement retaining the raw handler error.
 *
 * @internal
 */
export type EffectRecoveryAttempt = RecoveryOperationResult;

/**
 * Recover the single recovery unit owned by a receipt.
 *
 * @param receipt - Receipt produced by a recoverable effect.
 * @param options - Recovery reason, conflict policy, and cancellation.
 * @returns The recovery unit settlement.
 *
 * @example
 * ```ts
 * const execution = await updateCustomer.run(input)
 * await recover(execution.receipt, {
 *   reason: "Customer rejected the change",
 * })
 * ```
 */
export async function recover(
  receipt: EffectReceiptRef,
  options?: RecoverOptions,
): Promise<RecoveryUnitResult> {
  return (await recoverEffectReceiptAttempt(receipt, options)).result;
}

/**
 * Recover one receipt while retaining a raw handler error for boundaries.
 *
 * @internal
 */
export async function recoverEffectReceiptAttempt(
  receipt: EffectReceiptRef,
  options?: RecoverOptions,
): Promise<EffectRecoveryAttempt> {
  assertReceiptRef(receipt);
  const storedReceipt = effectLedger.getReceipt(receipt.id);
  if (
    !storedReceipt ||
    storedReceipt.effectId !== receipt.effectId
  ) {
    throw receiptNotFound(receipt.id);
  }

  const unitId = storedReceipt.recoveryUnitId;
  const unit = unitId
    ? effectLedger.getUnit(unitId)
    : undefined;
  if (!unit) {
    return Object.freeze({
      result: Object.freeze({
        unitId: unitId ?? `effect-unit:${storedReceipt.id}`,
        effectIds: [storedReceipt.effectId],
        ...(storedReceipt.resource === undefined
          ? {}
          : { resource: storedReceipt.resource }),
        status:
          storedReceipt.recovery === "irreversible"
            ? "irreversible"
            : "unavailable",
      }),
    });
  }
  if (unit.receiptIds.length !== 1) {
    throw new CruxEffectError({
      code: "EFFECT_RECOVERY_SHARED_UNIT",
      message:
        `Recovery unit \`${unit.id}\` covers multiple receipts in ` +
        `scope \`${unit.boundaryId}\`.`,
    });
  }
  if (unit.status === "recovered") {
    return Object.freeze({
      result: unitResult(
        unit,
        storedReceipt.resource,
        "already_recovered",
      ),
    });
  }
  if (
    unit.status === "recovering" &&
    unit.recoveryOperation
  ) {
    return unit.recoveryOperation;
  }

  const envelope = effectLedger.getEnvelope(storedReceipt.id);
  if (!envelope) {
    return Object.freeze({
      result: unitResult(
        unit,
        storedReceipt.resource,
        "unavailable",
      ),
    });
  }

  const operation = Promise.resolve().then(
    async (): Promise<EffectRecoveryAttempt> => {
      try {
        await unit.execute({
          envelope,
          receipt: Object.freeze({
            kind: "effect.receipt",
            id: storedReceipt.id,
            effectId: storedReceipt.effectId,
          }),
          resource: storedReceipt.resource,
          idempotencyKey: unit.idempotencyKey,
          options,
        });
        effectLedger.markUnit(unit.id, "recovered");
        effectLedger.markReceiptRecovery(
          storedReceipt.id,
          "recovered",
        );
        return Object.freeze({
          result: unitResult(
            unit,
            storedReceipt.resource,
            "recovered",
          ),
        });
      } catch (error) {
        effectLedger.markUnit(unit.id, "failed");
        return Object.freeze({
          result: Object.freeze({
            ...unitResult(
              unit,
              storedReceipt.resource,
              "failed",
            ),
            error: summarizeError(error),
          }),
          error,
        });
      }
    },
  );
  effectLedger.markUnit(unit.id, "recovering", operation);
  return operation;
}

/** Recover a receipt only when it belongs to one definition. @internal */
export async function recoverEffectReceiptForDefinition(
  effectId: string,
  receipt: EffectReceiptRef,
  options?: RecoverOptions,
): Promise<RecoveryUnitResult> {
  if (
    !isRecord(receipt) ||
    receipt.kind !== "effect.receipt" ||
    receipt.effectId !== effectId
  ) {
    throw receiptNotFound(
      isRecord(receipt) && typeof receipt.id === "string"
        ? receipt.id
        : "unknown",
    );
  }
  return recover(receipt, options);
}

function assertReceiptRef(receipt: EffectReceiptRef): void {
  const value: unknown = receipt;
  if (isRecord(value) && value.kind === "effect.scope") {
    const id =
      typeof value.id === "string" ? value.id : "unknown";
    throw new CruxEffectError({
      code: "EFFECT_SCOPE_NOT_FOUND",
      message: `Effect scope \`${id}\` cannot be recovered as a receipt.`,
    });
  }
  if (
    !isRecord(value) ||
    value.kind !== "effect.receipt" ||
    typeof value.id !== "string" ||
    typeof value.effectId !== "string"
  ) {
    throw receiptNotFound("unknown");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function receiptNotFound(id: string): CruxEffectError {
  return new CruxEffectError({
    code: "EFFECT_RECEIPT_NOT_FOUND",
    message: `Effect receipt \`${id}\` was not found.`,
  });
}

function unitResult(
  unit: {
    readonly id: string;
    readonly effectIds: readonly string[];
  },
  resource: RecoveryUnitResult["resource"],
  status: RecoveryUnitResult["status"],
): RecoveryUnitResult {
  return Object.freeze({
    unitId: unit.id,
    effectIds: unit.effectIds,
    ...(resource === undefined ? {} : { resource }),
    status,
  });
}

function summarizeError(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (error instanceof Error) {
    const code = (error as Error & { readonly code?: unknown }).code;
    return {
      code: typeof code === "string" ? code : error.name,
      message: error.message,
    };
  }
  return { code: "UnknownError", message: String(error) };
}
