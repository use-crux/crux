import type { ConstraintAudit } from './types'
import type { SafetyCaptureSummary, SafetyDecision } from '../decision'
import {
  POLICY_TERMINAL,
  rejectedCandidateEvidence,
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
  /**
   * The constraints that failed — identity only.
   *
   * @remarks
   * No `feedback`: policy-authored feedback commonly interpolates the very output that
   * was rejected, and this error describes a candidate the caller was never allowed to
   * see. `feedbackLength` keeps the failure explainable. A retry callback is the opt-in
   * channel for raw feedback.
   */
  readonly failedConstraints: readonly {
    name: string
    category?: string
    severity?: string
    feedbackLength: number
  }[]
  /** Audit history with the same content-free rule applied to every entry. */
  readonly audit: ConstraintAudit
  readonly lastOutput: SafetyCaptureSummary
  readonly totalAttempts: number
  readonly decisions: readonly SafetyDecision[]

  constructor(opts: {
    failedConstraints: readonly {
      name: string
      category?: string
      severity?: string
      feedback?: string
    }[]
    audit: ConstraintAudit
    lastOutput: string | SafetyCaptureSummary
    totalAttempts: number
    decisions?: readonly SafetyDecision[]
  }) {
    const names = opts.failedConstraints.map((c) => c.name).join(', ')
    super(`Constraints violated after ${opts.totalAttempts} attempts: ${names}`)
    this.name = 'ConstraintViolationError'
    this.failedConstraints = opts.failedConstraints.map((failure) => ({
      name: failure.name,
      ...(failure.category !== undefined ? { category: failure.category } : {}),
      ...(failure.severity !== undefined ? { severity: failure.severity } : {}),
      feedbackLength: failure.feedback?.length ?? 0,
    }))
    this.audit = contentFreeAudit(opts.audit)
    // Evidence only: a public terminal error never carries rejected content.
    this.lastOutput = rejectedCandidateEvidence(opts.lastOutput)
    this.totalAttempts = opts.totalAttempts
    this.decisions = opts.decisions ?? []
  }
}

/**
 * Strip policy-authored prose from an audit before it reaches a public terminal error.
 *
 * The same rule as telemetry: feedback and metadata can echo the rejected candidate, so
 * only their shape survives.
 */
function contentFreeAudit(audit: ConstraintAudit): ConstraintAudit {
  return {
    ...audit,
    entries: audit.entries.map((entry) => {
      const { feedback, metadata, ...rest } = entry
      return {
        ...rest,
        feedbackLength: feedback?.length ?? 0,
        metadataCount:
          metadata && typeof metadata === 'object' ? Object.keys(metadata).length : 0,
      } as unknown as (typeof audit.entries)[number]
    }),
  }
}
