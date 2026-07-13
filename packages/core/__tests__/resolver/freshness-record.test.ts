import { describe, expect, it } from 'vitest'
import { compilePrompt } from '../../src/resolver/compile'
import { createResolverFakes } from '../../src/resolver/fakes'
import { context } from '../../src/prompt'
import { retriever, type RetrieverHit } from '../../src/retrieval'

describe('resolver freshness record layer', () => {
  it('reports live and memo freshness facts on inspect parts and contribution artifacts', async () => {
    const fakes = createResolverFakes({ clockStart: 10_000 })
    let runs = 0
    const memoized = context({
      id: 'fresh-context',
      memo: { ttl: 60_000 },
      system: () => `fresh run ${++runs}`,
    })
    const compiled = compilePrompt(
      {
        id: 'freshness-record',
        system: 'Base.',
        use: [memoized],
      },
      { ports: fakes.ports },
    )

    const live = await compiled.resolve()
    fakes.clock.advance(2_500)
    const memo = await compiled.resolve()

    expect(runs).toBe(1)
    expect(live.inspect().system.parts.find((part) => part.source === 'context:fresh-context')).toMatchObject({
      servedFrom: 'live',
      resolvedAt: 10_000,
    })
    expect(memo.inspect().system.parts.find((part) => part.source === 'context:fresh-context')).toMatchObject({
      servedFrom: 'memo',
      resolvedAt: 10_000,
      age: 2_500,
    })

    const previews = fakes.observability.contributionPreviews('active')
    expect(previews.filter((preview) => preview.sourceId === 'context:fresh-context')).toEqual([
      expect.objectContaining({
        cacheStatus: 'miss',
        servedFrom: 'live',
        resolvedAt: 10_000,
      }),
      expect.objectContaining({
        cacheStatus: 'hit',
        servedFrom: 'memo',
        resolvedAt: 10_000,
        age: 2_500,
      }),
    ])
  })

  it('summarizes observed source facts from structured segments', async () => {
    const fakes = createResolverFakes({ clockStart: 20_000 })
    const sourced = context({
      id: 'sourced-context',
      system: () => ({
        segments: [
          { text: 'Newer source. ', dynamic: false, observedAt: 18_000, sourceVersion: 'doc-v2' },
          { text: 'Older source.', dynamic: false, observedAt: 12_000, sourceVersion: 'doc-v1' },
        ],
      }),
    })
    const compiled = compilePrompt(
      {
        id: 'source-freshness-record',
        system: 'Base.',
        use: [sourced],
      },
      { ports: fakes.ports },
    )

    const pass = await compiled.resolve()

    expect(pass.inspect().system.parts.find((part) => part.source === 'context:sourced-context')).toMatchObject({
      servedFrom: 'live',
      resolvedAt: 20_000,
      observedAt: 12_000,
      sourceVersion: 'doc-v2',
      segments: [
        { text: 'Newer source. ', dynamic: false, observedAt: 18_000, sourceVersion: 'doc-v2' },
        { text: 'Older source.', dynamic: false, observedAt: 12_000, sourceVersion: 'doc-v1' },
      ],
    })

    expect(fakes.observability.contributionPreviews('active')).toContainEqual(
      expect.objectContaining({
        sourceId: 'context:sourced-context',
        observedAt: 12_000,
        sourceVersion: 'doc-v2',
        segments: [
          { text: 'Newer source. ', dynamic: false, observedAt: 18_000, sourceVersion: 'doc-v2' },
          { text: 'Older source.', dynamic: false, observedAt: 12_000, sourceVersion: 'doc-v1' },
        ],
      }),
    )
  })

  it('records retriever hit metadata freshness in asContext segments', async () => {
    const fakes = createResolverFakes({ clockStart: 30_000 })
    const docs = retriever({
      id: 'docs',
      namespace: 'kb',
      retrieve: async (): Promise<RetrieverHit[]> => [
        {
          namespace: 'kb',
          source: { id: 'guide' },
          chunkId: 'intro',
          content: 'Install Crux with pnpm.',
          score: 0.9,
          metadata: { observedAt: 24_000, sourceVersion: 'guide-v3' },
        },
      ],
    })
    const compiled = compilePrompt(
      {
        id: 'retriever-freshness-record',
        system: 'Base.',
        use: [docs.asContext({ query: 'install' })],
      },
      { ports: fakes.ports },
    )

    const pass = await compiled.resolve()

    expect(pass.inspect().system.parts.find((part) => part.source === 'context:retriever:docs')).toMatchObject({
      observedAt: 24_000,
      sourceVersion: 'guide-v3',
      segments: expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('Install Crux with pnpm.'),
          observedAt: 24_000,
          sourceVersion: 'guide-v3',
        }),
      ]),
    })
  })
})
