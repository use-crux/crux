/**
 * Recover one custom effect receipt.
 *
 * @module
 */

import {
  assertEffectReceiptRef,
  CruxEffectError,
  EffectOutcomeUnknownError,
  effectReceiptNotFound,
  summarizeEffectError,
} from "./errors";
import type { EffectReceipt } from "./receipt-types";
import {
  createRecoveryUnitResult,
  type RecoveryOperationResult,
} from "./internal/recovery-stack";
import { effectLedger } from "./internal/ledger";
import {
  prepareDurableEffectRecovery,
  restoreDurableEffectReceiptScope,
  settleDurableEffectRecovery,
  settleDurableEffectRecoveryFailure,
  settleDurableEffectRecoveryUnavailable,
} from "./internal/ledger-durable";
import { createRecoveryAttemptReceiptId } from "./internal/occurrence";
import { reconcileEffectReceipt } from "./internal/reconcile";
import { recordEffectRecoveryAttempt } from "./internal/evidence";
import { observeEffectRecoveryRun } from "./internal/observability";
import type {
  EffectReconciliation,
  EffectReceiptRef,
  RecoverOptions,
  RecoveryUnitResult,
} from "./types";
import { currentDurableEffectLedgerBinding } from "./internal/durable-binding";
import { invokeEffectRecoveryDefinition } from "./internal/recovery-definition";
import { resolveRuntimeEffectTarget } from "../runtime/effect-targets";

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
 * Reconcile an effect execution whose external outcome was unknown.
 *
 * @param receipt - Ambiguous receipt to settle.
 * @param resolution - Confirmed outcome and audit reason.
 * @returns The reconciled immutable receipt.
 *
 * @example
 * ```ts
 * await reconcileEffect(receipt, {
 *   outcome: "failed",
 *   reason: "The provider confirms no change was made",
 * })
 * ```
 */
