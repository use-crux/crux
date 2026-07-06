import type {
  Constraint,
  ConstraintContext,
  ConstraintAudit,
  ConstraintAuditEntry,
  ConstraintFailure,
  ConstraintOutput,
} from './types'
import { validateConstraintRunResult } from './types'
import { ConstraintViolationError } from './errors'
import { observe } from '../../observability'
import type { BoundaryDef } from '../boundary'
import type { SafetyRunContext } from '../decision'

// ── Runner Options ────────────────────────────────────────────────

export interface ConstraintRunnerOptions {
  /** Shared cap on total constraint retries across all constraints. */
  readonly constraintMaxRetries?: number
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
): Promise<ObservedConstraintCheck> {
  const span = observe.openSpan(
    {
      name: c.id,
      primitive: 'constraint.check',
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
      const result = validateConstraintRunResult(await c.run(subjectForBoundary(c.on, output) as never, runContext(c, ctx) as never), {
        policyId: c.id,
        boundary: c.on.id,
      })
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
          feedback: result.pass ? undefined : result.feedback,
          attempts: [
            {
              n: ctx.attempt + 1,
              status: result.pass ? 'pass' : 'fail',
              feedback: result.pass ? undefined : result.feedback,
            },
          ],
          metadata: result.metadata,
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
          feedback: result.pass ? undefined : result.feedback,
        },
      })
      span.end({
        attributes: {
          pass: result.pass,
          durationMs,
          feedback: result.pass ? undefined : result.feedback,
          metadata: result.metadata,
        },
      })
      return { constraint: c, result, durationMs }
    })
  } catch (error) {
    span.error(error)
    throw error
  }
}

function runContext<B extends BoundaryDef>(constraint: Constraint, ctx: ConstraintContext): SafetyRunContext<B> {
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
    ...(boundary.path ? { path: boundary.path } : {}),
  }
}

function subjectForBoundary(boundary: BoundaryDef, output: ConstraintOutput): unknown {
  if (boundary.id === 'model.output.text') return output.text
  if (boundary.id === 'model.output.object') return boundary.path ? valueAtPath(output.parsed, boundary.path) : output.parsed
  if (boundary.id === 'model.output') return { text: output.text, object: output.parsed }
  return output.text
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null) return undefined
    return (current as Readonly<Record<string, unknown>>)[segment]
  }, value)
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

    // 1. Parallel check all constraints
    const results = await Promise.all(constraints.map(async (c) => observeConstraintCheck(c, currentOutput, currentCtx)))

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

    currentOutput = await observe.span(
      {
        name: 'constraint retry',
        primitive: 'constraint.retry',
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
            feedback: combinedFeedback,
            failedConstraints: failures.map((f) => f.constraint.id),
            nextAttempt: totalRetries,
            attempts: failures.map((f) => ({
              n: totalRetries,
              status: 'retry',
              feedback: f.result.pass ? undefined : f.result.feedback,
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
