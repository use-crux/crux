import { selectedPath } from '../boundary'
import type {
  Constraint,
  ConstraintContext,
  ConstraintAudit,
  ConstraintAuditEntry,
  ConstraintFailure,
  ConstraintOutput,
} from './types'
import { validateConstraintRunResult } from './types'
import { constraintOccurrenceEntries } from './occurrences'
import { subjectFingerprint } from './fingerprint'
import type { ConstraintOccurrenceSettlement } from './settlement'
import { ConstraintViolationError } from './errors'
import { observe } from '../../observability'
import { constraintDefinitionRef } from '../../observability/definition-ref'
import type { SafetyRunContext } from '../decision'
import type { ConstraintBoundary } from './boundary'

// ── Runner Options ────────────────────────────────────────────────

export interface ConstraintRunnerOptions {
  /** Shared cap on total constraint retries across all constraints. */
  readonly constraintMaxRetries?: number
  /**
   * Occurrence-precise settlement evidence from an accepted stream attempt. A
   * settled occurrence whose subject value is unchanged is not re-evaluated, so a
   * `constraint.judge()` the stream already ran is not run again at completion.
   */
  readonly settled?: readonly ConstraintOccurrenceSettlement[]
  /** Called when a single constraint check completes. */
  readonly onCheck?: (constraint: Constraint, entry: ConstraintAuditEntry) => void
  /** Called when constraints trigger a combined retry. */
  readonly onRetry?: (constraints: readonly Constraint[], attempt: number, feedbacks: readonly string[]) => void
  /** Called when an assert constraint is violated (retries exhausted). */
  readonly onViolation?: (constraints: readonly Constraint[], totalAttempts: number) => void
}

// ── Runner Result ─────────────────────────────────────────────────

export interface ConstraintRunResult {
  readonly output: ConstraintOutput
  readonly audit: ConstraintAudit
}

// ── Observed single check (shared by the retry loop and report-only stream finish) ──

/** Result of one observed `check()` invocation. */
export interface ObservedConstraintCheck {
  readonly constraint: Constraint
  readonly result: ReturnType<typeof validateConstraintRunResult>
  readonly durationMs: number
}

/**
 * Run one constraint `check()` inside its observability span, emitting the
 * `constraint.report` artifact, `produced` edge, and `constraint.checked`
 * event exactly as the retry loop does. Thrown check errors propagate after
 * `span.error()` (fail-closed).
 */
export async function observeConstraintCheck(
  c: Constraint,
  output: ConstraintOutput,
  ctx: ConstraintContext,
  settled?: readonly ConstraintOccurrenceSettlement[],
): Promise<ObservedConstraintCheck> {
  const span = observe.openSpan(
    {
      name: c.id,
      primitive: 'constraint.check',
      // `constraint()` requires `id`, so this ref is always canonical.
      definitionRefs: [constraintDefinitionRef(c.id)],
      attributes: {
        constraintName: c.id,
        category: c.category,
        severity: c.severity,
        maxRetries: c.maxRetries,
        attempt: ctx.attempt,
        promptId: ctx.promptId,
        model: ctx.model,
      },
    },
  )
  try {
    return await span.withContext(async () => {
      const start = performance.now()
      const result = await checkConstraintOccurrences(c, output, ctx, settled)
      const durationMs = performance.now() - start
      const activeSpanId = observe.captureContext()?.currentSpanId
      const artifactId = observe.artifact({
        kind: 'constraint.report',
        contentType: 'application/json',
        encoding: 'json',
        preview: {
          kind: 'constraint.report',
          constraint: c.id,
          assertion: c.id,
          category: c.category,
          severity: c.severity,
          pass: result.pass,
          // Feedback and metadata are policy-authored free text that commonly echoes the
          // selected model output, and this record is written while the attempt is still
          // uncommitted. Observability stays content-free: identity, verdict, timing, and
          // counts only. Corrective feedback still reaches the next model attempt.
          feedbackLength: result.pass ? undefined : (result.feedback?.length ?? 0),
          attempts: [
            {
              n: ctx.attempt + 1,
              status: result.pass ? 'pass' : 'fail',
            },
          ],
          metadataCount: metadataCount(result.metadata),
        },
        attributes: {
          constraintName: c.id,
          category: c.category,
          severity: c.severity,
          pass: result.pass,
          attempt: ctx.attempt,
        },
      })
      if (activeSpanId && artifactId) {
        observe.edge({
          edgeType: 'produced',
          from: { kind: 'span', id: activeSpanId },
          to: { kind: 'artifact', id: artifactId },
          attributes: { constraintName: c.id },
        })
      }
      observe.event({
        name: 'constraint.checked',
        attributes: {
          constraintName: c.id,
          pass: result.pass,
          durationMs,
          feedbackLength: result.pass ? undefined : (result.feedback?.length ?? 0),
        },
      })
      span.end({
        attributes: {
          pass: result.pass,
          durationMs,
          feedbackLength: result.pass ? undefined : (result.feedback?.length ?? 0),
          metadataCount: metadataCount(result.metadata),
        },
      })
      return { constraint: c, result, durationMs }
    })
  } catch (error) {
    span.error(error)
    throw error
  }
}

