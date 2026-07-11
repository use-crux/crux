import { createAsyncScopeFacet } from "../../async-scope";
import type { DeferredCallback } from "../types";

/** Internal phase in which a callback registration occurs. */
export type DeferRegistrationPhase = "handler" | "drain";

/** Minimal registration boundary installed in the canonical async scope. */
export interface DeferRegistrationScope {
  registerInline(
    callback: DeferredCallback,
    registration: DeferRegistrationContext,
  ): void;
  trackCommit(operation: PromiseLike<unknown>): void;
}

/** Context needed to register authored work without exposing the scope kernel. */
export interface DeferRegistrationContext {
  readonly scope: DeferRegistrationScope;
  readonly phase: DeferRegistrationPhase;
  readonly depth: number;
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
