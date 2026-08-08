import { fileURLToPath } from 'node:url'
import { mkdtemp, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runParserCandidate } from './sequential-runner.js'

const workerPath = fileURLToPath(new URL('./test-worker.mjs', import.meta.url))

describe('runParserCandidate', () => {
  it('runs one fresh worker at a time and returns canonical native and Core hashes', async () => {
    const result = await runParserCandidate({
      workerPath,
      source: new URL('./fixtures/csv-control-v1.csv', import.meta.url),
      limits: { wallMilliseconds: 1_000 },
      workerArguments: ['success'],
    })

    expect(result.outcome).toEqual({ kind: 'success' })
    expect(result.hashes.native).toMatch(/^[a-f0-9]{64}$/)
    expect(result.hashes.core).toMatch(/^[a-f0-9]{64}$/)
    expect(result.metadata.maxConcurrentChildren).toBe(1)
  })

  it.each([
    ['timeout', 'timeout', 40],
    ['crash', 'worker-crash', 500],
    ['invalid', 'invalid-result', 500],
    ['oversize-result', 'result-too-large', 500],
  ] as const)('fails closed when the worker %s', async (mode, error, wallMilliseconds) => {
    const result = await runParserCandidate({
      workerPath,
      source: new URL('./fixtures/csv-control-v1.csv', import.meta.url),
      limits: { wallMilliseconds, resultBytes: 32 },
      workerArguments: [mode],
    })

    expect(result.outcome).toEqual({ kind: 'failure', error })
    expect(result.metadata.cleanedUp).toBe(true)
  })

  it('rejects an oversized source before spawning a worker', async () => {
    const result = await runParserCandidate({
      workerPath,
      source: new URL('./fixtures/csv-control-v1.csv', import.meta.url),
      limits: { sourceBytes: 1 },
    })

    expect(result.outcome).toEqual({ kind: 'failure', error: 'source-too-large' })
    expect(result.metadata.maxConcurrentChildren).toBe(0)
  })

  it('queues simultaneous requests so only one child is alive at once', async () => {
    const startedAt = Date.now()
    const results = await Promise.all([0, 1, 2].map(() => runParserCandidate({
      workerPath,
      source: new URL('./fixtures/csv-control-v1.csv', import.meta.url),
      workerArguments: ['slow'],
      limits: { wallMilliseconds: 1_000 },
    })))

    expect(results.every((result) => result.metadata.maxConcurrentChildren === 1)).toBe(true)
    expect(Date.now() - startedAt).toBeGreaterThan(150)
  })

  it('removes supplied worker temp paths and only labels both host capabilities as production-equivalent', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'crux-anydoc-runner-'))
    await writeFile(join(temporary, 'worker.tmp'), 'temporary')
    const result = await runParserCandidate({
      workerPath,
      source: new URL('./fixtures/csv-control-v1.csv', import.meta.url),
      cleanupPaths: [temporary],
      hostCapability: {
        hardMemoryContainment: true,
        sandbox: {
          version: 1,
          verifiedBy: 'host-supervisor',
          filesystem: { read: 'input-only', write: 'private-temp-only' },
          outboundNetwork: 'denied',
          privilegeEscalation: 'denied',
        },
      },
    })

    expect(result.metadata.productionEquivalent).toBe(true)
    await expect(access(temporary)).rejects.toThrow()
  })
})
