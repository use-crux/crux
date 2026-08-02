/**
 * Collision-resistant Effect boundary identity allocation.
 *
 * @internal
 * @module
 */

import type { EffectScopeRef } from "../types";
import { effectLedger } from "./ledger";

let nextExplicitBoundarySequence = 0;
let nextImplicitBoundaryId = 0;

/** Allocate an explicit boundary ID outside the caller's occupied set. */
export function allocateEffectBoundaryId(
  isOccupied: (id: string) => boolean,
): string {
  let id: string;
  do {
    nextExplicitBoundarySequence += 1;
    id =
      `effect-boundary:${createBoundaryEntropy()}:` +
      nextExplicitBoundarySequence.toString(36);
  } while (isOccupied(id));
  return id;
}

/** Create the one-operation root boundary used by a standalone effect call. */
export function createImplicitRootBoundary(): EffectScopeRef {
  const id = `effect-root:${++nextImplicitBoundaryId}`;
  return Object.freeze({
    kind: "effect.scope",
    id,
    runId: id,
  });
}

/** Close a one-operation root after its effect settles. */
export function closeImplicitRootBoundary(
  boundary: EffectScopeRef,
): void {
  effectLedger.registerScope({
    ref: boundary,
    status: "closed",
    unitIds: effectLedger
      .unitsFor(boundary.id)
      .map((unit) => unit.id),
  });
}

function createBoundaryEntropy(): string {
  const crypto = globalThis.crypto;
  const uuid = crypto?.randomUUID?.();
  if (uuid) return uuid;

  const bytes = new Uint8Array(16);
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }

  return (
    `${Date.now().toString(36)}-` +
    Math.random().toString(36).slice(2)
  );
}
