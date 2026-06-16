import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildEvaluationProgressQuery, qualityService } from './quality'

describe('quality service helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds the evaluation progress query only when a limit is provided', () => {
    expect(buildEvaluationProgressQuery(undefined)).toBe('')
    expect(buildEvaluationProgressQuery(12)).toBe('?limit=12')
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
