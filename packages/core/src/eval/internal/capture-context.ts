/**
 *
 * Run-scoped Eval capture and per-cell quarantine context.
 *
 * Eval captures observability records through Core's canonical async-scope
 * carrier instead of swapping the process transport. Timed-out cells retain
 * their scope, so late writes can be dropped without affecting sibling runs.
 *
 * @internal
 * @module
 */

import { createAsyncScopeFacet } from '../../async-scope'
import type { CruxGraphRecord } from '../../observability/contract'
import { registerEvalObservabilityCaptureHooks } from '../../observability/eval-capture-hooks'

/** Per-run capture sink consumed by the observability emitter. @internal */
export interface EvalCaptureSession {
  send(records: readonly CruxGraphRecord[]): void
}

/** Mutable token shared by all async work spawned for one Eval cell. @internal */
export interface EvalCellExecutionToken {
  active: boolean
  quarantined: number
}

const activeCapture = createAsyncScopeFacet<EvalCaptureSession>('core.eval-capture')
const activeCellToken = createAsyncScopeFacet<EvalCellExecutionToken>('core.eval-cell')

/** Run `fn` with an Eval capture sink active. @internal */
export function withEvalCaptureSession<T>(session: EvalCaptureSession, fn: () => Promise<T>): Promise<T> {
  return activeCapture.run(session, fn)
}

/** Return the active Eval capture sink, if any. @internal */
export function currentEvalCaptureSession(): EvalCaptureSession | undefined {
  return activeCapture.current()
}

/** Create a live per-cell quarantine token. @internal */
export function createEvalCellToken(): EvalCellExecutionToken {
  return { active: true, quarantined: 0 }
}

/** Run `fn` with an Eval cell token active. @internal */
export function withEvalCellToken<T>(token: EvalCellExecutionToken, fn: () => Promise<T>): Promise<T> {
  return activeCellToken.run(token, fn)
}

/**
 * Return true when the current async context belongs to a timed-out cell.
 *
 * Callers use this as a drop guard for late score and trace writes.
 *
 * @internal
 */
export function shouldQuarantineEvalWrite(): boolean {
  const token = activeCellToken.current()
  if (token === undefined || token.active) return false
  token.quarantined += 1
  return true
}

registerEvalObservabilityCaptureHooks({
  currentCaptureSession: currentEvalCaptureSession,
  shouldQuarantineWrite: shouldQuarantineEvalWrite,
})
