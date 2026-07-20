/**
 *
 * Run-scoped Eval capture and scope-owned late-write quarantine.
 *
 * Eval captures observability records through Core's canonical async-scope
 * carrier instead of swapping the process transport. Timed-out cells retain
 * their scope, so late writes can be dropped without affecting sibling runs.
 *
 * @internal
 * @module
 */

import type { CruxGraphRecord } from "../../observability/contract";
import { registerEvalObservabilityCaptureHooks } from "../../observability/eval-capture-hooks";
import type { ExecutionScope } from "../../scope/contracts";
import { createScopeFacetSlot } from "../../scope/facets";
import { currentScope, currentScopeFacet } from "../../scope/kernel";

/** Per-run capture sink consumed by the observability emitter. @internal */
export interface EvalCaptureSession {
  send(records: readonly CruxGraphRecord[]): void;
  take(runId: string): CruxGraphRecord[];
  settle(): Promise<void>;
  dispose(): void;
}

const evalCaptureSlot =
  createScopeFacetSlot<EvalCaptureSession>("core.eval-capture");

/** Attach the shared capture session to its owning Eval-run scope. @internal */
export function setEvalCaptureSession(
  scope: ExecutionScope,
  session: EvalCaptureSession,
): void {
  if (scope.descriptor.kind !== "eval-run") {
    throw new TypeError("Eval capture sessions belong to eval-run scopes.");
  }
  scope.setFacet(evalCaptureSlot, session);
}

/** Return the active Eval capture sink, if any. @internal */
export function currentEvalCaptureSession(): EvalCaptureSession | undefined {
  return currentScopeFacet(evalCaptureSlot);
}

/** Return true when a write belongs to a closed drop-policy Eval cell. */
function shouldDropEvalWrite(): boolean {
  let scope = currentScope();
  while (scope) {
    if (scope.descriptor.kind === "eval-cell") {
      return scope.state !== "open" && scope.policies.sealedWrites === "drop";
    }
    scope = scope.parent;
  }
  return false;
}

registerEvalObservabilityCaptureHooks({
  currentCaptureSession: currentEvalCaptureSession,
  shouldQuarantineWrite: shouldDropEvalWrite,
});
