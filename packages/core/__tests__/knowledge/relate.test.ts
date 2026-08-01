import { describe, expect, it } from 'vitest'
import { knowledgeModel } from '../../src/knowledge/model'
import { relate } from '../../src/knowledge/relate/relate'
import type { RetrievalModel } from '../../src/retrieval'

const run = () => {}

function retrievalModel(): RetrievalModel {
  return {
    generateText: async () => ({ text: '', usage: undefined, response: undefined }) as never,
    generateObject: async () => ({ object: {} }) as never,
  }
}

function model() {
  return knowledgeModel({
    name: 'relation-extractor',
    version: '1',
    ...retrievalModel(),
  })
}

function types() {
  return {
    cites: {
      from: ['chunk', 'document'] as const,
      to: ['document'] as const,
      direction: 'directed' as const,
      description: 'Cites another document',
    },
    related: {
      from: ['entity'] as const,
      to: ['entity'] as const,
      direction: 'symmetric' as const,
      description: 'Entities are related',
    },
  }
}

describe('knowledgeModel', () => {
  it('binds retrieval methods to required identity', () => {
    const base = retrievalModel()
    const first = knowledgeModel({ name: 'extractor', version: '1', ...base })
    const second = knowledgeModel({ name: 'extractor', version: '1', ...base })
    const explicit = knowledgeModel({ name: 'extractor', fingerprint: 'custom', ...base })

    expect(first.name).toBe('extractor')
    expect(first.fingerprint).toBe(second.fingerprint)
    expect(explicit.fingerprint).toBe('custom')
  })

  it('rejects missing model identity for JavaScript callers', () => {
    expect(() => knowledgeModel({ name: '', version: '1', ...retrievalModel() })).toThrow(/name/)
    expect(() => knowledgeModel({ name: 'extractor', fingerprint: '', ...retrievalModel() })).toThrow(/fingerprint/)
    expect(() => knowledgeModel({ name: 'extractor', version: '', ...retrievalModel() })).toThrow(/version/)
    expect(() => knowledgeModel({ name: 'extractor', ...retrievalModel() } as never)).toThrow(/version or fingerprint/)
  })
})

describe('relate', () => {
  it('returns inert relation configuration', () => {
    const relation = relate({
      id: 'references',
      version: 1,
      types: types(),
      run,
    })

    expect(relation).toMatchObject({
      _tag: 'RelationStage',
      kind: 'relation',
      id: 'references',
      version: 1,
      mode: 'run',
    })
    expect(Object.isFrozen(relation)).toBe(true)
    expect(relation.fingerprint()).toEqual(expect.any(String))
  })

  it('rejects invalid authored identity and vocabulary', () => {
    expect(() => relate({ id: '', version: 1, types: types(), run })).toThrow(/id/)
    expect(() => relate({ id: 'references', version: 0, types: types(), run })).toThrow(/version/)
    expect(() => relate({ id: 'references', version: 1, types: {}, run })).toThrow(/at least one/)
    expect(() =>
      relate({
        id: 'references',
        version: 1,
        types: {
          'bad:name': {
            from: ['chunk'],
            to: ['document'],
            direction: 'directed',
            description: 'Bad name',
          },
        },
        run,
      }),
    ).toThrow(/must not contain/)
    expect(() =>
      relate({
        id: 'references',
        version: 1,
        types: {
          cites: {
            from: [],
            to: ['document'],
            direction: 'directed',
            description: 'Cites another document',
          },
        },
        run,
      }),
    ).toThrow(/from/)
    expect(() =>
      relate({
        id: 'references',
        version: 1,
        types: {
          cites: {
            from: ['invalid'],
            to: ['document'],
            direction: 'directed',
            description: 'Cites another document',
          },
        } as never,
        run,
      }),
    ).toThrow(/valid knowledge reference kinds/)
    expect(() =>
      relate({
        id: 'references',
        version: 1,
        types: {
          cites: {
            from: ['chunk'],
            to: ['document'],
            direction: 'directed',
            description: '',
          },
        },
        run,
      }),
    ).toThrow(/description/)
  })

  it('rejects invalid mode configuration for JavaScript callers', () => {
    expect(() => relate({ id: 'references', version: 1, types: types() } as never)).toThrow(/exactly one/)
    expect(() =>
      relate({
        id: 'references',
        version: 1,
        types: types(),
        model: model(),
        run,
      } as never),
    ).toThrow(/exactly one/)
    expect(() =>
      relate({
        id: 'references',
        version: 1,
        types: types(),
        run,
        instructions: 'Extract citations',
      } as never),
    ).toThrow(/exactly one|instructions/)
    expect(() =>
      relate({
        id: 'references',
        version: 1,
        types: types(),
        model: { ...retrievalModel(), name: 'broken', fingerprint: '' },
      } as never),
    ).toThrow(/fingerprint/)
  })

  it('keeps fingerprints stable under relation key and endpoint reorder', () => {
    const first = relate({
      id: 'references',
      version: 1,
      types: types(),
      run,
    })
    const second = relate({
      id: 'references',
      version: 1,
      types: {
        related: {
          description: 'Entities are related',
          direction: 'symmetric',
          to: ['entity'],
          from: ['entity'],
        },
        cites: {
          description: 'Cites another document',
          direction: 'directed',
          to: ['document'],
          from: ['document', 'chunk'],
        },
      },
      run,
    })

    expect(first.fingerprint()).toBe(second.fingerprint())
  })

  it('changes fingerprints when output-affecting configuration changes', () => {
    const base = relate({ id: 'references', version: 1, types: types(), run })
    const changedVersion = relate({ id: 'references', version: 2, types: types(), run })
    const changedDescription = relate({
      id: 'references',
      version: 1,
      types: {
        ...types(),
        cites: {
          ...types().cites,
          description: 'References another document',
        },
      },
      run,
    })
    const changedInstructions = relate({
      id: 'references',
      version: 1,
      types: types(),
      model: model(),
      instructions: 'Extract explicit citations',
    })
    const changedModel = relate({
      id: 'references',
      version: 1,
      types: types(),
      model: knowledgeModel({ name: 'relation-extractor', fingerprint: 'alternate', ...retrievalModel() }),
      instructions: 'Extract explicit citations',
    })

    expect(base.fingerprint()).not.toBe(changedVersion.fingerprint())
    expect(base.fingerprint()).not.toBe(changedDescription.fingerprint())
    expect(base.fingerprint()).not.toBe(changedInstructions.fingerprint())
    expect(changedInstructions.fingerprint()).not.toBe(changedModel.fingerprint())
  })
})
