import { createAsyncScopeFacet } from "../../async-scope";
import type { DeferredCallback } from "../types";
import type { DeferredWorkRef } from "../types";
import type { RuntimeTaskTarget } from "../../runtime/api/task";
import type { DeferEvidencePolicy } from "./observability";

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

const deferRegistrationScope = createAsyncScopeFacet<DeferRegistrationContext>(
  "core.defer-registration",
);

/** Return the nearest invocation capable of accepting deferred work. */
export function currentDeferRegistration():
  | DeferRegistrationContext
  | undefined {
  return deferRegistrationScope.current();
}

/** Run work with one defer registration context active. */
export function runWithDeferRegistration<R>(
  context: DeferRegistrationContext,
  callback: () => R,
): R {
  return deferRegistrationScope.run(context, callback);
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
