import type { ConstraintAudit } from './types'
import type { SafetyCaptureSummary, SafetyDecision } from '../decision'
import {
  POLICY_TERMINAL,
  toSafetyCaptureSummary,
  type PolicyTerminalError,
} from '../errors'

/**
 * Thrown when one or more `assert`-severity constraints are violated
 * after all retry attempts are exhausted.
 *
 * Carries all failing constraints (parallel execution means multiple
 * asserts can fail simultaneously).
 */
export class ConstraintViolationError extends Error implements PolicyTerminalError {
  readonly [POLICY_TERMINAL] = true
  readonly failedConstraints: readonly { name: string; feedback: string }[]
  readonly audit: ConstraintAudit
  readonly lastOutput: SafetyCaptureSummary
  readonly totalAttempts: number
  readonly decisions: readonly SafetyDecision[]

  constructor(opts: {
    failedConstraints: readonly { name: string; feedback: string }[]
    audit: ConstraintAudit
    lastOutput: string | SafetyCaptureSummary
    totalAttempts: number
    decisions?: readonly SafetyDecision[]
  }) {
    const names = opts.failedConstraints.map((c) => c.name).join(', ')
    super(`Constraints violated after ${opts.totalAttempts} attempts: ${names}`)
    this.name = 'ConstraintViolationError'
    this.failedConstraints = opts.failedConstraints
    this.audit = opts.audit
    this.lastOutput = toSafetyCaptureSummary(opts.lastOutput)
    this.totalAttempts = opts.totalAttempts
    this.decisions = opts.decisions ?? []
  }
}
