import { expectOk, fetchJson, fetchJsonOr404, postJson } from '@/shared/services/http'
import type {
  QualityOverviewRecord,
  QualityRunRecord,
  QualityRunDetailRecord,
  QualityInsightRecord,
  QualityInsightSilence,
  QualityScorerRecord,
  QualityExperimentSummary,
  QualityExperimentDetail,
  QualityCellEvidence,
  QualityBaselineRecord,
  QualityEvaluationProgress,
  QualityEvaluationManifest,
  QualityFeedbackRecord,
  QualityFeedbackAnnotationRecord,
  QualityFeedbackMemoryProposalRecord,
  QualityCassetteRecord,
  SpanPrimitive,
} from '@/types'

export interface QualityRunsOptions {
  status?: readonly string[]
  target?: readonly string[]
  kind?: readonly string[]
  model?: readonly string[]
  has?: readonly ('feedback' | 'experiment' | string)[]
  session?: readonly string[]
  primitive?: readonly SpanPrimitive[]
  since?: number
  until?: number
  search?: string
  sort?: 'time' | 'duration' | 'cost' | 'tokens'
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface RecordFeedbackInput {
  traceId: string
  rating: -1 | 1
  comment?: string
  tags: readonly string[]
}

export function buildRunsQuery(opts: QualityRunsOptions | undefined): string {
  if (!opts) return ''
  const params = new URLSearchParams()
  if (opts.status?.length) params.set('status', opts.status.join(','))
  if (opts.target?.length) params.set('target', opts.target.join(','))
  if (opts.kind?.length) params.set('kind', opts.kind.join(','))
  if (opts.model?.length) params.set('model', opts.model.join(','))
  if (opts.has?.length) params.set('has', opts.has.join(','))
  if (opts.session?.length) params.set('session', opts.session.join(','))
  if (opts.primitive?.length) params.set('primitive', opts.primitive.join(','))
  if (opts.since != null) params.set('since', String(opts.since))
  if (opts.until != null) params.set('until', String(opts.until))
  if (opts.search) params.set('search', opts.search)
  if (opts.sort) params.set('sort', opts.sort)
  if (opts.order) params.set('order', opts.order)
  if (opts.limit != null) params.set('limit', String(opts.limit))
  if (opts.offset != null) params.set('offset', String(opts.offset))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Build the optional `limit` query for evaluation progress reads. */
export function buildEvaluationProgressQuery(limit: number | undefined): string {
  if (limit == null) return ''
  const params = new URLSearchParams({ limit: String(limit) })
  return `?${params.toString()}`
}

export const qualityService = {
  overview: (signal?: AbortSignal) => fetchJson<QualityOverviewRecord>('/api/quality/overview', signal),
  runs: (opts?: QualityRunsOptions, signal?: AbortSignal) =>
    fetchJson<readonly QualityRunRecord[]>(`/api/quality/runs${buildRunsQuery(opts)}`, signal),
  /** Full trace detail can legitimately be absent when quality retained only the cell record. */
  runDetail: (traceId: string, signal?: AbortSignal) =>
    fetchJsonOr404<QualityRunDetailRecord>(`/api/quality/runs/${encodeURIComponent(traceId)}`, signal),
  insights: (signal?: AbortSignal) => fetchJson<readonly QualityInsightRecord[]>('/api/quality/insights', signal),
  insightSilences: (includeDeleted: boolean, signal?: AbortSignal) =>
    fetchJson<readonly QualityInsightSilence[]>(
      `/api/quality/insights/silences${includeDeleted ? '?include=deleted' : ''}`,
      signal,
    ),
  scorers: (signal?: AbortSignal) => fetchJson<readonly QualityScorerRecord[]>('/api/quality/scorers', signal),
  /** Experiment list rows — presentation summaries of the spec-02 records. */
  experiments: (signal?: AbortSignal) =>
    fetchJson<readonly QualityExperimentSummary[]>('/api/quality/experiments', signal),
  /** Full spec-02 ExperimentRecord, served verbatim. */
  experimentDetail: (experimentId: string, signal?: AbortSignal) =>
    fetchJson<QualityExperimentDetail>(`/api/quality/experiments/${encodeURIComponent(experimentId)}`, signal),
  /** Joined backend evidence for one case x variant x trial cell. */
  cellEvidence: (
    experimentId: string,
    cell: { readonly caseId: string; readonly variantName: string; readonly trial: number },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({
      caseId: cell.caseId,
      variantName: cell.variantName,
      trial: String(cell.trial),
    })
    return fetchJson<QualityCellEvidence>(
      `/api/quality/experiments/${encodeURIComponent(experimentId)}/cell-evidence?${params.toString()}`,
      signal,
    )
  },
  /** Committed spec-02 BaselineRecords, served verbatim. */
  baselines: (signal?: AbortSignal) => fetchJson<readonly QualityBaselineRecord[]>('/api/quality/baselines', signal),
  /** One baseline by EVALUATION id (spec-02 filename rule: `baselines/<evaluationId>.json`). */
  baselineDetail: (evaluationId: string, signal?: AbortSignal) =>
    fetchJson<QualityBaselineRecord>(`/api/quality/baselines/${encodeURIComponent(evaluationId)}`, signal),
  /** Discovered evaluation manifests (structural facts, no execution). */
  evaluations: (signal?: AbortSignal) =>
    fetchJson<readonly QualityEvaluationManifest[]>('/api/quality/evaluations', signal),
  /** Recent runs and score series for one evaluation, computed by the backend. */
  evaluationProgress: (evaluationId: string, limit?: number, signal?: AbortSignal) =>
    fetchJson<QualityEvaluationProgress>(
      `/api/quality/evaluations/${encodeURIComponent(evaluationId)}/progress${buildEvaluationProgressQuery(limit)}`,
      signal,
    ),
  feedback: (signal?: AbortSignal) => fetchJson<readonly QualityFeedbackRecord[]>('/api/quality/feedback', signal),
  async recordFeedback(input: RecordFeedbackInput): Promise<void> {
    await expectOk(await postJson('/api/quality/feedback', input), 'record feedback')
  },
  feedbackAnnotations: (signal?: AbortSignal) =>
    fetchJson<readonly QualityFeedbackAnnotationRecord[]>('/api/quality/feedback/annotations', signal),
  feedbackMemoryProposals: (signal?: AbortSignal) =>
    fetchJson<readonly QualityFeedbackMemoryProposalRecord[]>('/api/quality/feedback/memory-proposals', signal),
  cassettes: (signal?: AbortSignal) => fetchJson<readonly QualityCassetteRecord[]>('/api/quality/cassettes', signal),
}
