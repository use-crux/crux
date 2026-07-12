/**
 * Named-only lifetime for hosts without a reliable inline post-return drain.
 *
 * AWS Lambda (without an extension) and Convex use this shape: inline
 * `defer(callback)` throws, while named Runtime work remains available when
 * `durableFinalization` is true.
 *
 * @module
 */

import { createHandlerReturnedDeferLifetime } from "../lifecycle";
import type { DeferLifetimeCapability } from "../host-types";
import { SERVERLESS_DEFER_POLICY } from "./policy";
import type { DeferLifetimeLimits } from "../host-types";

/** Well-known named-only hosts used for remediation copy. */
export type NamedOnlyDeferHostKind = "lambda" | "convex" | "generic";

/** Options for {@link createNamedOnlyDeferLifetime}. */
export interface NamedOnlyDeferLifetimeOptions {
  /**
   * Host label used only in diagnostics. Never changes control flow.
   *
   * @defaultValue `'generic'`
   */
  readonly host?: NamedOnlyDeferHostKind;
  /**
   * Whether named work may finalize before the handler result commits.
   *
   * @defaultValue `true`
   */
  readonly durableFinalization?: boolean;
  /** Override fixed V1 limits only when a host is strictly tighter. */
  readonly limits?: DeferLifetimeLimits;
}

/**
 * Create a lifetime that rejects inline callbacks and retains only named work.
 *
 * The empty drain is still scheduled on the microtask queue so seal/settled
 * barriers resolve without requiring a platform waitUntil hook.
 *
 * @example
 * ```ts
 * import { createNamedOnlyDeferLifetime } from '@use-crux/core/defer/serverless'
 *
 * const lifetime = createNamedOnlyDeferLifetime({ host: 'lambda' })
 * ```
 */
export function createNamedOnlyDeferLifetime(
  options: NamedOnlyDeferLifetimeOptions = {},
): DeferLifetimeCapability & {
  readonly completion: "handler-returned";
  readonly supportsInline: false;
} {
  return createHandlerReturnedDeferLifetime({
    limits: options.limits ?? SERVERLESS_DEFER_POLICY,
    supportsInline: false,
    durableFinalization: options.durableFinalization ?? true,
    handoff(promise) {
      // Empty drains complete immediately; never block the handler return path.
      void promise;
    },
  }) as DeferLifetimeCapability & {
    readonly completion: "handler-returned";
    readonly supportsInline: false;
  };
}
