/**
 * Optional Quality capture hooks for the observability emitter.
 *
 * This module intentionally has no dependency on `quality/*` or Node-only
 * APIs. Quality registers ALS-backed hooks from its own runtime module when it
 * is loaded; platform-neutral bundles can import observability without pulling
 * in `node:async_hooks`.
 *
 * @internal
 * @module
 */

import type { CruxGraphRecord } from './contract'

/** Capture sink supplied by the Quality runner while an evaluation is active. */
export interface QualityObservabilityCaptureSession {
  send(records: readonly CruxGraphRecord[]): void
}

/** Hooks Quality can provide without making observability depend on Quality. */
export interface QualityObservabilityCaptureHooks {
  currentCaptureSession(): QualityObservabilityCaptureSession | undefined
  shouldQuarantineWrite(): boolean
}

let hooks: QualityObservabilityCaptureHooks | undefined

/** Register Quality's optional capture hooks. Last registration wins. */
export function registerQualityObservabilityCaptureHooks(next: QualityObservabilityCaptureHooks): void {
  hooks = next
}

/** Return the active Quality capture sink, if one is in scope. */
export function currentQualityObservabilityCaptureSession(): QualityObservabilityCaptureSession | undefined {
  return hooks?.currentCaptureSession()
}

/** Return true when Quality asks observability to drop a late timed-out write. */
export function shouldQuarantineQualityObservabilityWrite(): boolean {
  return hooks?.shouldQuarantineWrite() ?? false
}
