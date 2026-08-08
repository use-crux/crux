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

  it('runs the PDF control through only its isolated direct-inspector owner', async () => {
    const evidence = await runAdmissionSuite({ fixtureIds: ['pdf-control-v1'], determinismRuns: false })

    expect(evidence.results[0]?.candidates[0]).toMatchObject({
      parser: 'pdf-inspector',
      selected: true,
      outcome: { kind: 'success' },
    })
  })

  it('keeps DOCX quality leadership separate from format-wide primary admission', async () => {
    const evidence = await runAdmissionSuite({ fixtureIds: ['docx-structure-v1'], determinismRuns: false })

    expect(evidence.docxDecision).toEqual({ primary: null, reason: 'No candidate passed every format-wide gate.' })
  })
})
