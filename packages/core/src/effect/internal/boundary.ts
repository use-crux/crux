/**
 * Effect rollback-boundary state and resolution.
 *
 * @internal
 * @module
 */

import {
  createScopeFacetSlot,
  currentScopeFacet,
  runScope,
  type ExecutionScope,
} from "../../scope/internal";
import { CruxEffectError } from "../errors";
import type {
  EffectScopeRef,
  RollbackOnErrorOptions,
  RollbackOptions,
} from "../types";
import { allocateEffectBoundaryId } from "./boundary-identity";
import { effectLedger } from "./ledger";
import { registerNestedBoundaryUnit } from "./recovery-stack";
import {
  runRollback,
  type RollbackExecution,
} from "./run-rollback";

const effectBoundaryStates = new Map<string, EffectBoundaryState>();

/** In-process state attached to one explicit effect boundary. */
export interface EffectBoundaryState {
  /** Public boundary reference. */
  readonly ref: EffectScopeRef;
  /** Recovery guarantee enforced by the boundary. */
  readonly recovery:
    | NonNullable<RollbackOnErrorOptions["recovery"]>
    | "passive";
  /** Effect operations that began inside the boundary and remain unsettled. */
  readonly pending: Set<Promise<unknown>>;
  /** Nearest enclosing effect boundary, when nested. */
  readonly parent?: EffectBoundaryState;
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
  parent?: EffectBoundaryState,
): EffectBoundaryState {
  return createEffectBoundaryState(
    Object.freeze({
      kind: "effect.scope",
      id: scope.descriptor.id,
      runId: scope.root.descriptor.id,
    }),
    recovery,
    parent,
  );
}

/** Run work inside a passive in-process rollback boundary. */
export function runPassiveEffectBoundary<T>(
  runId: string,
  run: (boundary: EffectBoundaryState) => Promise<T> | T,
  existingRef?: EffectScopeRef,
): Promise<T> {
  const parent = currentEffectBoundary();
  const locatedScope =
    existingRef?.kind === "effect.scope" &&
    existingRef.runId === runId
      ? effectLedger.getScope(existingRef.id)
      : undefined;
  const existingScope =
    existingRef &&
    locatedScope?.ref.id === existingRef.id &&
    locatedScope.ref.runId === existingRef.runId
      ? locatedScope
      : undefined;
  const ref =
    existingScope?.ref ??
    Object.freeze({
      kind: "effect.scope" as const,
      id: createEffectBoundaryId(existingRef?.id),
      runId,
    });
  const operation = runScope(
    { kind: "effect-boundary", id: ref.id },
    {},
    async (scope) => {
      const boundary = createEffectBoundaryState(
        ref,
        "passive",
        parent,
        existingScope?.status === "rolling_back" ||
          existingScope?.status === "completed"
          ? "completed"
          : "open",
      );
      scope.setFacet(effectBoundaryFacet, boundary);
      if (boundary.lifecycle === "open") {
        effectLedger.registerScope({
          ref: boundary.ref,
          ...(existingScope?.parentId
            ? { parentId: existingScope.parentId }
            : parent === undefined
              ? {}
              : { parentId: parent.ref.id }),
          status: "open",
          unitIds: effectLedger
            .unitsFor(boundary.ref.id)
            .map((unit) => unit.id),
        });
      }
      try {
        return await run(boundary);
      } finally {
        await waitForEffectBoundaryOperations(boundary);
        const rollback = boundary.rollbackOperation
          ? await boundary.rollbackOperation.catch(() => undefined)
          : undefined;
        if (!boundary.rollbackOperation && boundary.lifecycle === "open") {
          closeEffectBoundary(boundary);
        }
        if (parent) {
          registerNestedBoundaryUnit(
            parent.ref.id,
            boundary.ref,
            rollback?.result.status === "completed"
              ? "recovered"
              : rollback === undefined
                ? "active"
                : "failed",
          );
        }
      }
    },
  );
  return trackEffectBoundaryOperation(operation, parent);
}

function createEffectBoundaryState(
  ref: EffectScopeRef,
  recovery: EffectBoundaryState["recovery"],
  parent?: EffectBoundaryState,
  lifecycle: EffectBoundaryState["lifecycle"] = "open",
): EffectBoundaryState {
  const boundary: EffectBoundaryState = {
    ref,
    recovery,
    pending: new Set<Promise<unknown>>(),
    ...(parent === undefined ? {} : { parent }),
    lifecycle,
  };
  effectBoundaryStates.set(ref.id, boundary);
  return boundary;
}

/** Resolve live in-process state for a public boundary reference. */
export function effectBoundaryStateFor(ref: EffectScopeRef):
  | EffectBoundaryState
  | undefined {
  const boundary = effectBoundaryStates.get(ref.id);
  return boundary?.ref.runId === ref.runId ? boundary : undefined;
}

/** Resolve the nearest explicit effect boundary. */
export function currentEffectBoundary(): EffectBoundaryState | undefined {
  return currentScopeFacet(effectBoundaryFacet);
}

/** Reject effect admission after rollback has made a boundary terminal. */
export function assertEffectBoundaryOpen(
  boundary: EffectBoundaryState,
  effectId: string,
): void {
  let candidate: EffectBoundaryState | undefined = boundary;
  while (
    candidate?.lifecycle === "open" &&
    effectLedger.getScope(candidate.ref.id)?.status === "open"
  ) {
    candidate = candidate.parent;
  }
  if (!candidate) return;
  throw new CruxEffectError({
    code: "EFFECT_SCOPE_TERMINAL",
    message:
      `Effect \`${effectId}\` cannot start because boundary ` +
      `\`${candidate.ref.id}\` is terminal.`,
  });
}

/** Track an effect promise on the nearest explicit boundary. */
export function trackEffectBoundaryOperation<T>(
  operation: Promise<T>,
  boundary = currentEffectBoundary(),
): Promise<T> {
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
  if (boundary.rollbackOperation) return boundary.rollbackOperation;
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

/** Reject rollback requests initiated from a descendant boundary. */
export function assertEffectBoundaryRollbackAllowed(
  boundary: EffectBoundaryState,
): void {
  const active = currentEffectBoundary();
  let candidate = active;
  while (candidate && candidate !== boundary) {
    candidate = candidate.parent;
  }
  if (!active || active === boundary || candidate !== boundary) return;
  throw new CruxEffectError({
    code: "EFFECT_SCOPE_TERMINAL",
    message:
      `Boundary \`${boundary.ref.id}\` cannot start rollback from ` +
      `descendant boundary \`${active.ref.id}\`.`,
  });
}

/** Close a boundary that completed without rollback. */
export function closeEffectBoundary(
  boundary: EffectBoundaryState,
): void {
  boundary.lifecycle = "closed";
  updateBoundaryRecord(boundary, "closed");
}

/** Allocate a unique kernel descriptor id for one explicit boundary. */
export function createEffectBoundaryId(excludedId?: string): string {
  return allocateEffectBoundaryId(
    (id) =>
      id === excludedId ||
      effectBoundaryStates.has(id) ||
      effectLedger.getScope(id) !== undefined,
  );
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
