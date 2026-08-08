import { fileURLToPath } from 'node:url'
import { mkdtemp, writeFile, access, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectDeterminismEvidence, runParserCandidate } from './sequential-runner.js'

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

  it('removes supplied worker temp paths and never labels local evidence production-equivalent', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'crux-anydoc-runner-'))
    await writeFile(join(temporary, 'worker.tmp'), 'temporary')
    const result = await runParserCandidate({
      workerPath,
      source: new URL('./fixtures/csv-control-v1.csv', import.meta.url),
      cleanupPaths: [temporary],
    })

    expect(result.metadata.productionEquivalent).toBe(false)
    await expect(access(temporary)).rejects.toThrow()
  })

  it('clamps case limits to global ceilings and requires all worker accounting', async () => {
    const result = await runParserCandidate({
      workerPath,
      source: new URL('./fixtures/csv-control-v1.csv', import.meta.url),
      workerArguments: ['success'],
      limits: { expandedBytes: Number.MAX_SAFE_INTEGER },
    })
    const missing = await runParserCandidate({
      workerPath,
      source: new URL('./fixtures/csv-control-v1.csv', import.meta.url),
      workerArguments: ['missing-counts'],
    })

    expect(result.outcome).toEqual({ kind: 'success' })
    expect(missing.outcome).toEqual({ kind: 'failure', error: 'invalid-result' })
  })

  it('accounts for three cold and five warm fresh child runs', async () => {
    const evidence = await collectDeterminismEvidence({ workerPath, source: new URL('./fixtures/csv-control-v1.csv', import.meta.url) })

    expect(evidence.cold).toHaveLength(3)
    expect(evidence.warm).toHaveLength(5)
    expect(evidence.deterministic).toBe(true)
    expect(new Set([...evidence.cold, ...evidence.warm].map((run) => run.metadata.workerPid)).size).toBe(8)
  })

  it.each([
    ['stdout', { stdoutBytes: 1 }, 'stdout-too-large'],
    ['stderr', { stderrBytes: 1 }, 'stderr-too-large'],
    ['expansion', { expandedBytes: 1 }, 'expanded-too-large'],
    ['asset-mismatch', {}, 'invalid-result'],
  ] as const)('fails closed for %s resource accounting', async (mode, limits, error) => {
    const result = await runParserCandidate({ workerPath, source: new URL('./fixtures/csv-control-v1.csv', import.meta.url), workerArguments: [mode], limits })
    expect(result.outcome).toEqual({ kind: 'failure', error })
  })

  it('enforces a Linux process-group CPU limit', async () => {
    const result = await runParserCandidate({ workerPath, source: new URL('./fixtures/csv-control-v1.csv', import.meta.url), workerArguments: ['cpu'], limits: { cpuMilliseconds: 1, wallMilliseconds: 1_000 } })
    expect(result.outcome).toEqual({ kind: 'failure', error: 'cpu-limit' })
    expect(result.metadata.cpuMilliseconds).toBeGreaterThan(1)
  })

  it('reaps a timed-out Linux worker process group, including descendants', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'crux-anydoc-descendant-'))
    const pidPath = join(temporary, 'pid')
    const result = await runParserCandidate({ workerPath, source: new URL('./fixtures/csv-control-v1.csv', import.meta.url), workerArguments: ['descendant', pidPath], limits: { wallMilliseconds: 300 } })
    const pid = Number(await readFile(pidPath, 'utf8'))

    expect(result.outcome).toEqual({ kind: 'failure', error: 'timeout' })
    await new Promise((resolve) => setTimeout(resolve, 75))
    await expect(access(`/proc/${pid}`)).rejects.toThrow()
  })
})