export async function reconcileEffect(
  receipt: EffectReceiptRef,
  resolution: EffectReconciliation,
): Promise<EffectReceipt> {
  await restoreDurableEffectReceiptScope(receipt.id);
  return reconcileEffectReceipt(receipt, resolution);
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
  assertEffectReceiptRef(receipt);
  await restoreDurableEffectReceiptScope(receipt.id);
  const storedReceipt = effectLedger.getReceipt(receipt.id);
  if (
    !storedReceipt ||
    storedReceipt.effectId !== receipt.effectId
  ) {
    throw effectReceiptNotFound(receipt.id);
  }
  if (storedReceipt.outcome === "unknown") {
    return Object.freeze({
      result: createRecoveryUnitResult(
        {
          id:
            storedReceipt.recoveryUnitId ??
            `effect-unit:${storedReceipt.id}`,
          effectIds: [storedReceipt.effectId],
        },
        storedReceipt.resource,
        "ambiguous",
      ),
    });
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
  if (unit.kind !== "effect") {
    throw effectReceiptNotFound(receipt.id);
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
      result: createRecoveryUnitResult(
        unit,
        storedReceipt.resource,
        "already_recovered",
      ),
    });
  }
  if (unit.status === "recovering" && unit.recoveryOperation) {
    return unit.recoveryOperation;
  }

  const envelope = effectLedger.getEnvelope(storedReceipt.id);
  if (!envelope) {
    return Object.freeze({
      result: createRecoveryUnitResult(
        unit,
        storedReceipt.resource,
        "unavailable",
      ),
    });
  }
  const durableBinding = currentDurableEffectLedgerBinding();
  const runtimeDefinition = unit.execute
    ? undefined
    : resolveRuntimeEffectTarget(
        durableBinding?.program,
        storedReceipt.effectId,
        storedReceipt.effectVersion,
      );
  if (!unit.execute && !runtimeDefinition) {
    const unavailable = new CruxEffectError({
      code: "EFFECT_RECOVERY_HANDLER_UNAVAILABLE",
      message:
        `Recovery handler for Effect \`${storedReceipt.effectId}\` version ` +
        `${storedReceipt.effectVersion} is unavailable in the active Runtime program.`,
    });
    effectLedger.markReceiptRecovery(storedReceipt.id, "handler_unavailable");
    effectLedger.markUnit(unit.id, "failed");
    await settleDurableEffectRecoveryUnavailable({
      receiptId: storedReceipt.id,
      unitId: unit.id,
    });
    return Object.freeze({
      result: Object.freeze({
        ...createRecoveryUnitResult(
          unit,
          storedReceipt.resource,
          "handler_unavailable",
        ),
        error: summarizeEffectError(unavailable),
      }),
    });
  }

  const operation = Promise.resolve().then(
    async (): Promise<EffectRecoveryAttempt> => {
      const attemptId = createRecoveryAttemptReceiptId();
      const observation = observeEffectRecoveryRun(storedReceipt, attemptId);
      return observation.run(async () => {
      const attempt = effectLedger.createReceipt({
        id: attemptId,
        effectId: storedReceipt.effectId,
        effectVersion: storedReceipt.effectVersion,
        scopeId: storedReceipt.scopeId,
        boundaryId: storedReceipt.boundaryId,
        parentReceiptId: storedReceipt.id,
        recoveryUnitId: unit.id,
        ...(storedReceipt.runId === undefined
          ? {}
          : { runId: storedReceipt.runId }),
        spanId: observation.spanId,
        recovery: "unavailable",
        startedAt: Date.now(),
      });
      effectLedger.transition(attempt.id, {
        outcome: "running",
        ...(storedReceipt.resource === undefined
          ? {}
          : { resource: storedReceipt.resource }),
      });
      await prepareDurableEffectRecovery({
        attemptReceiptId: attempt.id,
        originalReceiptId: storedReceipt.id,
        unitId: unit.id,
      });
      try {
        const invocation = {
          envelope,
          receipt: Object.freeze({
            kind: "effect.receipt",
            id: storedReceipt.id,
            effectId: storedReceipt.effectId,
          }),
          resource: storedReceipt.resource,
          idempotencyKey: unit.idempotencyKey,
          options,
        };
        if (unit.execute) {
          await unit.execute(invocation);
        } else {
          await invokeEffectRecoveryDefinition(
            runtimeDefinition!,
            invocation,
          );
        }
        const settledAttempt = effectLedger.transition(attempt.id, {
          outcome: "succeeded",
          completedAt: Date.now(),
        });
        effectLedger.markUnit(unit.id, "recovered");
        const original = effectLedger.markReceiptRecovery(
          storedReceipt.id,
          "recovered",
        );
        await settleDurableEffectRecovery({
          attemptReceiptId: attempt.id,
          originalReceiptId: storedReceipt.id,
          unitId: unit.id,
        });
        recordEffectRecoveryAttempt(original, settledAttempt);
        observation.settle(settledAttempt);
        return Object.freeze({
          result: createRecoveryUnitResult(
            unit,
            storedReceipt.resource,
            "recovered",
          ),
        });
      } catch (error) {
        if (error instanceof EffectOutcomeUnknownError) {
          const settledAttempt = effectLedger.transition(attempt.id, {
            outcome: "unknown",
            recovery: "ambiguous",
            completedAt: Date.now(),
            error: summarizeEffectError(error),
          });
          const original = effectLedger.markReceiptRecovery(
            storedReceipt.id,
            "ambiguous",
          );
          recordEffectRecoveryAttempt(original, settledAttempt);
          observation.settle(settledAttempt);
          return Object.freeze({
            result: Object.freeze({
              ...createRecoveryUnitResult(
                unit,
                storedReceipt.resource,
                "ambiguous",
              ),
              error: summarizeEffectError(error),
            }),
            error,
          });
        }
        const settledAttempt = effectLedger.transition(attempt.id, {
          outcome: "failed",
          completedAt: Date.now(),
          error: summarizeEffectError(error),
        });
        effectLedger.markUnit(unit.id, "failed");
        await settleDurableEffectRecoveryFailure({
          attemptReceiptId: attempt.id,
          unitId: unit.id,
        });
        recordEffectRecoveryAttempt(storedReceipt, settledAttempt);
        observation.settle(settledAttempt);
        return Object.freeze({
          result: Object.freeze({
            ...createRecoveryUnitResult(
              unit,
              storedReceipt.resource,
              "failed",
            ),
            error: summarizeEffectError(error),
          }),
          error,
        });
      }
      });
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
    throw effectReceiptNotFound(
      isRecord(receipt) && typeof receipt.id === "string"
        ? receipt.id
        : "unknown",
    );
  }
  return recover(receipt, options);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
