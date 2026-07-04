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

import { observe, type CruxComparisonReportPreview, type CruxRunId } from '../../observability'
import type { Comparison } from '../experiment'

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
