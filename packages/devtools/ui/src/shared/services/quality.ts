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

export const qualityService = {
  overview: (signal?: AbortSignal) => fetchJson<QualityOverviewRecord>('/api/quality/overview', signal),
  runs: (opts?: QualityRunsOptions, signal?: AbortSignal) =>
    fetchJson<readonly QualityRunRecord[]>(`/api/quality/runs${buildRunsQuery(opts)}`, signal),
  runDetail: (traceId: string, signal?: AbortSignal) =>
    fetchJson<QualityRunDetailRecord>(`/api/quality/runs/${encodeURIComponent(traceId)}`, signal),
  suites: (signal?: AbortSignal) => fetchJson<readonly QualitySuiteRecord[]>('/api/quality/suites', signal),
  suite: (suiteId: string, signal?: AbortSignal) =>
    fetchJson<QualitySuiteRecord>(`/api/quality/suites/${encodeURIComponent(suiteId)}`, signal),
  insights: (signal?: AbortSignal) => fetchJson<readonly QualityInsightRecord[]>('/api/quality/insights', signal),
  insightSilences: (includeDeleted: boolean, signal?: AbortSignal) =>
    fetchJson<readonly QualityInsightSilence[]>(
      `/api/quality/insights/silences${includeDeleted ? '?include=deleted' : ''}`,
      signal,
    ),
  scorers: (signal?: AbortSignal) => fetchJson<readonly QualityScorerRecord[]>('/api/quality/scorers', signal),
  experiments: (signal?: AbortSignal) =>
    fetchJson<readonly QualityExperimentRecord[]>('/api/quality/experiments', signal),
  comparisons: (signal?: AbortSignal) =>
    fetchJson<readonly QualityComparisonRecord[]>('/api/quality/comparisons', signal),
  baselines: (signal?: AbortSignal) => fetchJson<readonly QualityBaselineRecord[]>('/api/quality/baselines', signal),
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