/**
 * Check a constraint over every selected occurrence (shared selection model): the
 * constraint passes only when all occurrences pass, and fails on the first that
 * fails — so a later array item cannot leak past a constraint an earlier item
 * already failed. A boundary selecting no occurrence is vacuously satisfied.
 */
async function checkConstraintOccurrences(
  constraint: Constraint,
  output: ConstraintOutput,
  ctx: ConstraintContext,
  settled?: readonly ConstraintOccurrenceSettlement[],
): Promise<ReturnType<typeof validateConstraintRunResult>> {
  const entries = constraintOccurrenceEntries(constraint.on, output)
  for (const entry of entries) {
    // Occurrence-precise settlement suppression: a stream-settled occurrence whose
    // subject value is unchanged is not re-evaluated (the same exact value already
    // passed). A changed subject, a new occurrence, or an unclosed set re-evaluates.
    if (isOccurrenceSettled(settled, constraint.id, entry.occurrence, entry.subject)) continue
    const result = validateConstraintRunResult(
      await constraint.run(entry.subject as never, runContext(constraint, ctx) as never),
      { policyId: constraint.id, boundary: constraint.on.id },
    )
    if (!result.pass) return result
  }
  return { pass: true }
}

/**
 * How many metadata entries a constraint returned, or undefined when there is none.
 *
 * @remarks
 * Only a COUNT. Key names are not safe either: a policy can build a key from the very
 * content it rejected (`{ [offendingValue]: true }`), so recording keys would leak the
 * candidate exactly as recording values would.
 */
function metadataCount(metadata: unknown): number | undefined {
  if (metadata === null || typeof metadata !== 'object') return undefined
  const entries = Array.isArray(metadata)
    ? metadata.length
    : Object.keys(metadata as Record<string, unknown>).length
  return entries > 0 ? entries : undefined
}

/** Whether an evaluated occurrence value already passed on the accepted attempt. */
export function isOccurrenceSettled(
  settled: readonly ConstraintOccurrenceSettlement[] | undefined,
  constraintId: string,
  occurrence: readonly (string | number)[],
  subject: unknown,
): boolean {
  if (!settled || settled.length === 0) return false
  const fingerprint = subjectFingerprint(subject)
  return settled.some(
    (entry) =>
      entry.pass &&
      entry.closed &&
      entry.constraint === constraintId &&
      entry.subjectFingerprint === fingerprint &&
      sameOccurrence(entry.occurrence, occurrence),
  )
}

function sameOccurrence(
  a: readonly (string | number)[],
  b: readonly (string | number)[],
): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index])
}

function runContext<B extends ConstraintBoundary>(
  constraint: Constraint,
  ctx: ConstraintContext,
): SafetyRunContext<B> {
  const boundary = constraint.on as B
  return {
    policy: { id: constraint.id, mode: 'enforce' },
    boundary: { id: boundary.id as never, kind: boundary.id as never },
    prompt: { id: ctx.promptId },
    model: { id: ctx.model },
    trace: { id: ctx.traceId },
    attempt: { index: ctx.attempt, kind: ctx.attempt === 0 ? 'initial' : 'retry' },
    metadata: ctx.metadata,
    findings: { add() {} },
    ...(selectedPath(boundary) ? { path: selectedPath(boundary) } : {}),
  }
}

