import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { runWithDeferInvocation } from '@use-crux/core/internal/scope'
import { communities, knowledgeBase } from '../../src/knowledge'
import { runWithDeferReplayGuard } from '../../src/defer/internal/replay-guard'
import { globalSearch } from '../../src/retrieval'
import { inMemoryStorage } from '../../src/storage'
import { testBinding } from '../defer/test-binding'
import { blockingCountingModel, chunk, countingModel, publishedGenerationIds } from './community-retained-refresh-fixtures'

const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
  vi.restoreAllMocks()
})

describe('connected knowledge retained community refresh', () => {
  it('schedules refresh in a defer-capable scope and publishes without explicit prepare', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const config = communities({ model })
    const docs = knowledgeBase({ id: 'retained-ready', storage, communities: config })
    let retained: (() => Promise<void>) | undefined

    await runWithDeferInvocation(
      () => docs.index([chunk('retained-ready', 'alpha', 'a1', 'Alpha works with Beta.')]),
      {
        binding: testBinding((run) => {
          retained = run
        }),
        classifyOutcome: () => 'success',
      },
    )

    await expect(docs.communities?.status()).resolves.toBe('building')
    await retained?.()

    await expect(docs.communities?.status()).resolves.toBe('ready')
    const firstGeneration = (await docs.communities?.reports())?.reports[0]?.generationId

    retained = undefined
    await runWithDeferInvocation(
      () => docs.reindex([chunk('retained-ready', 'beta', 'b1', 'Beta works with Gamma.')]),
      {
        binding: testBinding((run) => {
          retained = run
        }),
        classifyOutcome: () => 'success',
      },
    )
    await expect(docs.communities?.status()).resolves.toBe('building')
    await retained?.()
    await expect(docs.communities?.status()).resolves.toBe('ready')

    await docs.communities?.prepare({ force: true })
    expect((await docs.communities?.reports())?.reports[0]?.generationId).not.toBe(firstGeneration)
    expect(await publishedGenerationIds(storage.records, 'retained-ready', config.strategyFingerprint)).toHaveLength(1)

    retained = undefined
    await runWithDeferInvocation(
      () => docs.remove('beta'),
      {
        binding: testBinding((run) => {
          retained = run
        }),
        classifyOutcome: () => 'success',
      },
    )
    await expect(docs.communities?.status()).resolves.toBe('building')
    await retained?.()
    await expect(docs.communities?.status()).resolves.toBe('ready')
  })

  it('falls back totally when no defer-capable scope is active', async () => {
    process.env.NODE_ENV = 'development'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = inMemoryStorage()
    const model = countingModel()
    const docs = knowledgeBase({ id: 'retained-no-scope', storage, communities: communities({ model }) })

    await docs.index([chunk('retained-no-scope', 'alpha', 'a1', 'Alpha works with Beta.')])
    await docs.communities?.prepare()
    model.reset()

    await expect(docs.index([chunk('retained-no-scope', 'beta', 'b1', 'Beta works with Gamma.')])).resolves.toMatchObject({
      sourceCount: 1,
    })

    await expect(docs.communities?.status()).resolves.toBe('stale')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Communities for "retained-no-scope"'))
    expect(model.reportCalls()).toBe(0)
  })

  it('clears a scheduled refresh when the enclosing defer outcome skips callbacks', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const metadataSchema = z.object({ status: z.string() })
    const docs = knowledgeBase({ id: 'retained-skip', storage, metadataSchema, communities: communities({ model }) })

    await docs.index([chunk('retained-skip', 'alpha', 'a1', 'Alpha works with Beta.', { status: 'ok' })])
    await docs.communities?.prepare()
    let retained: (() => Promise<void>) | undefined

    await expect(runWithDeferInvocation(
      () => docs.index([
        chunk('retained-skip', 'alpha', 'a1', 'Alpha changed with Beta.', { status: 'ok' }),
        chunk('retained-skip', 'bad', 'b1', 'Bad metadata.', { status: 1 }),
      ]),
      {
        binding: testBinding((run) => {
          retained = run
        }),
        classifyOutcome: () => 'error',
      },
    )).rejects.toThrow(/metadata validation failed/)
    await retained?.()

    await expect(docs.communities?.status()).resolves.toBe('stale')
    await expect(docs.communities?.prepare()).resolves.toBeUndefined()
    await expect(docs.communities?.status()).resolves.toBe('ready')
  })

  it('joins a deferred refresh from prepare and reports without duplicate spend or publication', async () => {
    const storage = inMemoryStorage()
    const model = blockingCountingModel()
    const config = communities({ model })
    const docs = knowledgeBase({ id: 'retained-join', storage, communities: config })
    let retained: (() => Promise<void>) | undefined

    await runWithDeferInvocation(
      () => docs.index([chunk('retained-join', 'alpha', 'a1', 'Alpha works with Beta.')]),
      {
        binding: testBinding((run) => {
          retained = run
        }),
        classifyOutcome: () => 'success',
      },
    )

    const retainedRun = retained?.()
    await model.waitForReport()
    const prepare = docs.communities?.prepare()
    const reports = docs.communities?.reports()
    await Promise.resolve()

    expect(model.reportCalls()).toBe(1)
    model.releaseReports()
    await Promise.all([retainedRun, prepare, reports])

    expect(model.reportCalls()).toBe(1)
    expect(await publishedGenerationIds(storage.records, 'retained-join', config.strategyFingerprint)).toHaveLength(1)
  })

  it('global-search materialization wait joins a deferred refresh', async () => {
    const storage = inMemoryStorage()
    const model = countingModel()
    const config = communities({ model })
    const docs = knowledgeBase({ id: 'retained-global-search', storage, communities: config })
    let retained: (() => Promise<void>) | undefined

    await runWithDeferInvocation(
      () => docs.index(Array.from({ length: 4 }, (_, index) =>
        chunk('retained-global-search', `source-${index}`, `chunk-${index}`, 'residual evidence '.repeat(450)),
      )),
      {
        binding: testBinding((run) => {
          retained = run
        }),
        classifyOutcome: () => 'success',
      },
    )

    const retrieval = docs.recipe({ steps: [globalSearch({ model, detail: 'detailed' })] }).retrieveWithTrace('alpha')
    await Promise.resolve()

    expect(model.reportCalls()).toBe(0)
    const retainedRun = retained?.()
    const result = await retrieval
    await retainedRun

    expect(result.trace.steps[0]?.knowledge?.coverage).toBe('materialization-wait')
    expect(model.reportCalls()).toBeGreaterThan(0)
    expect(await publishedGenerationIds(storage.records, 'retained-global-search', config.strategyFingerprint)).toHaveLength(1)
    expect(model.searchCalls()).toBe(1)
  })

  it('falls back totally when defer is replay-unsafe', async () => {
    process.env.NODE_ENV = 'development'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = inMemoryStorage()
    const model = countingModel()
    const docs = knowledgeBase({ id: 'retained-replay', storage, communities: communities({ model }) })

    await docs.index([chunk('retained-replay', 'alpha', 'a1', 'Alpha works with Beta.')])
    await docs.communities?.prepare()
    model.reset()

    await expect(runWithDeferReplayGuard(() =>
      docs.index([chunk('retained-replay', 'beta', 'b1', 'Beta works with Gamma.')]),
    )).resolves.toMatchObject({ sourceCount: 1 })

    await expect(docs.communities?.status()).resolves.toBe('stale')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Communities for "retained-replay"'))
    expect(model.reportCalls()).toBe(0)
  })
})
