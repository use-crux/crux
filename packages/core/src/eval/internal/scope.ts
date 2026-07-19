/** Eval-owned execution-scope boundaries and policies. */

import {
  currentScope,
  openScope,
  runScope,
  type ScopeController,
} from "../../scope/internal";
import { setEvalCaptureSession } from "./capture-context";
import { installSignalCapture } from "./signal-capture";

/** Stable identity needed to name one Eval-cell scope. @internal */
export interface EvalCellScopeIdentity {
  readonly caseId: string;
  readonly variant: string;
  readonly trial: number;
}

/** Run work inside one Eval run with a shared persistent capture session. */
export async function runEvalScope<T>(
  evalId: string,
  fn: () => T | PromiseLike<T>,
): Promise<Awaited<T>> {
  const capture = installSignalCapture();
  try {
    return await runScope({ kind: "eval-run", name: evalId }, {}, (scope) => {
      setEvalCaptureSession(scope, capture);
      return fn();
    });
  } finally {
    capture.dispose();
  }
}

/** Run one call-shaped Eval cell with capture and late-write-drop policies. */
export function runEvalCellScope<T>(
  identity: EvalCellScopeIdentity,
  fn: () => T | PromiseLike<T>,
): Promise<Awaited<T>> {
  return runScope(evalCellDescriptor(identity), evalCellOptions, () => fn());
}

/** Open a manually sealed Eval cell for the remote pre-start deadline path. */
export function openEvalCellScope(
  identity: EvalCellScopeIdentity,
): ScopeController {
  return openScope(evalCellDescriptor(identity), evalCellOptions);
}

/** Ensure direct observed-task callers also execute inside both Eval tiers. */
export async function runWithinEvalScopes<T>(
  evalId: string,
  identity: EvalCellScopeIdentity,
  fn: () => T | PromiseLike<T>,
): Promise<Awaited<T>> {
  if (hasActiveEvalCellScope()) return await fn();
  if (hasActiveEvalRunScope()) return runEvalCellScope(identity, fn);
  return runEvalScope(evalId, () => runEvalCellScope(identity, fn));
}

/** Return true when execution already has both Eval boundary tiers. */
export function hasActiveEvalCellScope(): boolean {
  let scope = currentScope();
  let hasRun = false;
  while (scope) {
    if (scope.descriptor.kind === "eval-cell")
      return hasRun || hasEvalRun(scope);
    if (scope.descriptor.kind === "eval-run") hasRun = true;
    scope = scope.parent;
  }
  return false;
}

function hasActiveEvalRunScope(): boolean {
  let scope = currentScope();
  while (scope) {
    if (scope.descriptor.kind === "eval-run") return true;
    scope = scope.parent;
  }
  return false;
}

function hasEvalRun(
  from: NonNullable<ReturnType<typeof currentScope>>,
): boolean {
  let scope = from.parent;
  while (scope) {
    if (scope.descriptor.kind === "eval-run") return true;
    scope = scope.parent;
  }
  return false;
}

function evalCellDescriptor(identity: EvalCellScopeIdentity) {
  return {
    kind: "eval-cell" as const,
    name: `${identity.caseId}:${identity.variant}:${identity.trial}`,
  };
}

const evalCellOptions = Object.freeze({
  policies: Object.freeze({
    drain: "capture" as const,
    sealedWrites: "drop" as const,
  }),
});
