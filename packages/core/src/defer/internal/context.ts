import { createScopeFacetSlot } from "../../scope/facets";
import { currentScopeFacet, runWithScopeFacet } from "../../scope/kernel";
import type { ExecutionScope } from "../../scope/contracts";
import type { DeferredCallback } from "../types";
import type { DeferredWorkRef } from "../types";
import type { RuntimeTaskTarget } from "../../runtime/api/task";
import type { DeferEvidencePolicy } from "./observability";
import type { ScopeDeferController } from "./invocation-scope";

/** Internal phase in which a callback registration occurs. */
export type DeferRegistrationPhase = "handler" | "drain";

/** Minimal registration boundary installed in the canonical async scope. */
export interface DeferRegistrationScope {
  registerInline(
    callback: DeferredCallback,
    registration: DeferRegistrationContext,
  ): void;
  trackCommit(operation: PromiseLike<unknown>): void;
  stageNamed(
    target: RuntimeTaskTarget,
    input: unknown,
  ): Promise<DeferredWorkRef>;
}

/**
 * Context needed to register authored work without exposing the scope kernel.
 *
 * `evidence` defaults to `public`. The diagnostics-only composition port sets
 * `diagnostics-only` so internal reuse never creates Catalog or user Runs.
 */
export interface DeferRegistrationContext {
  readonly scope: DeferRegistrationScope;
  readonly phase: DeferRegistrationPhase;
  readonly depth: number;
  readonly evidence?: DeferEvidencePolicy;
}

const deferRegistrationSlot =
  createScopeFacetSlot<DeferRegistrationContext>("core.defer-context");
const deferControllerSlot = createScopeFacetSlot<ScopeDeferController>(
  "core.defer-controller",
);

/** Return the nearest invocation capable of accepting deferred work. */
export function currentDeferRegistration():
  | DeferRegistrationContext
  | undefined {
  return currentScopeFacet(deferRegistrationSlot);
}

/** Run work with one defer registration context active. */
export function runWithDeferRegistration<R>(
  context: DeferRegistrationContext,
  callback: () => R,
): R {
  return runWithScopeFacet(deferRegistrationSlot, context, callback);
}

/** Attach the shared defer controller to its owning execution scope. */
export function setScopeDeferController(
  scope: ExecutionScope,
  controller: ScopeDeferController,
): void {
  scope.setFacet(deferControllerSlot, controller);
}

/** Return the nearest persistent defer controller for the active scope. */
export function currentScopeDeferController():
  | ScopeDeferController
  | undefined {
  return currentScopeFacet(deferControllerSlot);
}

/** Resolve the nearest persistent defer controller from an explicit scope. */
export function deferControllerForScope(
  scope: ExecutionScope,
): ScopeDeferController | undefined {
  return scope.facet(deferControllerSlot);
}

/** Track an operation in the owning invocation's strict commit barrier. */
export function trackDeferCommit(operation: PromiseLike<unknown>): void {
  const registration = currentDeferRegistration();
  if (!registration) {
    throw new Error(
      "Cannot track a defer commit without an active invocation.",
    );
  }
  registration.scope.trackCommit(operation);
}
