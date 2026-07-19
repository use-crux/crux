import type { DeferredCallback } from "../types";
import { resolveDeferRegistration } from "./registration";

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
  const registration = resolveDeferRegistration();
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
