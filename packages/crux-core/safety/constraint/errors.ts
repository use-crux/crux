import type { ConstraintAudit } from './types'

/**
 * Thrown when one or more `assert`-severity constraints are violated
 * after all retry attempts are exhausted.
 *
 * Carries all failing constraints (parallel execution means multiple
 * asserts can fail simultaneously).
 */
export class ConstraintViolationError extends Error {
  readonly failedConstraints: readonly { name: string; feedback: string }[]
  readonly audit: ConstraintAudit
  readonly lastOutput: string
  readonly totalAttempts: number

  constructor(opts: {
    failedConstraints: readonly { name: string; feedback: string }[]
    audit: ConstraintAudit
    lastOutput: string
    totalAttempts: number
  }) {
    const names = opts.failedConstraints.map((c) => c.name).join(', ')
    super(`Constraints violated after ${opts.totalAttempts} attempts: ${names}`)
    this.name = 'ConstraintViolationError'
    this.failedConstraints = opts.failedConstraints
    this.audit = opts.audit
    this.lastOutput = opts.lastOutput
    this.totalAttempts = opts.totalAttempts
  }
}
