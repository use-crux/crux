/**
 * Resolve Next.js `after()` without importing it into `@use-crux/core`.
 *
 * @module
 */

import { CruxDeferError } from "@use-crux/core";
import type { DeferAfterPort } from "@use-crux/core/defer/serverless";
import { after as nextServerAfter } from "next/server";

/**
 * Load and validate `after` from `next/server`.
 *
 * Requires Next.js 15.1+ where `after` is a stable server export. Unsupported
 * versions fail with `DEFER_CAPABILITY_MISSING` and an exact remediation.
 *
 * @param override - Test or shim injection. Production callers omit this.
 */
export function resolveNextAfterPort(
  override?: DeferAfterPort,
): DeferAfterPort {
  if (override !== undefined) {
    if (typeof override === "function") return override;
    throw missingAfterError();
  }
  if (typeof nextServerAfter === "function") {
    return (task) => {
      nextServerAfter(task);
    };
  }
  throw missingAfterError();
}

function missingAfterError(): CruxDeferError {
  return new CruxDeferError({
    code: "DEFER_CAPABILITY_MISSING",
    message:
      "Next.js after() is required for @use-crux/next deferred work. Upgrade to Next.js 15.1+ (next/server after), wrap the route with withNextDefer, or use await defer(target, input) with a configured Runtime.",
  });
}
