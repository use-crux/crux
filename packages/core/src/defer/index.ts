import { createDeferError } from "./errors";
import { asyncScopeActive } from "../async-scope/internal/carrier";
import { currentDeferRegistration } from "./internal/context";

export { CruxDeferError, DEFER_ERROR_CODES } from "./errors";
export type { CruxDeferErrorCode, DeferErrorInput } from "./errors";
export type { Awaitable, DeferredCallback } from "./types";
import type { DeferredCallback } from "./types";

/**
 * Register work to start after the active host completion boundary.
 *
 * The callback is lazy and this function always returns `void`. Inline work is
 * invocation-scoped; use a named Runtime target when durability is required.
 */
export function defer(callback: DeferredCallback): void {
  const registration = currentDeferRegistration();
  if (registration) {
    registration.scope.registerInline(callback, registration);
    return;
  }
  if (asyncScopeActive()) {
    throw createDeferError({
      code: "DEFER_CAPABILITY_MISSING",
      message:
        "The active Crux scope has no compatible host lifetime capability for inline defer().",
    });
  }
  throw createDeferError({
    code: "DEFER_SCOPE_REQUIRED",
    message: "defer() requires an active Crux invocation scope.",
  });
}
