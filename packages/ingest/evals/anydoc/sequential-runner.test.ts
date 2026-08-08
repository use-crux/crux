import { fileURLToPath } from 'node:url'
import { mkdtemp, writeFile, access, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectDeterminismEvidence, runParserCandidate } from './sequential-runner.js'

const workerPath = fileURLToPath(new URL('./test-worker.mjs', import.meta.url))
const anydocWorkerPath = fileURLToPath(new URL('./anydoc-worker.mjs', import.meta.url))

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

  it.each([
    ['unsupported', 'unsupported-format'],
    ['malformed', 'invalid-result'],
    ['encrypted', 'encrypted'],
    ['resourceLimit', 'expanded-too-large'],
    ['missingPart', 'invalid-result'],
  ] as const)('maps Anydoc %s to the closed evaluation code %s', async (code, expected) => {
    const result = await runParserCandidate({
      workerPath: anydocWorkerPath,
      source: new URL('./fixtures/csv-control-v1.csv', import.meta.url),
      workerArguments: [`__convert_error__:${code}`],
    })

    expect(result.outcome).toEqual({ kind: 'failure', error: expected })
    expect(result.hashes).toEqual({})
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

  it('runs one available DOCX fixture through the private Anydoc worker', async () => {
    const result = await runParserCandidate({
      workerPath: anydocWorkerPath,
      source: new URL('./fixtures/prose.docx', import.meta.url),
      workerArguments: ['docx'],
      limits: { wallMilliseconds: 5_000, expandedBytes: 8 * 1024 * 1024 },
    })

    expect(result.outcome).toEqual({ kind: 'success' })
    expect(result.hashes.native).toMatch(/^[a-f0-9]{64}$/)
    expect(result.hashes.core).toMatch(/^[a-f0-9]{64}$/)
  })

  it('retains the real DOCX fixture footnote, image asset, and native relationships through projection', async () => {
    const payload = await rawWorkerResult('docx', new URL('./fixtures/prose.docx', import.meta.url))
    const native = payload.native.value as { readonly observed: { readonly notes: readonly { readonly id: string }[]; readonly assets: readonly unknown[]; readonly blocks: unknown }; readonly facts: readonly unknown[] }
    const core = payload.core.value as { readonly assets: readonly unknown[]; readonly metadata: { readonly anydocRelationships: string } }
    const relationships = JSON.parse(core.metadata.anydocRelationships) as { readonly notes: readonly { readonly id: string }[]; readonly inlines: readonly { readonly kind: string; readonly noteId?: string; readonly source?: { readonly kind?: string } }[] }

    expect(native.observed.notes).toHaveLength(1)
    expect(native.observed.assets).toHaveLength(1)
    expect(JSON.stringify(native.observed.blocks)).toContain('noteRef')
    expect(JSON.stringify(native.observed.blocks)).toContain('image')
    expect(native.facts.length).toBeGreaterThan(0)
    expect(core.assets).toHaveLength(1)
    expect(relationships.notes).toEqual(native.observed.notes.map((note) => ({ id: note.id, kind: 'footnote' })))
    expect(relationships.inlines).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'noteRef' }),
      expect.objectContaining({ kind: 'image', source: expect.objectContaining({ kind: 'asset' }) }),
    ]))
  })

  it('projects every documented Anydoc block and inline variant without loading native code', async () => {
    const result = await runParserCandidate({
      workerPath: anydocWorkerPath,
      source: new URL('./fixtures/csv-control-v1.csv', import.meta.url),
      workerArguments: ['__synthetic_all_variants__'],
    })

    expect(result.outcome).toEqual({ kind: 'success' })
    expect(result.hashes.native).toMatch(/^[a-f0-9]{64}$/)
    expect(result.hashes.core).toMatch(/^[a-f0-9]{64}$/)
  })

  it('keeps PDF as a rejected control without loading a production parser route', async () => {
    const result = await runParserCandidate({
      workerPath: anydocWorkerPath,
      source: new URL('./fixtures/csv-control-v1.csv', import.meta.url),
      workerArguments: ['pdf'],
    })

    expect(result.outcome).toEqual({ kind: 'failure', error: 'pdf-control' })
  })

  it.each([
    ['unsupported-format', 'unsupported-format'],
    ['malformed', 'invalid-result'],
    ['encrypted', 'encrypted'],
    ['resourceLimit', 'invalid-result'],
    ['missingPart', 'invalid-result'],
    ['invalid-result', 'invalid-result'],
  ] as const)('never admits adapter failure %s', async (workerError, expected) => {
    const result = await runParserCandidate({
      workerPath,
      source: new URL('./fixtures/csv-control-v1.csv', import.meta.url),
      workerArguments: [`adapter-failure:${workerError}`],
    })

    expect(result.outcome).toEqual({ kind: 'failure', error: expected })
    expect(result.hashes).toEqual({})
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

  it('enforces CPU spent after the result frame and before the ACK handshake', async () => {
    const result = await runParserCandidate({ workerPath, source: new URL('./fixtures/csv-control-v1.csv', import.meta.url), workerArguments: ['cpu-after-result'], limits: { cpuMilliseconds: 1, wallMilliseconds: 1_000 } })
    expect(result.outcome).toEqual({ kind: 'failure', error: 'cpu-limit' })
  })

  it('terminates a runaway group on a resource breach well before its wall cap', async () => {
    const startedAt = Date.now()
    const result = await runParserCandidate({ workerPath, source: new URL('./fixtures/csv-control-v1.csv', import.meta.url), workerArguments: ['runaway'], limits: { cpuMilliseconds: 1, wallMilliseconds: 2_000 } })
    expect(result.outcome).toEqual({ kind: 'failure', error: 'cpu-limit' })
    expect(Date.now() - startedAt).toBeLessThan(800)
  })

  it.each([
    ['descendant-ignore', 'timeout'],
    ['descendant-crash', 'worker-crash'],
  ] as const)('reaps descendants after a %s leader', async (mode, error) => {
    const temporary = await mkdtemp(join(tmpdir(), 'crux-anydoc-descendant-'))
    const pidPath = join(temporary, 'pid')
    const result = await runParserCandidate({ workerPath, source: new URL('./fixtures/csv-control-v1.csv', import.meta.url), workerArguments: [mode, pidPath], limits: { wallMilliseconds: 300 } })
    const pid = Number(await readFile(pidPath, 'utf8'))

    expect(result.outcome).toEqual({ kind: 'failure', error })
    await new Promise((resolve) => setTimeout(resolve, 75))
    await expect(access(`/proc/${pid}`)).rejects.toThrow()
  })
})

async function rawWorkerResult(format: string, source: URL): Promise<{ readonly native: { readonly value: unknown }; readonly core: { readonly value: unknown } }> {
  const child = spawn(process.execPath, [anydocWorkerPath, format], { stdio: ['pipe', 'ignore', 'ignore', 'pipe', 'pipe'] })
  const sourceBytes = await readFile(source)
  child.stdin!.end(sourceBytes)
  const result = child.stdio[3]!
  const chunks: Buffer[] = []
  result.on('data', (chunk: Buffer) => chunks.push(chunk))
  await once(result, 'end')
  const frame = Buffer.concat(chunks)
  const body = JSON.parse(frame.subarray(4, 4 + frame.readUInt32BE(0)).toString()) as { readonly native: { readonly value: unknown }; readonly core: { readonly value: unknown } }
  ;(child.stdio[4] as NodeJS.WritableStream).write('ACK\n')
  await once(child, 'close')
  return body
}
