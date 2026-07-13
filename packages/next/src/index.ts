/**
 * Next.js host integration for request-scoped Crux `defer()`.
 *
 * Binds Next's `after()` (response-finished) without pulling Next into
 * `@use-crux/core`. Application modules still import `defer` from
 * `@use-crux/core`.
 *
 * @module
 *
 * @example
 * ```ts
 * import { defer } from '@use-crux/core'
 * import { withNextDefer } from '@use-crux/next'
 *
 * export const POST = withNextDefer(async (request: Request) => {
 *   defer(() => flushAnalytics())
 *   return Response.json({ ok: true })
 * })
 * ```
 */

import {
  createAfterDeferLifetime,
  withAfterDefer,
  type AfterDeferWrapOptions,
  type DeferAfterPort,
} from "@use-crux/core/defer/serverless";
import type { DeferLifetimeCapability } from "@use-crux/core/internal/defer-host";
import { resolveNextAfterPort } from "./after";

export type { DeferAfterPort };

/** Options for {@link withNextDefer}. */
export type NextDeferWrapOptions<T> = Omit<AfterDeferWrapOptions<T>, "after"> & {
  /**
   * Override the Next `after` port.
   *
   * Production code should omit this and use `next/server`. Tests inject a
   * deterministic fake.
   */
  readonly after?: DeferAfterPort;
};

/**
 * Create a response-finished Next lifetime capability.
 *
 * @param options - Optional after override and durability flags.
 */
export function createNextDeferLifetime(
  options: {
    readonly after?: DeferAfterPort;
    readonly durableFinalization?: boolean;
    readonly supportsInline?: boolean;
  } = {},
): DeferLifetimeCapability {
  return createAfterDeferLifetime({
    after: resolveNextAfterPort(options.after),
    ...(options.durableFinalization !== undefined
      ? { durableFinalization: options.durableFinalization }
      : {}),
    ...(options.supportsInline !== undefined
      ? { supportsInline: options.supportsInline }
      : {}),
  });
}

/**
 * Wrap a Next route/handler so `defer(callback)` drains after the response.
 *
 * Declares completion class `response-finished`. Named `defer(target, input)`
 * still requires a configured Runtime and `durableFinalization: true`.
 */
export function withNextDefer<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | PromiseLike<TResult>,
  options: NextDeferWrapOptions<Awaited<TResult>> = {},
): (...args: TArgs) => Promise<Awaited<TResult>> {
  const { after, ...rest } = options;
  return withAfterDefer(handler, {
    ...rest,
    after: resolveNextAfterPort(after),
  });
}
