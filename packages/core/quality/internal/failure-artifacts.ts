/**
 * Build agent-readable failure artifacts from persisted experiment cells.
 *
 * This module keeps fix-surface policy in TypeScript core. Go read models may
 * render richer evidence, but pass/fail interpretation and artifact shape stay
 * here.
 *
 * @internal
 * @module
 */

import type { CellAssertionOutcome, Experiment, ExperimentCell } from '../experiment'
import type { FailureArtifact, FailureArtifactPhase, FailureArtifactScore, SuggestedFixSurface } from '../failure-artifact'
import { isFailureOutcome } from './assertion-outcomes'

type QualityExperiment = Experiment<unknown, unknown, string, string>

/**
 * Build the `record.failures` array for an experiment record.
 *
 * One artifact is emitted for every failed or errored cell. Passing and
 * skipped cells do not produce artifacts.
 */
export function buildFailureArtifacts(experiment: QualityExperiment, covers: readonly string[]): FailureArtifact[] {
  return experiment.cells
    .filter((cell) => cell.status === 'failed' || cell.status === 'errored')
    .map((cell) => buildFailureArtifact(experiment, cell, covers))
}

function buildFailureArtifact(
  experiment: QualityExperiment,
  cell: ExperimentCell<unknown, unknown>,
  covers: readonly string[],
): FailureArtifact {
  const failedOutcomes = cell.assertions.outcomes.filter(isFailureOutcome)
  const sourceRef = firstSourceRef(cell, failedOutcomes)
  const spanIds = spanIdsOf(failedOutcomes)
  const artifact: FailureArtifact = {
    caseId: cell.caseId,
    ...(cell.caseName !== undefined ? { caseName: cell.caseName } : {}),
    variant: cell.variantName,
    trial: cell.trial,
    phase: phaseOf(cell),
    input: cell.input,
    ...(cell.expected !== undefined ? { expected: cell.expected } : {}),
    ...(cell.output !== undefined ? { output: cell.output } : {}),
    scores: scoresOf(experiment, cell),
    failedOutcomes,
    ...(sourceRef !== undefined ? { sourceRef } : {}),
    covers: [...covers],
    ...(cell.traceIds[0] !== undefined ? { traceId: cell.traceIds[0] } : {}),
    spanIds,
    ...(cassetteIdOf(cell) !== undefined ? { cassetteId: cassetteIdOf(cell) } : {}),
    ...(cell.costUsd !== undefined ? { cost: { usd: cell.costUsd } } : {}),
    durationMs: cell.durationMs,
    suggestedFixSurfaces: classifyFixSurfaces(experiment, cell, failedOutcomes),
  }
  return artifact
}

function phaseOf(cell: ExperimentCell<unknown, unknown>): FailureArtifactPhase {
  switch (cell.error?.phase) {
    case 'expect':
    case 'afterScores':
    case 'score':
    case 'timeout':
      return cell.error.phase
    case 'execute':
    case 'replay':
      return 'task'
    default:
      return cell.assertions.outcomes.some((outcome) => outcome.phase === 'afterScores' && isFailureOutcome(outcome))
        ? 'afterScores'
        : 'expect'
  }
}

function scoresOf(experiment: QualityExperiment, cell: ExperimentCell<unknown, unknown>): FailureArtifactScore[] {
  return cell.scores.map((score) => {
    const delta = comparisonDeltaFor(experiment, cell, score.name)
    return {
      name: score.name,
      score: score.score,
      ...(delta !== undefined ? { delta } : {}),
      ...(typeof score.metadata?.rationale === 'string' ? { rationale: score.metadata.rationale } : {}),
    }
  })
}

function comparisonDeltaFor(experiment: QualityExperiment, cell: ExperimentCell<unknown, unknown>, scoreName: string): number | undefined {
  return experiment.comparison?.deltas.find((entry) => entry.variantName === cell.variantName && entry.scoreName === scoreName)?.meanDelta
}

function firstSourceRef(cell: ExperimentCell<unknown, unknown>, outcomes: readonly CellAssertionOutcome[]): string | undefined {
  return outcomes.find((outcome) => outcome.sourceRef !== undefined)?.sourceRef ?? cell.error?.sourceRef
}

function spanIdsOf(outcomes: readonly CellAssertionOutcome[]): string[] {
  return [...new Set(outcomes.flatMap((outcome) => outcome.spanIds ?? []))]
}

function cassetteIdOf(cell: ExperimentCell<unknown, unknown>): string | undefined {
  const missing = cell.error?.missingCassetteKey
  if (missing !== undefined) return missing
  const value = cell.metadata?.cassetteId
  return typeof value === 'string' ? value : undefined
}

function classifyFixSurfaces(
  experiment: QualityExperiment,
  cell: ExperimentCell<unknown, unknown>,
  failedOutcomes: readonly CellAssertionOutcome[],
): SuggestedFixSurface[] {
  const surfaces: SuggestedFixSurface[] = []
  const matchers = failedOutcomes.map((outcome) => outcome.matcher)
  if (matchers.some((matcher) => matcher.startsWith('retrieval') || matcher.startsWith('citations')) || failedRagScore(cell)) {
    surfaces.push('retriever')
  }
  if (matchers.some((matcher) => matcher.startsWith('toolCalls') || matcher.startsWith('steps')) || hasToolSchemaError(cell)) {
    surfaces.push('tool-schema')
  }
  if (matchers.some((matcher) => matcher.startsWith('handoffs') || matcher.startsWith('routing'))) {
    surfaces.push('handoff')
  }
  if (onlyJudgeScoresFailed(cell)) {
    surfaces.push('judge')
  }
  if (hasPassingSiblingTrial(experiment, cell)) {
    surfaces.push('flake')
  }
  if (surfaces.length === 0 && (cell.output !== undefined || failedOutcomes.length > 0 || cell.error?.phase === 'execute')) {
    surfaces.push('prompt')
  }
  return surfaces.length > 0 ? [...new Set(surfaces)] : ['unknown']
}

function failedRagScore(cell: ExperimentCell<unknown, unknown>): boolean {
  return cell.scores.some((score) => score.score !== null && score.score < 1 && /^(rag|retrieval)\./u.test(score.name))
}

function hasToolSchemaError(cell: ExperimentCell<unknown, unknown>): boolean {
  const code = cell.error?.diagnostics?.code
  return typeof code === 'string' && code.includes('tool')
}

function onlyJudgeScoresFailed(cell: ExperimentCell<unknown, unknown>): boolean {
  if (cell.scores.length === 0) return false
  const judgeScores = cell.scores.filter((score) => score.costClass === 'model' || score.metadata?.judge !== undefined)
  if (judgeScores.length === 0) return false
  const codeScores = cell.scores.filter((score) => score.costClass !== 'model' && score.metadata?.judge === undefined)
  return judgeScores.some((score) => score.score !== null && score.score < 1) && codeScores.every((score) => score.score === null || score.score >= 1)
}

function hasPassingSiblingTrial(experiment: QualityExperiment, cell: ExperimentCell<unknown, unknown>): boolean {
  return experiment.cells.some(
    (candidate) =>
      candidate !== cell &&
      candidate.caseId === cell.caseId &&
      candidate.variantName === cell.variantName &&
      candidate.status === 'passed',
  )
}
