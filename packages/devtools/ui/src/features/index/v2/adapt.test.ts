import { describe, expect, it } from 'vitest'
import { indexFactChips, type ViewDef } from './adapt'
import { kindMeta } from './kit'

describe('indexFactChips', () => {
  it('renders evaluation catalog facts as at-a-glance chips', () => {
    const def = {
      kind: 'evaluation',
      facts: {
        caseCount: 2,
        datasetPaths: ['./cases/support.jsonl'],
        scorerNames: ['exact', 'helpful'],
        gateKeys: ['exact', 'helpful', 'cost'],
        variantNames: ['baseline', 'tuned'],
        replayMode: 'replay-strict',
        covers: ['prompt:support.answer'],
      },
    } as ViewDef

    expect(indexFactChips(def)).toEqual([
      ['cases', 2],
      ['datasets', 1],
      ['scorers', 2],
      ['gates', 3],
      ['variants', 2],
      ['replay', 'replay-strict'],
      ['covers', 1],
    ])
  })
})

describe('kindMeta', () => {
  it('registers evaluation definitions in the quality family', () => {
    expect(kindMeta('evaluation')).toMatchObject({ label: 'Evaluation', family: 'quality' })
    expect(kindMeta('evaluation.case')).toMatchObject({ label: 'Evaluation case', family: 'quality', child: true })
  })

  it('registers deferred-work definitions under orchestration', () => {
    expect(kindMeta('deferred-work')).toMatchObject({
      label: 'Deferred work',
      family: 'orchestration',
    })
  })

  it('registers media.operation and ingest.source in the media family', () => {
    expect(kindMeta('media.operation')).toMatchObject({
      label: 'Media operation',
      family: 'media',
    })
    expect(kindMeta('ingest.source')).toMatchObject({
      label: 'Ingest source',
      family: 'media',
    })
  })
})
