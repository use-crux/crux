import type { QualityAssertionOutcome, QualityCheckEvidence, QualityCellEvidence } from '@/types'

/**
 * Finds the backend-normalized score threshold that came from a specific
 * assertion outcome. Assertion-derived thresholds reuse the assertion's source
 * frame, so this is the stable bridge between the ledger row and the friendlier
 * score-gate explanation.
 */
export function scoreThresholdForOutcome(
  checks: readonly QualityCheckEvidence[],
  outcome: QualityAssertionOutcome,
): Extract<QualityCheckEvidence, { kind: 'score-threshold' }> | undefined {
  const outcomeSourceRef = sourceFrameRef(outcome.sourceFrame)
  return checks.find(
    (check): check is Extract<QualityCheckEvidence, { kind: 'score-threshold' }> =>
      check.kind === 'score-threshold' &&
      check.source === 'assertion' &&
      outcomeSourceRef != null &&
      sourceFrameRef(check.sourceFrame) === outcomeSourceRef,
  )
}

/**
 * Renders one assertion in the authored form users recognize from eval code.
 *
 * The backend owns `subjectExpr`; when old records lack it we degrade to the
 * matcher-only form instead of guessing from evaluated values.
 */
export function assertionStatement(outcome: QualityAssertionOutcome): string {
  const receiver = outcome.subjectExpr ? `expect(${outcome.subjectExpr})` : ''
  const arg = assertionMatcherArgument(outcome)
  const call = `${outcome.matcher}(${arg})`
  return receiver ? `${receiver}.${call}` : call
}

/** Selects the most useful message for an assertion row. */
export function assertionMessage(
  checks: readonly QualityCheckEvidence[],
  outcome: QualityAssertionOutcome,
): string | undefined {
  return scoreThresholdForOutcome(checks, outcome)?.message ?? outcome.message
}

/** Formats the headline evaluated statement for the selected cell. */
export function evaluatedStatement(ev: QualityCellEvidence): { rendered: string; passed: boolean } | null {
  const failingGate = ev.checks.find(
    (check): check is Extract<QualityCheckEvidence, { kind: 'score-threshold' }> =>
      check.kind === 'score-threshold' && !check.passed,
  )
  const check = failingGate ?? decisiveCheck(ev)
  if (check?.kind === 'score-threshold') {
    return {
      rendered: `${check.scoreName} (${fixed2(check.score)}) ${check.operator} ${fixed2(check.threshold)} \u2192 ${check.passed}`,
      passed: check.passed,
    }
  }
  if (check?.kind === 'assertion') {
    const outcome = ev.assertions.outcomes.find((candidate) => candidate.id === check.outcomeId)
    if (outcome) {
      return {
        rendered: `${assertionStatement(outcome)} \u2192 ${check.expression?.result ?? outcome.status === 'passed'}`,
        passed: check.expression?.result ?? outcome.status === 'passed',
      }
    }
    if (check.expression) return { rendered: check.expression.rendered, passed: check.expression.result }
  }
  return null
}

/** The single check that explains the failure: first failing, else the first. */
export function decisiveCheck(ev: QualityCellEvidence): QualityCheckEvidence | null {
  const failing = ev.checks.find((check) =>
    check.kind === 'runtime-error' ? true : check.kind === 'assertion' ? check.status === 'failed' : !check.passed,
  )
  return failing ?? ev.checks[0] ?? null
}

function assertionMatcherArgument(outcome: QualityAssertionOutcome): string {
  const value = outcome.expected ?? outcome.expression?.right
  if (!value) return ''
  if (value.redacted) return value.preview
  if (typeof value.value === 'number') return fixed2(value.value)
  if (typeof value.value === 'string') return JSON.stringify(value.value)
  if (typeof value.value === 'boolean') return value.value ? 'true' : 'false'
  return value.preview
}

function fixed2(value: number): string {
  return value.toFixed(2)
}

function sourceFrameRef(frame: QualityAssertionOutcome['sourceFrame']): string | undefined {
  return frame?.kind === 'source-frame' ? frame.sourceRef : undefined
}
