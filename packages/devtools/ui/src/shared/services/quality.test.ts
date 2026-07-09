import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildEvaluationProgressQuery, buildLimitQuery, qualityService } from './quality'

describe('quality service helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds the evaluation progress query only when a limit is provided', () => {
    expect(buildLimitQuery(undefined)).toBe('')
    expect(buildLimitQuery(12)).toBe('?limit=12')
    expect(buildEvaluationProgressQuery(undefined)).toBe('')
    expect(buildEvaluationProgressQuery(12)).toBe('?limit=12')
  })

  it('fetches evaluation experiment relation endpoints with encoded ids and limits', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            _tag: 'QualityEvaluationExperiments',
            schemaVersion: 1,
            evaluationId: 'evals/foo bar',
            generatedAt: '2026-06-16T00:00:00.000Z',
            limit: 3,
            total: 0,
            experiments: [],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            _tag: 'QualityEvaluationExperimentGroups',
            schemaVersion: 1,
            generatedAt: '2026-06-16T00:00:00.000Z',
            limit: 2,
            totalEvaluations: 0,
            totalExperiments: 0,
            groups: [],
          }),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await qualityService.evaluationExperiments('evals/foo bar', 3)
    await qualityService.evaluationExperimentGroups(2)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:5173/api/quality/evaluations/evals%2Ffoo%20bar/experiments?limit=3',
      expect.anything(),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:5173/api/quality/evaluations/experiment-groups?limit=2',
      expect.anything(),
    )
  })

  it('posts a human label as a feedback record with the judge-report contract shape', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    await qualityService.labelCell({
      experimentId: '01KTA',
      caseId: 'case-1',
      variant: 'candidate',
      trial: 2,
      verdict: 'fail',
      note: 'off topic',
      scoreName: 'helpful',
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://localhost:5173/api/quality/feedback')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      experimentId: '01KTA',
      caseId: 'case-1',
      rating: -1,
      tags: ['human-label'],
      comment: 'off topic',
      metadata: { variant: 'candidate', trial: 2, scoreName: 'helpful' },
    })
  })

  it('builds the experiment diff query with both experiment ids', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            a: { experimentId: '01KTA' },
            b: { experimentId: '01KTB' },
            comparable: true,
            fingerprintDrift: [],
            scores: [],
            cases: [],
            onlyInA: [],
            onlyInB: [],
            gatesVerdict: { aPassed: true, bPassed: false },
          }),
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await qualityService.experimentDiff('01KTA', '01KTB')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/api/quality/experiments/diff?a=01KTA&b=01KTB',
      expect.anything(),
    )
  })

  it('treats a judge report for an unknown evaluation as a nullable read', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    )
    await expect(qualityService.judgeReport('evals.missing')).resolves.toBeNull()
  })

  it('treats missing run detail as a nullable read instead of a fatal fetch error', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    )

    await expect(qualityService.runDetail('run_missing')).resolves.toBeNull()
  })
})
