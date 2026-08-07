/** Durable Effect store-row projection helpers. @internal @module */

import type { EffectReceipt, RecoveryEnvelope } from "../receipt-types";
import type {
  DurableEffectEnvelopeRecord,
  DurableEffectReceiptRecord,
  DurableEffectRecoveryUnitRecord,
} from "./durable-records";
import type {
  RegisteredRecoveryUnit,
  StoredRecoveryEnvelope,
} from "./recovery-stack";

/** Project one in-process receipt into its durable store row. */
export function durableReceiptRecord(
  namespace: string,
  receipt: EffectReceipt,
  executionIdempotencyKey: string,
  revision: number,
  appendOrder?: number,
): DurableEffectReceiptRecord {
  return {
    namespace,
    receipt,
    executionIdempotencyKey,
    ...(appendOrder === undefined ? {} : { appendOrder }),
    revision,
  };
}

/** Project one in-process recovery unit without its executable handler. */
export function durableUnitRecord(
  namespace: string,
  unit: RegisteredRecoveryUnit,
  effectVersion: number,
  revision: number,
  appendOrder?: number,
): DurableEffectRecoveryUnitRecord {
  return {
    namespace,
    kind: unit.kind,
    ...(unit.kind === "boundary" ? { scope: unit.scope } : {}),
    unit: Object.freeze({
      id: unit.id,
      boundaryId: unit.boundaryId,
      receiptIds: unit.receiptIds,
      effectIds: unit.effectIds,
      status: unit.status,
      idempotencyKey: unit.idempotencyKey,
    }),
    effectVersion,
    ...(appendOrder === undefined ? {} : { appendOrder }),
    revision,
  };
}

/** Project one recovery envelope or its honest non-durable marker. */
export function durableEnvelopeRecord(
  namespace: string,
  stored: StoredRecoveryEnvelope,
  revision: number,
): DurableEffectEnvelopeRecord {
  const envelope: RecoveryEnvelope | undefined = stored.durable
    ? {
        schemaVersion: 1,
        receiptId: stored.receiptId,
        effectId: stored.effectId,
        effectVersion: stored.effectVersion,
        ...(stored.input === undefined ? {} : { input: stored.input }),
        ...(stored.output === undefined ? {} : { output: stored.output }),
        ...(stored.captured === undefined ? {} : { captured: stored.captured }),
        createdAt: stored.createdAt,
      } as RecoveryEnvelope
    : undefined;
  return {
    namespace,
    receiptId: stored.receiptId,
    durable: stored.durable,
    ...(envelope ? { envelope } : {}),
    revision,
  };
}
