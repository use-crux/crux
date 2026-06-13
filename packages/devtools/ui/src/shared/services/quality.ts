import { expectOk, fetchJson, postJson } from '@/shared/services/http'
import type {
  QualityOverviewRecord,
  QualityRunRecord,
  QualityRunDetailRecord,
  QualitySuiteRecord,
  QualityInsightRecord,
  QualityInsightSilence,
  QualityScorerRecord,
  QualityExperimentRecord,
  QualityComparisonRecord,
  QualityBaselineRecord,
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

// NOTE (Quality rewrite, phase 9): the canonical /api/quality/{overview,
// experiments,baselines,cassettes,scorers,suites,comparisons} endpoints now
// serve the NEW spec-02 contracts (see docs/handover-quality-devtools-contract.md
// in the Karyla repo). These legacy-shaped views consume the quarantined
// /api/quality/legacy/* endpoints until the UI redesign rebuilds them on the
// new shapes. runs/insights/feedback/activity are unchanged and stay canonical.
export const qualityService = {
  overview: (signal?: AbortSignal) =>
    fetchJson<QualityOverviewRecord>('/api/quality/legacy/overview', signal),
  runs: (opts?: QualityRunsOptions, signal?: AbortSignal) =>
    fetchJson<readonly QualityRunRecord[]>(`/api/quality/runs${buildRunsQuery(opts)}`, signal),
  runDetail: (traceId: string, signal?: AbortSignal) =>
    fetchJson<QualityRunDetailRecord>(`/api/quality/runs/${encodeURIComponent(traceId)}`, signal),
  suites: (signal?: AbortSignal) => fetchJson<readonly QualitySuiteRecord[]>('/api/quality/legacy/suites', signal),
  suite: (suiteId: string, signal?: AbortSignal) =>
    fetchJson<QualitySuiteRecord>(`/api/quality/legacy/suites/${encodeURIComponent(suiteId)}`, signal),
  insights: (signal?: AbortSignal) => fetchJson<readonly QualityInsightRecord[]>('/api/quality/insights', signal),
  insightSilences: (includeDeleted: boolean, signal?: AbortSignal) =>
    fetchJson<readonly QualityInsightSilence[]>(
      `/api/quality/insights/silences${includeDeleted ? '?include=deleted' : ''}`,
      signal,
    ),
  scorers: (signal?: AbortSignal) =>
    fetchJson<readonly QualityScorerRecord[]>('/api/quality/legacy/scorers', signal),
  experiments: (signal?: AbortSignal) =>
    fetchJson<readonly QualityExperimentRecord[]>('/api/quality/legacy/experiments', signal),
  comparisons: (signal?: AbortSignal) =>
    fetchJson<readonly QualityComparisonRecord[]>('/api/quality/legacy/comparisons', signal),
  baselines: (signal?: AbortSignal) =>
    fetchJson<readonly QualityBaselineRecord[]>('/api/quality/legacy/baselines', signal),
  feedback: (signal?: AbortSignal) => fetchJson<readonly QualityFeedbackRecord[]>('/api/quality/feedback', signal),
  async recordFeedback(input: RecordFeedbackInput): Promise<void> {
    await expectOk(await postJson('/api/quality/feedback', input), 'record feedback')
  },
  feedbackAnnotations: (signal?: AbortSignal) =>
    fetchJson<readonly QualityFeedbackAnnotationRecord[]>('/api/quality/feedback/annotations', signal),
  feedbackMemoryProposals: (signal?: AbortSignal) =>
    fetchJson<readonly QualityFeedbackMemoryProposalRecord[]>('/api/quality/feedback/memory-proposals', signal),
  cassettes: (signal?: AbortSignal) =>
    fetchJson<readonly QualityCassetteRecord[]>('/api/quality/legacy/cassettes', signal),
}
