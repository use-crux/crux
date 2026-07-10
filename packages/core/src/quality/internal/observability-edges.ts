/**
 * Quality-to-observability graph relations.
 *
 * The Quality engine owns evaluation, case, comparison, and replay semantics;
 * this module translates those semantics into canonical graph artifacts and
 * edges without leaking runner internals into the observability SDK.
 *
 * @internal
 * @module
 */

import {
  observe,
  type CapturedObservabilityContext,
  type CruxBaselinePromotionPreview,
  type CruxComparisonReportPreview,
  type CruxRunId,
  type CruxTraceId,
} from '../../observability'
import type { Comparison } from '../experiment'
import type { ExperimentDiff } from '../schema-types'

/** Persisted observability identity for an evaluation experiment. @internal */
export interface QualityObservabilityRunRef {
  readonly runId: string
  readonly traceId: string
}

/** Emit the comparison report hub artifact and its candidate/baseline edges. @internal */
export function emitComparisonReportEdges(input: {
  comparison: Comparison<string>
  candidate: QualityObservabilityRunRef
  baseline?: QualityObservabilityRunRef
}): void {
  const candidateRunId = validCruxRunId(input.candidate.runId)
  if (candidateRunId === undefined) return

  const preview: CruxComparisonReportPreview = {
    kind: 'comparison.report',
    mode: 'run',
    comparisonKind: input.comparison.kind,
    baseline: input.comparison.baseline,
    deltas: input.comparison.deltas.map((delta) => ({
      variantName: delta.variantName,
      scoreName: delta.scoreName,
      meanDelta: delta.meanDelta,
      sem: delta.sem,
      n: delta.n,
    })),
    unmatchedCases: {
      baselineOnly: [...input.comparison.unmatchedCases.baselineOnly],
      candidateOnly: [...input.comparison.unmatchedCases.candidateOnly],
    },
    ...(input.comparison.demoted !== undefined ? { demoted: input.comparison.demoted } : {}),
  }

  const artifactId = observe.artifact({
    kind: 'comparison.report',
    contentType: 'application/json',
    encoding: 'json',
    preview,
    attributes: {
      comparisonKind: input.comparison.kind,
      mode: 'run',
      baseline: input.comparison.baseline,
      deltaCount: input.comparison.deltas.length,
      unmatchedBaselineOnly: input.comparison.unmatchedCases.baselineOnly.length,
      unmatchedCandidateOnly: input.comparison.unmatchedCases.candidateOnly.length,
      demoted: input.comparison.demoted !== undefined,
    },
  })
  if (artifactId === undefined) return

  observe.edge({
    edgeType: 'comparison.candidate',
    from: { kind: 'artifact', id: artifactId },
    to: { kind: 'run', id: candidateRunId },
  })
  const baselineRunId = input.baseline === undefined ? undefined : validCruxRunId(input.baseline.runId)
  if (baselineRunId === undefined) return
  observe.edge({
    edgeType: 'comparison.baseline',
    from: { kind: 'artifact', id: artifactId },
    to: { kind: 'run', id: baselineRunId },
  })
}