// ── Runner ────────────────────────────────────────────────────────

/**
 * Run all constraints against output using parallel-check, combined-retry.
 *
 * Algorithm:
 * 1. Run ALL constraint `check()` functions in parallel (`Promise.all`)
 * 2. Collect failures, separate assert vs suggest
 * 3. If any assert failure AND retries remain:
 *    - Combine all failure feedback into one message
 *    - Call `regenerate()` with combined feedback
 *    - Re-run from step 1
 * 4. If retries exhausted + assert failures: throw `ConstraintViolationError`
 * 5. If only suggest failures: return last attempt, track in audit
 */
export async function runConstraints(
  constraints: readonly Constraint[],
  output: ConstraintOutput,
  ctx: ConstraintContext,
  regenerate: (feedback: string, failures: readonly ConstraintFailure[]) => Promise<ConstraintOutput>,
  options?: ConstraintRunnerOptions,
): Promise<ConstraintRunResult> {
  return observe.span(
    {
      name: ctx.promptId ? `constraints:${ctx.promptId}` : 'constraints',
      primitive: 'constraint.check',
      attributes: {
        promptId: ctx.promptId,
        model: ctx.model,
        constraintCount: constraints.length,
        attempt: ctx.attempt,
      },
    },
    async () => runConstraintsInternal(constraints, output, ctx, regenerate, options),
  )
}

