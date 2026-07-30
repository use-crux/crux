/**
 * Stable in-process identity for effect occurrences.
 *
 * @internal
 * @module
 */

import type { EffectScopeRef } from "../types";

let nextOccurrenceId = 0;

/** Identity allocated before one custom effect executor runs. */
export interface EffectOccurrence {
  /** Stable receipt identifier. */
  readonly receiptId: string;
  /** Stable execution idempotency key. */
  readonly idempotencyKey: string;
}

/** Allocate receipt and execution identity for one in-process occurrence. */
export function createEffectOccurrence(
  boundary: EffectScopeRef,
  effectId: string,
  effectVersion: number,
): EffectOccurrence {
  const index = ++nextOccurrenceId;
  return Object.freeze({
    receiptId: `effect-receipt:${index}`,
    idempotencyKey:
      `effect-execution:${boundary.id}:${effectId}:${effectVersion}:${index}`,
  });
}
