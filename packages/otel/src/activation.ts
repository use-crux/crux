/**
 * Span activation hook wiring `@use-crux/otel` into `@use-crux/core`'s
 * generic `spanActivationHook`.
 *
 * This is what turns "a span object gets created downstream of `observe.*`"
 * into "the real callback runs with that span active" — `trace.getActiveSpan()`
 * resolves correctly inside instrumented work, and nested user/provider spans
 * parent under the Crux span instead of floating at the trace root.
 *
 * @module
 */

import type { SpanActivationHook } from '@use-crux/core'
import type { OtelSpanRegistry } from './record-mapper'
import type { SpanManager } from './span-manager'

/**
 * Create the `spanActivationHook` installed by `withTelemetry()`.
 *
 * The hook only reads the shared registry; the record-mapper subscriber owns
 * writes, so the span it resolves is always the one already started for the
 * current observability context (`span:start`/`run:start`/`run:resume` are
 * emitted synchronously before the caller's `withContext(fn)` runs).
 *
 * @param spanManager - Span lifecycle implementation shared with the subscriber.
 * @param registry - Shared open run/span registry populated by the subscriber.
 */
export function createSpanActivationHook(
  spanManager: SpanManager,
  registry: OtelSpanRegistry,
): SpanActivationHook {
  return (context, fn) => {
    const ref = registry.lookup({ runId: context.runId, currentSpanId: context.currentSpanId })
    if (!ref) return fn()
    return spanManager.runActive(ref, fn)
  }
}
