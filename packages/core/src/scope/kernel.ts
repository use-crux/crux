import { createAsyncScopeFacet } from "../async-scope";
import { getHooks } from "../runtime/runtime";
import {
  captureAsyncScope,
  runWithCapturedAsyncScope,
  type CapturedAsyncScope,
} from "../async-scope/internal/carrier";
import {
  type ExecutionScope,
  type RunScopeOptions,
  type ScopeCloseHook,
  type ScopeCloseOutcome,
  type ScopeController,
  type ScopeWriteOptions,
} from "./contracts";
import type { ScopeFacetSlot } from "./facets";
import { isThenable } from "./lifecycle";
import { currentScopeFacetOverride } from "./overrides";
import {
  allocateScopeId,
  createExecutionScope,
  resolveWritableScope,
  setScopeCapturedFrame,
  waitForRootIdle,
} from "./state";
import type { ScopeDescriptor, ScopeOutcome } from "./types";
import type { CruxHostBinding } from "./types";

export { ScopeSealedError } from "./contracts";
export type {
  ExecutionScope,
  RunScopeOptions,
  ScopeCloseHook,
  ScopeCloseOutcome,
  ScopeController,
  ScopeWriteOptions,
} from "./contracts";

const executionScopeFacet = createAsyncScopeFacet<ExecutionScope>("core.scope");

/** Open a manually sealed execution scope for segmented work such as streams. */
export function openScope(
  descriptor: Omit<ScopeDescriptor, "id"> & { id?: string },
  options: Pick<RunScopeOptions, "policies">,
): ScopeController {
  const parent = executionScopeFacet.current();
  const provisionalId =
    descriptor.id ??
    (parent
      ? allocateScopeId(parent, descriptor.kind)
      : `${descriptor.kind}:1`);
  const scope = createExecutionScope(
    { ...descriptor, id: provisionalId },
    parent,
    options.policies,
  );
  let capturedFrame: CapturedAsyncScope | undefined;
  executionScopeFacet.run(scope, () => {
    capturedFrame = captureAsyncScope();
  });
  setScopeCapturedFrame(scope, capturedFrame as CapturedAsyncScope);

  return Object.freeze({
    scope,
    run<T>(segment: () => T | PromiseLike<T>): T | PromiseLike<T> {
      return runWithCapturedAsyncScope(
        capturedFrame as CapturedAsyncScope,
        segment,
      );
    },
    seal(outcome: ScopeCloseOutcome): void {
      scope.seal(outcome);
    },
  });
}

/** Run one function-shaped execution scope and seal it from its settlement. */
export async function runScope<R>(
  descriptor: Omit<ScopeDescriptor, "id"> & { id?: string },
  options: RunScopeOptions,
  fn: (scope: ExecutionScope) => R | PromiseLike<R>,
): Promise<Awaited<R>> {
  const controller = openScope(descriptor, options);
  let result: Awaited<R>;
  try {
    result = (await controller.run(() => fn(controller.scope))) as Awaited<R>;
  } catch (error) {
    controller.seal(
      classifyOrSealError(controller, options, { kind: "thrown", error }),
    );
    throw error;
  }
  controller.seal(
    classifyOrSealError(controller, options, { kind: "returned" }),
  );
  return result;
}

/** Return the nearest active execution scope. */
export function currentScope(): ExecutionScope | undefined {
  return executionScopeFacet.current();
}

/** Resolve an execution-local override before persistent scope facets. */
export function currentScopeFacet<T>(slot: ScopeFacetSlot<T>): T | undefined {
  const override = currentScopeFacetOverride(slot);
  if (override.found) return override.value;
  return currentScope()?.facet(slot);
}

/** Return active scope descriptors from nearest scope to invocation root. */
export function currentScopeStack(): readonly ScopeDescriptor[] {
  const descriptors: ScopeDescriptor[] = [];
  let scope = executionScopeFacet.current();
  while (scope) {
    descriptors.push(scope.descriptor);
    scope = scope.parent;
  }
  return descriptors;
}

/** Wait until the root pending set remains empty through one microtask re-check. */
export function whenRootIdle(scope: ExecutionScope): Promise<void> {
  return waitForRootIdle(scope);
}

/** Resolve the host binding installed by the active config transaction. */
export function resolveConfiguredHost(): CruxHostBinding | undefined {
  return getHooks().hostBinding;
}

/** Resolve the scope on which a write may land under the sealed-write policy. */
function classify(
  options: RunScopeOptions,
  settlement: { kind: "returned" } | { kind: "thrown"; error: unknown },
): ScopeOutcome {
  const outcome =
    options.classifyOutcome?.(settlement) ??
    (settlement.kind === "returned" ? "success" : "error");
  if (isThenable(outcome))
    throw new TypeError("Scope classifyOutcome must return synchronously.");
  return outcome;
}

function classifyOrSealError(
  controller: ScopeController,
  options: RunScopeOptions,
  settlement: { kind: "returned" } | { kind: "thrown"; error: unknown },
): ScopeOutcome {
  try {
    return classify(options, settlement);
  } catch (error) {
    controller.seal("error");
    throw error;
  }
}

export { resolveWritableScope } from "./state";
export { runWithScopeFacet } from "./overrides";
