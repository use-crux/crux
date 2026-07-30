/**
 * Delayed rollback of an effect scope.
 *
 * @module
 */

import { CruxEffectError } from "./errors";
import { effectLedger } from "./internal/ledger";
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
  const storedScope = effectLedger.getScope(scope.id);
  if (!storedScope || storedScope.ref.runId !== scope.runId) {
    throw new CruxEffectError({
      code: "EFFECT_SCOPE_NOT_FOUND",
      message: `Effect scope \`${scope.id}\` was not found.`,
    });
  }
  return (await runRollback(storedScope.ref, options)).result;
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
