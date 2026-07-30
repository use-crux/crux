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
import { CruxEffectError } from "../errors";
import type {
  EffectScopeRef,
  RollbackOnErrorOptions,
  RollbackOptions,
} from "../types";
import { effectLedger } from "./ledger";
import {
  runRollback,
  type RollbackExecution,
} from "./run-rollback";

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
  /** Current boundary lifecycle. */
  lifecycle: "open" | "rolling_back" | "completed" | "closed";
  /** Shared rollback operation once rollback begins. */
  rollbackOperation?: Promise<RollbackExecution>;
}

/** Typed scope-kernel slot for the nearest effect boundary. */
export const effectBoundaryFacet =
  createScopeFacetSlot<EffectBoundaryState>("effect.boundary");

/** Create explicit boundary state from a live kernel scope. */
export function createEffectBoundary(
  scope: ExecutionScope,
  recovery: EffectBoundaryState["recovery"],
): EffectBoundaryState {
  return {
    ref: Object.freeze({
      kind: "effect.scope",
      id: scope.descriptor.id,
      runId: scope.root.descriptor.id,
    }),
    recovery,
    pending: new Set<Promise<unknown>>(),
    lifecycle: "open",
  };
}

/** Resolve the nearest explicit effect boundary. */
export function currentEffectBoundary():
  | EffectBoundaryState
  | undefined {
  return currentScopeFacet(effectBoundaryFacet);
}

/** Reject effect admission after rollback has made a boundary terminal. */
export function assertEffectBoundaryOpen(
  boundary: EffectBoundaryState,
  effectId: string,
): void {
  if (boundary.lifecycle === "open") return;
  throw new CruxEffectError({
    code: "EFFECT_SCOPE_TERMINAL",
    message:
      `Effect \`${effectId}\` cannot start because boundary ` +
      `\`${boundary.ref.id}\` is terminal.`,
  });
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

/** Start or join rollback for one explicit boundary. */
export function startEffectBoundaryRollback(
  boundary: EffectBoundaryState,
  options?: RollbackOptions,
): Promise<RollbackExecution> {
  if (boundary.rollbackOperation) {
    return boundary.rollbackOperation;
  }
  boundary.lifecycle = "rolling_back";
  updateBoundaryRecord(boundary, "rolling_back");
  const operation = (async () => {
    try {
      await waitForEffectBoundaryOperations(boundary);
      return await runRollback(boundary.ref, options);
    } finally {
      boundary.lifecycle = "completed";
      updateBoundaryRecord(boundary, "completed");
    }
  })();
  boundary.rollbackOperation = operation;
  return operation;
}

/** Close a boundary that completed without rollback. */
export function closeEffectBoundary(
  boundary: EffectBoundaryState,
): void {
  boundary.lifecycle = "closed";
  updateBoundaryRecord(boundary, "closed");
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

function updateBoundaryRecord(
  boundary: EffectBoundaryState,
  status: "rolling_back" | "completed" | "closed",
): void {
  const scope = effectLedger.getScope(boundary.ref.id);
  if (!scope) {
    throw new TypeError(
      `Effect boundary \`${boundary.ref.id}\` was not found.`,
    );
  }
  effectLedger.registerScope({
    ...scope,
    status,
    unitIds: effectLedger
      .unitsFor(boundary.ref.id)
      .map((unit) => unit.id),
  });
}
