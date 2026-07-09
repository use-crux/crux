import { expectOk, fetchJson, fetchJsonOr404, postJson } from '@/shared/services/http'
import type {
  QualityOverviewRecord,
  QualityRunRecord,
  QualityRunDetailRecord,
  QualityInsightRecord,
  QualityInsightSilence,
  QualityScorerRecord,
  QualityExperimentsPage,
  QualityExperimentsOptions,
  QualityEvaluationExperimentGroups,
  QualityEvaluationExperiments,
  QualityExperimentDetail,
  QualityCellEvidence,
  QualityBaselineRecord,
  QualityEvaluationProgress,
  QualityEvaluationManifest,
  QualityFeedbackRecord,
  QualityFeedbackAnnotationRecord,
  QualityFeedbackMemoryProposalRecord,
  QualityCassetteRecord,
  QualityJudgeReport,
  QualityExperimentDiff,
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

/**
 * A human label on one experiment cell (blueprint §4.4). Written to the same
 * feedback store as trace feedback, tagged `human-label`, so `judge-report`
 * can compute judge-vs-human agreement.
 */
export interface LabelCellInput {
  experimentId: string
  caseId: string
  variant: string
  trial: number
  verdict: 'pass' | 'fail'
  note?: string
  /** The judge score this label adjudicates, when labeling from a score row. */
  scoreName?: string
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

/** Build the optional `limit` query shared by quality relation/progress reads. */
export function buildLimitQuery(limit: number | undefined): string {
  if (limit == null) return ''
  const params = new URLSearchParams({ limit: String(limit) })
  return `?${params.toString()}`
}

export function buildExperimentsQuery(opts: QualityExperimentsOptions | undefined): string {
  if (!opts) return ''
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  if (opts.evaluation) params.set('evaluation', opts.evaluation)
  if (opts.window && opts.window !== 'all') params.set('window', opts.window)
  if (opts.limit != null) params.set('limit', String(opts.limit))
  if (opts.cursor) params.set('cursor', opts.cursor)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Build the optional `limit` query for evaluation progress reads. */
export function buildEvaluationProgressQuery(limit: number | undefined): string {
  return buildLimitQuery(limit)
}

export const qualityService = {
  overview: (window?: string, signal?: AbortSignal) =>
    fetchJson<QualityOverviewRecord>(
      `/api/quality/overview${window && window !== 'all' ? `?window=${encodeURIComponent(window)}` : ''}`,
      signal,
    ),
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
  /** Server-filtered, server-paged experiments list (one page + facets). */
  experiments: (opts?: QualityExperimentsOptions, signal?: AbortSignal) =>
    fetchJson<QualityExperimentsPage>(`/api/quality/experiments${buildExperimentsQuery(opts)}`, signal),
  /**
   * Experiment summaries grouped by evaluation, newest experiment group first.
   *
   * Use this for grouped list views instead of scanning all experiment rows in
   * the browser. `limit` caps experiments per evaluation group.
   */
  evaluationExperimentGroups: (limit?: number, signal?: AbortSignal) =>
    fetchJson<QualityEvaluationExperimentGroups>(
      `/api/quality/evaluations/experiment-groups${buildLimitQuery(limit)}`,
      signal,
    ),
  /**
   * Recent experiment summaries for one evaluation.
   *
   * Collection semantics: evaluations with no retained runs return an empty
   * `experiments` array and `total: 0`.
   */
  evaluationExperiments: (evaluationId: string, limit?: number, signal?: AbortSignal) =>
    fetchJson<QualityEvaluationExperiments>(
      `/api/quality/evaluations/${encodeURIComponent(evaluationId)}/experiments${buildLimitQuery(limit)}`,
      signal,
    ),
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
  /** Judge-vs-human agreement report for one evaluation (blueprint §12.2). */
  judgeReport: (evaluationId: string, signal?: AbortSignal) =>
    fetchJsonOr404<QualityJudgeReport>(`/api/quality/judge-report/${encodeURIComponent(evaluationId)}`, signal),
  /** Core-owned diff of two saved experiment records (blueprint §12.3). */
  experimentDiff: (a: string, b: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ a, b })
    return fetchJson<QualityExperimentDiff>(`/api/quality/experiments/diff?${params.toString()}`, signal)
  },
  feedback: (signal?: AbortSignal) => fetchJson<readonly QualityFeedbackRecord[]>('/api/quality/feedback', signal),
  async recordFeedback(input: RecordFeedbackInput): Promise<void> {
    await expectOk(await postJson('/api/quality/feedback', input), 'record feedback')
  },
  /** Write a human pass/fail label on one experiment cell (blueprint §12.4). */
  async labelCell(input: LabelCellInput): Promise<void> {
    const body = {
      experimentId: input.experimentId,
      caseId: input.caseId,
      rating: input.verdict === 'pass' ? 1 : -1,
      tags: ['human-label'],
      comment: input.note,
      metadata: {
        variant: input.variant,
        trial: input.trial,
        ...(input.scoreName ? { scoreName: input.scoreName } : {}),
      },
    }
    await expectOk(await postJson('/api/quality/feedback', body), 'label cell')
  },
  feedbackAnnotations: (signal?: AbortSignal) =>
    fetchJson<readonly QualityFeedbackAnnotationRecord[]>('/api/quality/feedback/annotations', signal),
  feedbackMemoryProposals: (signal?: AbortSignal) =>
    fetchJson<readonly QualityFeedbackMemoryProposalRecord[]>('/api/quality/feedback/memory-proposals', signal),
  cassettes: (signal?: AbortSignal) => fetchJson<readonly QualityCassetteRecord[]>('/api/quality/cassettes', signal),
}
