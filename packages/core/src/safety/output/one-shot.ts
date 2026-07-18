import { observeConstraintCheck, runConstraints } from '../constraint/runner'
import { ConstraintViolationError } from '../constraint/errors'
import type { Constraint, ConstraintAudit, ConstraintAuditEntry, ConstraintContext } from '../constraint/types'

interface RunOneShotConstraintsOptions {
  readonly constraints: readonly Constraint[]
  readonly reportConstraints: readonly Constraint[]
  readonly text: string
  readonly context: ConstraintContext
}

/**
 * Evaluate terminal constraints once without a regeneration capability.
 *
 * Assert failures throw with `totalAttempts: 1`; suggest failures return in
 * the ordinary audit. The retry cap is fixed at zero regardless of each
 * constraint's authored retry preference.
 */
export async function runOneShotConstraints(
  options: RunOneShotConstraintsOptions,
): Promise<ConstraintAudit | undefined> {
  if (options.constraints.length === 0 && options.reportConstraints.length === 0) return undefined

  let audit: ConstraintAudit | undefined
  try {
    if (options.constraints.length > 0) {
      const result = await runConstraints(
        options.constraints,
        { text: options.text, parsed: undefined },
        options.context,
        unreachableRegeneration,
        { constraintMaxRetries: 0 },
      )
      audit = result.audit
    }
  } catch (error) {
    if (!(error instanceof ConstraintViolationError)) throw error
    throw new ConstraintViolationError({
      failedConstraints: error.failedConstraints,
      audit: error.audit,
      lastOutput: {
        level: 'evidence',
        sizeBytes: error.lastOutput.sizeBytes,
        hash: error.lastOutput.hash,
      },
      totalAttempts: error.totalAttempts,
      decisions: error.decisions,
    })
  }

  if (options.reportConstraints.length === 0) return audit
  const entries = await reportEntries(options.reportConstraints, options.text, options.context)
  const hasSuggestFailures = entries.some((entry) => !entry.pass && entry.severity === 'suggest')
  const hasAssertFailures = entries.some((entry) => !entry.pass && entry.severity === 'assert')
  return {
    entries: [...(audit?.entries ?? []), ...entries],
    allPassed: (audit?.allPassed ?? true) && entries.every((entry) => entry.pass),
    suggestFallback: audit?.suggestFallback === true || (hasSuggestFailures && !hasAssertFailures),
  }
}

async function reportEntries(
  constraints: readonly Constraint[],
  text: string,
  context: ConstraintContext,
): Promise<readonly ConstraintAuditEntry[]> {
  const checks = await Promise.all(
    constraints.map((item) => observeConstraintCheck(item, { text, parsed: undefined }, context)),
  )
  return checks.map((check) => ({
    constraint: check.constraint.id,
    ...(check.constraint.category === undefined ? {} : { category: check.constraint.category }),
    severity: check.constraint.severity,
    pass: check.result.pass,
    feedback: check.result.pass ? undefined : check.result.feedback,
    attempts: 1,
    durationMs: check.durationMs,
    metadata: check.result.metadata,
  }))
}

function unreachableRegeneration(): never {
  throw new Error('One-shot constraints cannot regenerate output')
}