async function runConstraintsInternal(
  constraints: readonly Constraint[],
  output: ConstraintOutput,
  ctx: ConstraintContext,
  regenerate: (feedback: string, failures: readonly ConstraintFailure[]) => Promise<ConstraintOutput>,
  options?: ConstraintRunnerOptions,
): Promise<ConstraintRunResult> {
  const sharedCap = options?.constraintMaxRetries ?? Infinity
  let currentOutput = output
  let totalRetries = 0
  const allEntries: ConstraintAuditEntry[] = []

  // Per-constraint retry counters
  const retryCounters = new Map<string, number>()

  while (true) {
    const currentCtx: ConstraintContext = { ...ctx, attempt: totalRetries }

    // 1. Parallel check all constraints. Settlement evidence lets an unchanged
    // occurrence that already passed on the accepted stream attempt skip its
    // (potentially side-effectful) re-evaluation here.
    const results = await Promise.all(
      constraints.map(async (c) => observeConstraintCheck(c, currentOutput, currentCtx, options?.settled)),
    )

    // 2. Build audit entries and separate failures
    const roundEntries: ConstraintAuditEntry[] = []
    const failures: typeof results = []

    for (const r of results) {
      const entry: ConstraintAuditEntry = {
        constraint: r.constraint.id,
        ...(r.constraint.category !== undefined ? { category: r.constraint.category } : {}),
        severity: r.constraint.severity,
        pass: r.result.pass,
        feedback: r.result.pass ? undefined : r.result.feedback,
        attempts: (retryCounters.get(r.constraint.id) ?? 0) + 1,
        durationMs: r.durationMs,
        metadata: r.result.metadata,
      }
      roundEntries.push(entry)
      allEntries.push(entry)
      options?.onCheck?.(r.constraint, entry)

      if (!r.result.pass) {
        failures.push(r)
      }
    }

    // 3. If all pass, done
    if (failures.length === 0) break

    // 4. Check retry budget — only assert failures drive retries
    const assertFailures = failures.filter((f) => f.constraint.severity === 'assert')

    const canRetryAsserts = assertFailures.some((f) => {
      const used = retryCounters.get(f.constraint.id) ?? 0
      return used < f.constraint.maxRetries
    })

    if (assertFailures.length === 0 || !canRetryAsserts || totalRetries >= sharedCap) {
      // If assert failures remain and retries exhausted, throw
      if (assertFailures.length > 0) {
        const failedConstraints = assertFailures.map((f) => ({
          name: f.constraint.id,
          feedback: f.result.pass ? '' : f.result.feedback,
        }))

        const audit: ConstraintAudit = {
          entries: allEntries,
          allPassed: false,
          suggestFallback: false,
        }

        options?.onViolation?.(
          assertFailures.map((f) => f.constraint),
          totalRetries + 1,
        )

        throw new ConstraintViolationError({
          failedConstraints,
          audit,
          lastOutput: currentOutput.text,
          totalAttempts: totalRetries + 1,
        })
      }

      // Only suggest failures remain — return last attempt
      break
    }

    // 5. Combine all failure feedback and retry
    const combinedFeedback = failures
      .map((f) => (f.result.pass ? '' : `[${f.constraint.id}]: ${f.result.feedback}`))
      .filter(Boolean)
      .join('\n')

    const failureDetails: ConstraintFailure[] = failures.map((f) => ({
      name: f.constraint.id,
      category: f.constraint.category,
      severity: f.constraint.severity,
      feedback: f.result.pass ? '' : f.result.feedback,
    }))

    for (const f of failures) {
      retryCounters.set(f.constraint.id, (retryCounters.get(f.constraint.id) ?? 0) + 1)
    }
    totalRetries++

    options?.onRetry?.(
      failures.map((f) => f.constraint),
      totalRetries,
      failures.filter((f) => !f.result.pass).map((f) => (f.result.pass ? '' : f.result.feedback)),
    )

    // A combined retry is driven by every failed constraint; carry one
    // canonical ref per distinct constraint definition (ids are required).
    const retryRefs = Array.from(
      new Map(failures.map((f) => [f.constraint.id, f.constraint.id])).values(),
      (id) => constraintDefinitionRef(id),
    )
    currentOutput = await observe.span(
      {
        name: 'constraint retry',
        primitive: 'constraint.retry',
        definitionRefs: retryRefs,
        attributes: {
          failedCount: failures.length,
          nextAttempt: totalRetries,
          promptId: ctx.promptId,
        },
      },
      async () => {
        const activeSpanId = observe.captureContext()?.currentSpanId
        const artifactId = observe.artifact({
          kind: 'constraint.report',
          contentType: 'application/json',
          encoding: 'json',
          preview: {
            kind: 'constraint.report',
            // Content-free, for the same reason as `constraint.check`: feedback is
            // policy-authored prose that commonly echoes the candidate, and this record
            // is written while the attempt is still uncommitted. Length keeps the retry
            // explainable; the text itself still reaches the model, not telemetry.
            feedbackLength: combinedFeedback.length,
            failedConstraints: failures.map((f) => f.constraint.id),
            nextAttempt: totalRetries,
            attempts: failures.map((f) => ({
              n: totalRetries,
              status: 'retry',
              feedbackLength: f.result.pass ? undefined : (f.result.feedback?.length ?? 0),
            })),
          },
          attributes: {
            failedCount: failures.length,
            nextAttempt: totalRetries,
          },
        })
        if (activeSpanId && artifactId) {
          observe.edge({
            edgeType: 'constraint.retry',
            from: { kind: 'span', id: activeSpanId },
            to: { kind: 'artifact', id: artifactId },
            attributes: { failedCount: failures.length, nextAttempt: totalRetries },
          })
        }
        return regenerate(combinedFeedback, failureDetails)
      },
    )
  }

  // Determine final status from the LAST round's entries only
  // (allEntries includes historical rounds; final verdict is based on most recent check)
  const lastRoundSize = constraints.length
  const lastRoundEntries = allEntries.slice(-lastRoundSize)
  const allPassed = lastRoundEntries.length > 0 && lastRoundEntries.every((e) => e.pass)
  const hasSuggestFailures = lastRoundEntries.some((e) => !e.pass && e.severity === 'suggest')
  const hasAssertFailures = lastRoundEntries.some((e) => !e.pass && e.severity === 'assert')

  return {
    output: currentOutput,
    audit: {
      entries: allEntries,
      allPassed,
      suggestFallback: hasSuggestFailures && !hasAssertFailures,
    },
  }
}
