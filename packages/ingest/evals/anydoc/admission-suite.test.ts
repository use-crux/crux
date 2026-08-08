import { describe, expect, it } from 'vitest'
import { runAdmissionSuite } from './admission-suite.js'

describe('runAdmissionSuite', () => {
  it('runs available controls through their declared incumbent owner and never selects Anydoc for them', async () => {
    const evidence = await runAdmissionSuite({
      fixtureIds: ['csv-control-v1'],
      determinismRuns: false,
    })

    expect(evidence.results).toHaveLength(1)
    expect(evidence.results[0]).toMatchObject({
      fixtureId: 'csv-control-v1',
      role: 'control',
      candidates: [{ parser: 'csv-parse', selected: true, core: { admitted: true } }],
    })
  })
})
