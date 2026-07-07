import { ConstraintViolationError } from '../constraint/errors'
import { observeConstraintCheck } from '../constraint/runner'
import type {
  Constraint,
  ConstraintAudit,
  ConstraintAuditEntry,
  ConstraintContext,
} from '../constraint/types'

/** Run stream chunk constraints before releasing newly cleared content. */
export async function runStreamChunkConstraints(options: {
  readonly constraints: readonly Constraint[]
  readonly content: string
  readonly releasedText: string
  readonly context: ConstraintContext
  readonly audit: ConstraintAudit | undefined
}): Promise<void> {
  for (const constraint of options.constraints) {
    const verdict = await constraint.onChunk!(options.content, options.releasedText + options.content, options.context)
    if (!verdict.abort) continue

    throw new ConstraintViolationError({
      failedConstraints: [{ name: constraint.id, feedback: verdict.feedback }],
      audit: {
        entries: options.audit?.entries ?? [],
        allPassed: false,
        suggestFallback: false,
      },
      lastOutput: options.releasedText + options.content,
      totalAttempts: 1,
    })
  }
}

/** Run final stream constraints using the same observed check path as generation. */
export async function runFinalStreamConstraints(options: {
  readonly constraints: readonly Constraint[]
  readonly text: string
  readonly context: ConstraintContext
  readonly audit: ConstraintAudit | undefined
}): Promise<ConstraintAudit | undefined> {
  if (options.constraints.length === 0) return undefined

  const checks = await Promise.all(
    options.constraints.map(async (constraint) =>
      observeConstraintCheck(constraint, { text: options.text, parsed: undefined }, options.context),
    ),
  )
  const entries: ConstraintAuditEntry[] = checks.map((check) => ({
    constraint: check.constraint.id,
    ...(check.constraint.category !== undefined ? { category: check.constraint.category } : {}),
    severity: check.constraint.severity,
    pass: check.result.pass,
    feedback: check.result.pass ? undefined : check.result.feedback,
    attempts: 1,
    durationMs: check.durationMs,
    metadata: check.result.metadata,
  }))
  const allPassed = entries.every((entry) => entry.pass)
  const hasAssertFailures = entries.some((entry) => !entry.pass && entry.severity === 'assert')

  return {
    entries: [...(options.audit?.entries ?? []), ...entries],
    allPassed,
    suggestFallback: !allPassed && !hasAssertFailures,
  }
}
