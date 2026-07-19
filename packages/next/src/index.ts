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
  withAfterDefer,
  type AfterDeferWrapOptions,
  type DeferAfterPort,
} from "@use-crux/core/defer/serverless";
import { onDeferDrainSettled } from "@use-crux/core/internal/scope";
import type { CruxHostBinding } from "@use-crux/core";
import type { ObservabilityFlushResult } from "@use-crux/core/observability";
import { resolveNextAfterPort } from "./after";
import { reportNextObservabilityDrain } from "./observability-drain";

export type { DeferAfterPort };

/** Bind ambient invocation retention to Next.js `after()`. */
export function next(): CruxHostBinding {
  return Object.freeze({
    kind: "next",
    invocationScope: true,
    supportsInline: true,
    durableFinalization: false,
    retain: (work) => resolveNextAfterPort()(work),
  } satisfies CruxHostBinding);
}

/** Options for the opinionated Next lifecycle boundary created by {@link withCrux}. */
export interface NextCruxOptions<T> extends NextDeferWrapOptions<T> {
  /** Maximum time allowed for the post-response observability drain. */
  readonly flushTimeoutMs?: number;
  /** Receive the structured post-response drain result. */
  readonly onDrain?: (result: ObservabilityFlushResult) => void;
}

/** Options for {@link withNextDefer}. */
export type NextDeferWrapOptions<T> = Omit<
  AfterDeferWrapOptions<T>,
  "after"
> & {
  /**
   * Override the Next `after` port.
   *
   * Production code should omit this and use `next/server`. Tests inject a
   * deterministic fake.
   */
  readonly after?: DeferAfterPort;
};

/**
 * Wrap a Next route/handler so `defer(callback)` drains after the response.
 *
 * Named `defer(target, input)` still requires a configured Runtime and
 * `durableFinalization: true`.
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

/**
 * Wrap a Next handler with response-finished deferred work and observability.
 *
 * The same resolved `after()` port owns both tasks. The response or thrown
 * framework control-flow value settles before the bounded telemetry drain,
 * and drain/reporter failures cannot replace the handler outcome.
 *
 * @param handler - Next route or server handler to invoke.
 * @param options - Defer classification and observability drain controls.
 * @returns A handler preserving the original argument tuple and awaited result.
 *
 * @example
 * ```ts
 * import { defer } from '@use-crux/core'
 * import { withCrux } from '@use-crux/next'
 *
 * export const POST = withCrux(async () => {
 *   defer(() => flushAnalytics())
 *   return Response.json({ ok: true })
 * })
 * ```
 */
export function withCrux<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | PromiseLike<TResult>,
  options: NextCruxOptions<Awaited<TResult>> = {},
): (...args: TArgs) => Promise<Awaited<TResult>> {
  const {
    after: afterOverride,
    flushTimeoutMs,
    onDrain,
    ...deferOptions
  } = options;
  return withNextDefer(
    (...args) => {
      onDeferDrainSettled(() =>
        reportNextObservabilityDrain({
          ...(flushTimeoutMs === undefined ? {} : { flushTimeoutMs }),
          ...(onDrain ? { onDrain } : {}),
        }),
      );
      return handler(...args);
    },
    { ...deferOptions, after: resolveNextAfterPort(afterOverride) },
  );
}
