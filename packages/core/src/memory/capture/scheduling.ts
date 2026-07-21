import { scheduleDiagnosticsOnlyDeferredCallback } from '../../defer/internal/port'
import type { MemoryCaptureMode } from '../block-contracts'

const DEFERRED_CAPTURE_FALLBACK_WARNING =
  '[crux] Deferred memory capture ran inline because the active environment cannot retain background work. Memory was captured safely, but the operation waited for it to finish. Configure a host binding to enable background capture: https://cruxjs.dev/docs/guides/background-work/hosts'

let fallbackWarningEmitted = false

/** Internal scheduling result retained by the memory capture runtime. */
export interface MemoryCaptureSchedulingResult {
  readonly status: 'inline' | 'deferred' | 'captured'
  readonly settled: Promise<void>
}

/**
 * Schedule one correctness-critical memory capture operation.
 *
 * Inline work is normalized into a promise and must be awaited by the caller.
 * Deferred work uses the active retained execution scope when available;
 * otherwise the diagnostics-only port safely starts the same work inline.
 */
export function scheduleMemoryCapture(
  mode: MemoryCaptureMode,
  work: () => Promise<void>,
): MemoryCaptureSchedulingResult {
  if (mode === 'inline') {
    const settled = Promise.resolve().then(work)
    observeRejection(settled)
    return Object.freeze({ status: 'inline', settled })
  }

  const scheduled = scheduleDiagnosticsOnlyDeferredCallback(work)
  if (scheduled.status === 'inline') warnForInlineFallback()
  return scheduled
}

function observeRejection(settled: Promise<void>): void {
  void settled.catch(() => undefined)
}

function warnForInlineFallback(): void {
  if (fallbackWarningEmitted || suppressFallbackWarning()) return
  fallbackWarningEmitted = true
  console.warn(DEFERRED_CAPTURE_FALLBACK_WARNING)
}

function suppressFallbackWarning(): boolean {
  if (typeof process === 'undefined') return false
  return process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test'
}
