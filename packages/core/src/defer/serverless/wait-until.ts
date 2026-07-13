/**
 * Handler-returned lifetime from an injected waitUntil port.
 *
 * @module
 */

import {
  createHandlerReturnedDeferLifetime,
  type HandlerReturnedLifetimeOptions,
} from "../lifecycle";
import type { DeferLifetimeCapability } from "../host-types";
import { createDeferError } from "../errors";
import { SERVERLESS_DEFER_POLICY } from "./policy";
import type { DeferWaitUntilPort } from "./ports";

/** Options for {@link createWaitUntilDeferLifetime}. */
export interface WaitUntilDeferLifetimeOptions {
  /**
   * Platform retention hook. Must be supplied explicitly — Crux never guesses
   * Vercel or Cloudflare from environment variables.
   */
  readonly waitUntil: DeferWaitUntilPort;
  /** Whether named `defer(target, input)` may finalize before the response. */
  readonly durableFinalization?: boolean;
  /** Whether inline `defer(callback)` may register. Defaults to `true`. */
  readonly supportsInline?: boolean;
  /** Override fixed V1 limits only when a host is strictly tighter. */
  readonly limits?: HandlerReturnedLifetimeOptions["limits"];
}

/**
 * Create a handler-returned lifetime bound to an injected `waitUntil` port.
 *
 * Streaming bodies may still be writing when callbacks start. Callers that need
 * post-flush semantics must use a response-finished integration instead.
 *
 * @example
 * ```ts
 * import { waitUntil } from '@vercel/functions'
 * import { createWaitUntilDeferLifetime } from '@use-crux/core/defer/serverless'
 *
 * const lifetime = createWaitUntilDeferLifetime({ waitUntil })
 * ```
 */
export function createWaitUntilDeferLifetime(
  options: WaitUntilDeferLifetimeOptions,
): DeferLifetimeCapability & { readonly completion: "handler-returned" } {
  assertWaitUntilPort(options.waitUntil);
  return createHandlerReturnedDeferLifetime({
    limits: options.limits ?? SERVERLESS_DEFER_POLICY,
    supportsInline: options.supportsInline ?? true,
    durableFinalization: options.durableFinalization ?? false,
    handoff: options.waitUntil,
  });
}

function assertWaitUntilPort(waitUntil: unknown): asserts waitUntil is DeferWaitUntilPort {
  if (typeof waitUntil !== "function") {
    throw createDeferError({
      code: "DEFER_CAPABILITY_MISSING",
      message:
        "Inline defer() requires an explicit waitUntil(promise) capability. Pass the platform hook (for example Vercel waitUntil or ctx.waitUntil) — Crux does not infer it from the environment.",
    });
  }
}
