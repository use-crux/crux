/**
 * Stable in-process identity for effect occurrences.
 *
 * @internal
 * @module
 */

import type {
  EffectReceiptRef,
  EffectScopeRef,
} from "../types";

let nextOccurrenceId = 0;
let nextRecoveryAttemptId = 0;
const nextIndexByIdentity = new Map<string, number>();

/** Reset process-local occurrence identity to simulate a fresh process in tests. */
export function resetEffectOccurrencesForTesting(): void {
  nextOccurrenceId = 0;
  nextRecoveryAttemptId = 0;
  nextIndexByIdentity.clear();
}

/** Identity allocated before one custom effect executor runs. */
export interface EffectOccurrence {
  /** Stable receipt identifier. */
  readonly receiptId: string;
  /** Stable execution idempotency key. */
  readonly idempotencyKey: string;
  /** Stable recovery-unit identifier. */
  readonly recoveryUnitId: string;
  /** Stable recovery idempotency key. */
  readonly recoveryIdempotencyKey: string;
  /** Deterministic active kernel-scope path. */
  readonly scopePath: string;
  /** Repetition index within the same boundary, path, and definition. */
  readonly index: number;
}

/** Allocate receipt and execution identity for one in-process occurrence. */
export function createEffectOccurrence(
  boundary: EffectScopeRef,
  scopePath: string,
  effectId: string,
  effectVersion: number,
): EffectOccurrence {
  const identity =
    `${boundary.id}\u0000${scopePath}\u0000` +
    `${effectId}\u0000${effectVersion}`;
  const index = (nextIndexByIdentity.get(identity) ?? 0) + 1;
  nextIndexByIdentity.set(identity, index);
  const receiptIndex = ++nextOccurrenceId;
  const key =
    `${boundary.id}:${scopePath}:${effectId}:${effectVersion}:${index}`;
  return Object.freeze({
    receiptId: `effect-receipt:${receiptIndex}`,
    idempotencyKey: `effect-execution:${key}`,
    recoveryUnitId: `effect-unit:${receiptIndex}`,
    recoveryIdempotencyKey: `effect-recovery:${key}`,
    scopePath,
    index,
  });
}

/** Create the public reference for one allocated receipt. */
export function createEffectReceiptRef(
  id: string,
  effectId: string,
): EffectReceiptRef {
  return Object.freeze({
    kind: "effect.receipt",
    id,
    effectId,
  });
}

/** Allocate a receipt identifier for one recovery-handler attempt. */
export function createRecoveryAttemptReceiptId(): string {
  return `effect-recovery-receipt:${++nextRecoveryAttemptId}`;
}
