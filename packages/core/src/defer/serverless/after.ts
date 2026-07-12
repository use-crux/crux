/**
 * Response-finished lifetime from an injected after() port.
 *
 * @module
 */

import type { DeferLifetimeCapability, DeferScheduledTask } from "../host-types";
import { createDeferError } from "../errors";
import { SERVERLESS_DEFER_POLICY } from "./policy";
import type { DeferAfterPort } from "./ports";
import type { DeferLifetimeLimits } from "../host-types";

/** Options for {@link createAfterDeferLifetime}. */
export interface AfterDeferLifetimeOptions {
  /**
   * Platform post-response scheduler. Must be supplied explicitly — typically
   * Next.js `after` from `next/server`.
   */
  readonly after: DeferAfterPort;
  /** Whether named `defer(target, input)` may finalize before the response. */
  readonly durableFinalization?: boolean;
  /** Whether inline `defer(callback)` may register. Defaults to `true`. */
  readonly supportsInline?: boolean;
  /** Override fixed V1 limits only when a host is strictly tighter. */
  readonly limits?: DeferLifetimeLimits;
}

/**
 * Create a response-finished lifetime bound to an injected `after` port.
 *
 * Callbacks start only after the host reports response completion. This is the
 * stronger guarantee than waitUntil-style handler-returned retention.
 *
 * @example
 * ```ts
 * import { after } from 'next/server'
 * import { createAfterDeferLifetime } from '@use-crux/core/defer/serverless'
 *
 * const lifetime = createAfterDeferLifetime({ after })
 * ```
 */
export function createAfterDeferLifetime(
  options: AfterDeferLifetimeOptions,
): DeferLifetimeCapability & { readonly completion: "response-finished" } {
  assertAfterPort(options.after);
  const after = options.after;

  return Object.freeze({
    completion: "response-finished" as const,
    limits: options.limits ?? SERVERLESS_DEFER_POLICY,
    supportsInline: options.supportsInline ?? true,
    durableFinalization: options.durableFinalization ?? false,
    schedule(task: DeferScheduledTask): void {
      after(() => {
        return task.run();
      });
    },
  });
}

function assertAfterPort(after: unknown): asserts after is DeferAfterPort {
  if (typeof after !== "function") {
    throw createDeferError({
      code: "DEFER_CAPABILITY_MISSING",
      message:
        "Inline defer() requires an explicit after(task) capability such as Next.js after() from next/server. Upgrade the host or use await defer(target, input) with a configured Runtime.",
    });
  }
}
