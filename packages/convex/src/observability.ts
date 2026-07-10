/**
 * Convex/serverless helpers for canonical Crux observability delivery.
 *
 * Crux emits graph records without blocking user code by default. Convex
 * actions and other serverless runtimes may freeze the worker as soon as the
 * handler returns, so actions should await a bounded flush in a finally block.
 */

import { observe, type ObservabilityFlushResult } from '@use-crux/core/observability'

export interface ConvexObservabilityFlushOptions {
  /**
   * Maximum time to wait for queued graph deliveries.
   * @default 20000
   */
  timeoutMs?: number
}

export type ConvexActionHandler<Ctx, Args, Result> = (ctx: Ctx, args: Args) => Result | Promise<Result>

export const DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS = 20_000

export async function flushObservability(
  options: ConvexObservabilityFlushOptions = {},
): Promise<ObservabilityFlushResult> {
  return observe.flush({ timeoutMs: options.timeoutMs ?? DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS })
}

export function withObservabilityFlush<Ctx, Args, Result>(
  handler: ConvexActionHandler<Ctx, Args, Result>,
  options: ConvexObservabilityFlushOptions = {},
): (ctx: Ctx, args: Args) => Promise<Result> {
  return async (ctx, args) => {
    try {
      return await handler(ctx, args)
    } finally {
      await flushObservability(options)
    }
  }
}
