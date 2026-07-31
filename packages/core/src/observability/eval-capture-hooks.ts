/**
 * Optional Eval capture hooks for the observability emitter.
 *
 * This module intentionally has no dependency on Eval execution or Node-only
 * APIs. The Eval runtime registers scoped hooks when it is loaded, while
 * platform-neutral bundles can import observability without pulling in
 * `node:async_hooks`.
 *
 * @internal
 * @module
 */

import type { CruxGraphRecord } from './contract'

/** Capture sink supplied while an Eval run is active. */
export interface EvalObservabilityCaptureSession {
  send(records: readonly CruxGraphRecord[]): void
}

/** Hooks Eval can provide without making observability depend on Eval. */
export interface EvalObservabilityCaptureHooks {
  currentCaptureSession(): EvalObservabilityCaptureSession | undefined
  shouldQuarantineWrite(): boolean
}

let hooks: EvalObservabilityCaptureHooks | undefined

/**
 * Register Eval's optional capture hooks. Last registration wins.
 *
 * @returns An idempotent restore callback for scoped tests and runtimes.
 */
export function registerEvalObservabilityCaptureHooks(
  next: EvalObservabilityCaptureHooks,
): () => void {
  const previous = hooks
  hooks = next
  let restored = false
  return () => {
    if (restored || hooks !== next) return
    restored = true
    hooks = previous
  }
}

/** Return the active Eval capture sink, if one is in scope. */
export function currentEvalObservabilityCaptureSession(): EvalObservabilityCaptureSession | undefined {
  return hooks?.currentCaptureSession()
}

/** Return true when Eval asks observability to drop a late timed-out write. */
export function shouldQuarantineEvalObservabilityWrite(): boolean {
  return hooks?.shouldQuarantineWrite() ?? false
}
