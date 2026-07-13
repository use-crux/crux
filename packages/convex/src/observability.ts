/**
 * Convex/serverless helpers for canonical Crux observability delivery.
 *
 * Crux emits graph records without blocking user code by default. Convex
 * actions freeze the worker as soon as the handler returns, so actions must
 * await a bounded flush before returning. Convex exposes no host-deadline API,
 * so the bound is a short fixed budget rather than a host-derived one; it must
 * stay well under Convex's own action timeout so a stuck collector cannot
 * silently extend action latency.
 */

import { observabilityDiagnostics, observe, type ObservabilityFlushResult } from '@use-crux/core/observability'

export interface ConvexObservabilityFlushOptions {
  /**
   * Maximum time to wait for queued graph deliveries.
   * @default 3000
   */
  timeoutMs?: number
  /**
   * Whether this flush is the boundary's own final drain rather than an
   * opportunistic mid-operation flush (e.g. before/after a nested action hop,
   * a stream start, or a `prepareStep` call).
   *
   * An opportunistic flush is expected to be incomplete — it exists so
   * devtools sees interim progress sooner, not to guarantee delivery — so a
   * later terminal flush is what actually owns reporting loss. Only a
   * terminal drain's incompleteness is ever reported by the default reporter;
   * an explicit `onDrain` still receives every drain's result regardless.
   * @default true
   */
  terminal?: boolean
  /**
   * Receives the structured drain result.
   *
   * Omit to fall back to a console warning whenever a *terminal* drain does
   * not fully complete (`status !== 'drained'`); the result is never silently
   * discarded either way.
   */
  onDrain?: (result: ObservabilityFlushResult) => void
}

export type ConvexActionHandler<Ctx, Args, Result> = (ctx: Ctx, args: Args) => Result | Promise<Result>

/**
 * Short bounded default flush budget for a Convex action boundary.
 *
 * Convex exposes no per-invocation deadline API, so this is a fixed
 * conservative bound rather than one derived from remaining host time. It
 * replaces the prior 20-second default, which could silently stack across
 * nested action boundaries and mask a slow or stuck collector.
 */
export const DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS = 3000

export async function flushObservability(
  options: ConvexObservabilityFlushOptions = {},
): Promise<ObservabilityFlushResult> {
  let result: ObservabilityFlushResult
  try {
    result = await observe.flush({ timeoutMs: options.timeoutMs ?? DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS })
  } catch (error) {
    result = failedDrainResult(error)
  }
  const report = options.onDrain ?? (options.terminal === false ? undefined : warnAboutIncompleteDrain)
  // A caller-supplied reporter is untrusted: isolate its failures so they
  // never mask the drain result the caller is about to receive.
  try {
    report?.(result)
  } catch (error) {
    console.error('[crux] Convex observability onDrain reporter threw; the drain result above was still computed.', error)
  }
  return result
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

function failedDrainResult(error: unknown): ObservabilityFlushResult {
  const diagnostics = observabilityDiagnostics()
  console.error('[crux] Convex observability flush threw while draining an action boundary; treating as a failed drain.', error)
  return {
    status: 'failed',
    delivered: 0,
    rejected: 0,
    remaining: diagnostics.queuedRecords + diagnostics.pendingDeliveries,
    deadlineExceeded: false,
  }
}

function warnAboutIncompleteDrain(result: ObservabilityFlushResult): void {
  if (result.status === 'drained') return
  console.warn(
    '[crux] Convex observability drain did not fully complete before the action boundary returned; telemetry may be delayed or lost.',
    result,
  )
}