/** Emit a diff comparison artifact and link it to the compared experiment runs. @internal */
export function emitExperimentDiffReportEdges(input: {
  diff: ExperimentDiff
  baseline?: QualityObservabilityRunRef
  candidate?: QualityObservabilityRunRef
}): void {
  const context = observabilityContextFor(input.candidate ?? input.baseline)
  if (context === undefined) return

  const preview: CruxComparisonReportPreview = {
    kind: 'comparison.report',
    mode: 'diff',
    a: input.diff.a,
    b: input.diff.b,
    comparable: input.diff.comparable,
    fingerprintDrift: [...input.diff.fingerprintDrift],
    scoreDeltas: input.diff.scores.map((score) => ({
      name: score.name,
      delta: score.delta,
      sem: score.sem,
    })),
    matchedCases: input.diff.cases.length,
    onlyInA: [...input.diff.onlyInA],
    onlyInB: [...input.diff.onlyInB],
  }

  observe.withContext(context, () => {
    const artifactId = observe.artifact({
      kind: 'comparison.report',
      contentType: 'application/json',
      encoding: 'json',
      preview,
      attributes: {
        mode: 'diff',
        experimentA: input.diff.a.experimentId,
        experimentB: input.diff.b.experimentId,
        comparable: input.diff.comparable,
        scoreCount: input.diff.scores.length,
        matchedCases: input.diff.cases.length,
        onlyInA: input.diff.onlyInA.length,
        onlyInB: input.diff.onlyInB.length,
      },
    })
    if (artifactId === undefined) return

    const baselineRunId = input.baseline === undefined ? undefined : validCruxRunId(input.baseline.runId)
    if (baselineRunId !== undefined) {
      observe.edge({
        edgeType: 'comparison.baseline',
        from: { kind: 'artifact', id: artifactId },
        to: { kind: 'run', id: baselineRunId },
      })
    }
    const candidateRunId = input.candidate === undefined ? undefined : validCruxRunId(input.candidate.runId)
    if (candidateRunId !== undefined) {
      observe.edge({
        edgeType: 'comparison.candidate',
        from: { kind: 'artifact', id: artifactId },
        to: { kind: 'run', id: candidateRunId },
      })
    }
  })
}

/** Emit a baseline promotion artifact linked to the promoted evaluation run. @internal */
export function emitBaselinePromotionArtifact(input: {
  evaluationId: string
  experimentId: string
  baselineId: string
  configFingerprint: string
  variantName: string
  run: QualityObservabilityRunRef
}): void {
  const runId = validCruxRunId(input.run.runId)
  const context = observabilityContextFor(input.run)
  if (runId === undefined || context === undefined) return

  const preview: CruxBaselinePromotionPreview = {
    kind: 'baseline.promotion',
    evaluationId: input.evaluationId,
    experimentId: input.experimentId,
    baselineId: input.baselineId,
    variant: input.variantName,
  }
  observe.withContext(context, () => {
    const artifactId = observe.artifact({
      kind: 'baseline.promotion',
      contentType: 'application/json',
      encoding: 'json',
      preview,
      attributes: {
        evaluationId: input.evaluationId,
        experimentId: input.experimentId,
        variant: input.variantName,
        configFingerprint: input.configFingerprint,
      },
    })
    if (artifactId === undefined) return
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'artifact', id: artifactId },
      to: { kind: 'run', id: runId },
    })
  })
}

/** Emit one membership relation from a case run to its evaluation run. @internal */
export function emitEvalCaseOfEdge(input: { caseRunId: string; evalRunId: string }): void {
  const caseRunId = validCruxRunId(input.caseRunId)
  const evalRunId = validCruxRunId(input.evalRunId)
  if (caseRunId === undefined || evalRunId === undefined) return
  observe.edge({
    edgeType: 'eval.case_of',
    from: { kind: 'run', id: caseRunId },
    to: { kind: 'run', id: evalRunId },
  })
}

/** Emit one replay relation from the current case run to the recorded run. @internal */
export function emitReplayOfEdge(input: {
  replay: QualityObservabilityRunRef
  recorded: QualityObservabilityRunRef
}): void {
  const replayRunId = validCruxRunId(input.replay.runId)
  const recordedRunId = validCruxRunId(input.recorded.runId)
  if (replayRunId === undefined || recordedRunId === undefined) return
  observe.edge({
    edgeType: 'replay.of',
    from: { kind: 'run', id: replayRunId },
    to: { kind: 'run', id: recordedRunId },
  })
}

function validCruxRunId(runId: string): CruxRunId | undefined {
  return /^run_[0-9a-f]{24}$/u.test(runId) ? (runId as CruxRunId) : undefined
}

function validCruxTraceId(traceId: string): CruxTraceId | undefined {
  return /^[0-9a-f]{32}$/u.test(traceId) ? (traceId as CruxTraceId) : undefined
}

function observabilityContextFor(run: QualityObservabilityRunRef | undefined): CapturedObservabilityContext | undefined {
  if (run === undefined) return undefined
  const runId = validCruxRunId(run.runId)
  const traceId = validCruxTraceId(run.traceId)
  if (runId === undefined || traceId === undefined) return undefined
  return { runId, traceId, spanStack: [] }
}
