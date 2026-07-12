import type { DeferredCallback } from "../types";
import { currentDeferRegistration } from "./context";

/**
 * Schedule internal callback work with diagnostics-only evidence.
 *
 * This source-internal port deliberately has no evidence/visibility option and
 * no package export. Public authoring must use `defer()` instead.
 *
 * @internal
 */
export function scheduleDiagnosticsOnlyDeferredCallback(
  callback: DeferredCallback,
): void {
  const registration = currentDeferRegistration();
  if (!registration) {
    throw new Error(
      "Internal deferred callback scheduling requires an active invocation.",
    );
  }
  registration.scope.registerInline(callback, {
    ...registration,
    evidence: "diagnostics-only",
  });
}
