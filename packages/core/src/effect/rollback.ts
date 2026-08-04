/**
 * Delayed rollback of an effect scope.
 *
 * @module
 */

import { CruxEffectError } from "./errors";
import {
  assertEffectBoundaryRollbackAllowed,
  effectBoundaryStateFor,
  startEffectBoundaryRollback,
} from "./internal/boundary";
import { effectLedger } from "./internal/ledger";
import {
  persistDurableEffectScopeTransition,
  restoreDurableEffectScope,
} from "./internal/ledger-durable";
import { runRollback } from "./internal/run-rollback";
import type {
  EffectScopeRef,
  RollbackOptions,
  RollbackResult,
} from "./types";

/**
 * Recover the completed effects owned by a scope.
 *
 * @param scope - Scope reference returned by a rollback boundary.
 * @param options - Recovery reason, conflict policy, and cancellation.
 * @returns The aggregate and per-unit rollback settlements.
 *
 * @example
 * ```ts
 * const effects = await rollbackOnError(async (scope) => {
 *   await publishReport()
 *   return scope.ref
 * })
 * const result = await rollback(effects, {
 *   reason: "Customer rejected the publication",
 * })
 * ```
 */
export async function rollback(
  scope: EffectScopeRef,
  options?: RollbackOptions,
): Promise<RollbackResult> {
  assertEffectScopeRef(scope);
  await restoreDurableEffectScope(scope);
  const storedScope = effectLedger.getScope(scope.id);
  if (!storedScope || storedScope.ref.runId !== scope.runId) {
    throw new CruxEffectError({
      code: "EFFECT_SCOPE_NOT_FOUND",
      message: `Effect scope \`${scope.id}\` was not found.`,
    });
  }
  const liveBoundary = effectBoundaryStateFor(storedScope.ref);
  if (liveBoundary && liveBoundary.lifecycle !== "completed") {
    assertEffectBoundaryRollbackAllowed(liveBoundary);
    return (
      await startEffectBoundaryRollback(liveBoundary, options)
    ).result;
  }
  const alreadyCompleted = storedScope.status === "completed";
  if (!alreadyCompleted) {
    effectLedger.registerScope({
      ...storedScope,
      status: "rolling_back",
    });
    await persistDurableEffectScopeTransition(storedScope.ref.id);
  }
  try {
    return (await runRollback(storedScope.ref, options)).result;
  } finally {
    const current = effectLedger.getScope(storedScope.ref.id);
    if (current && !alreadyCompleted) {
      effectLedger.registerScope({
        ...current,
        status: "completed",
        unitIds: effectLedger
          .unitsFor(storedScope.ref.id)
          .map((unit) => unit.id),
      });
      await persistDurableEffectScopeTransition(storedScope.ref.id);
    }
  }
}

function assertEffectScopeRef(
  value: unknown,
): asserts value is EffectScopeRef {
  if (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "effect.scope" &&
    "id" in value &&
    typeof value.id === "string" &&
    "runId" in value &&
    typeof value.runId === "string"
  ) {
    return;
  }
  const id =
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
      ? value.id
      : "unknown";
  throw new CruxEffectError({
    code: "EFFECT_SCOPE_NOT_FOUND",
    message: `Effect scope \`${id}\` was not found.`,
  });
}
