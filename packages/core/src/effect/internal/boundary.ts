/**
 * Effect rollback-boundary state and resolution.
 *
 * @internal
 * @module
 */

import {
  createScopeFacetSlot,
  currentScopeFacet,
  type ExecutionScope,
} from "../../scope/internal";
import type {
  EffectScopeRef,
  RollbackOnErrorOptions,
} from "../types";

let nextImplicitBoundaryId = 0;
let nextExplicitBoundaryId = 0;

/** In-process state attached to one explicit effect boundary. */
export interface EffectBoundaryState {
  /** Public boundary reference. */
  readonly ref: EffectScopeRef;
  /** Recovery guarantee enforced by the boundary. */
  readonly recovery: NonNullable<RollbackOnErrorOptions["recovery"]>;
  /** Effect operations that began inside the boundary and remain unsettled. */
  readonly pending: Set<Promise<unknown>>;
}

/** Typed scope-kernel slot for the nearest effect boundary. */
export const effectBoundaryFacet =
  createScopeFacetSlot<EffectBoundaryState>("effect.boundary");

/** Create explicit boundary state from a live kernel scope. */
export function createEffectBoundary(
  scope: ExecutionScope,
  recovery: EffectBoundaryState["recovery"],
): EffectBoundaryState {
  return Object.freeze({
    ref: Object.freeze({
      kind: "effect.scope",
      id: scope.descriptor.id,
      runId: scope.root.descriptor.id,
    }),
    recovery,
    pending: new Set<Promise<unknown>>(),
  });
}

/** Resolve the nearest explicit effect boundary. */
export function currentEffectBoundary():
  | EffectBoundaryState
  | undefined {
  return currentScopeFacet(effectBoundaryFacet);
}

/** Track an effect promise on the nearest explicit boundary. */
export function trackEffectBoundaryOperation<T>(
  operation: Promise<T>,
): Promise<T> {
  const boundary = currentEffectBoundary();
  if (!boundary) return operation;
  const tracked: Promise<unknown> = operation;
  boundary.pending.add(tracked);
  const remove = () => boundary.pending.delete(tracked);
  void operation.then(remove, remove);
  return operation;
}

/** Wait until every already-started effect in a boundary has settled. */
export async function waitForEffectBoundaryOperations(
  boundary: EffectBoundaryState,
): Promise<void> {
  while (boundary.pending.size > 0) {
    await Promise.allSettled([...boundary.pending]);
  }
}

/** Allocate a unique kernel descriptor id for one explicit boundary. */
export function createEffectBoundaryId(): string {
  return `effect-boundary:${++nextExplicitBoundaryId}`;
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
