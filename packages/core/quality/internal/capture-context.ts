/**
 * Run-scoped Quality capture and per-cell quarantine context.
 *
 * Quality captures observability records through AsyncLocalStorage instead of
 * swapping the process transport. Timed-out cells keep their async context, so
 * late writes can be identified and dropped without affecting sibling runs.
 *
 * @internal
 * @module
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { CruxGraphRecord } from '../../observability/contract'
import { registerQualityObservabilityCaptureHooks } from '../../observability/quality-capture-hooks'

/** Per-run capture sink consumed by the observability emitter. @internal */
export interface QualityCaptureSession {
  send(records: readonly CruxGraphRecord[]): void
}

/** Mutable token shared by all async work spawned for one Quality cell. @internal */
export interface QualityCellExecutionToken {
  active: boolean
  quarantined: number
}

const activeCapture = new AsyncLocalStorage<QualityCaptureSession>()
const activeCellToken = new AsyncLocalStorage<QualityCellExecutionToken>()

/** Run `fn` with a Quality capture sink active. @internal */
export function withQualityCaptureSession<T>(session: QualityCaptureSession, fn: () => Promise<T>): Promise<T> {
  return activeCapture.run(session, fn)
}

/** Return the active Quality capture sink, if any. @internal */
export function currentQualityCaptureSession(): QualityCaptureSession | undefined {
  return activeCapture.getStore()
}

/** Create a live per-cell quarantine token. @internal */
export function createQualityCellToken(): QualityCellExecutionToken {
  return { active: true, quarantined: 0 }
}

/** Run `fn` with a Quality cell token active. @internal */
export function withQualityCellToken<T>(token: QualityCellExecutionToken, fn: () => Promise<T>): Promise<T> {
  return activeCellToken.run(token, fn)
}

/**
 * Return true when the current async context belongs to a timed-out cell.
 *
 * Callers use this as a drop guard for late cassette, score, and trace writes.
 *
 * @internal
 */
export function shouldQuarantineQualityWrite(): boolean {
  const token = activeCellToken.getStore()
  if (token === undefined || token.active) return false
  token.quarantined += 1
  return true
}

registerQualityObservabilityCaptureHooks({
  currentCaptureSession: currentQualityCaptureSession,
  shouldQuarantineWrite: shouldQuarantineQualityWrite,
})
