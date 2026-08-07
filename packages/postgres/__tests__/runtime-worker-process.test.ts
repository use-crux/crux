import { access, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createRuntimeWorkerProjectFixture } from './runtime-worker-process-fixture'
import {
  exitOf,
  expireWorkLease,
  runApplication,
  startApplication,
  startWorker as startWorkerProcess,
  stopWorker,
  waitForOwnership,
  type RuntimeWorkerProjectFixture,
  type ApplicationProcess,
  type WorkerProcess,
} from './runtime-worker-process-harness'
import { startPostgresTestDatabase, type PostgresTestDatabase } from './test-database'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workerScript = resolve(packageRoot, '../local-workers/dist/runtime-worker.mjs')
const activeChildren = new Set<WorkerProcess>()
const activeApplications = new Set<ApplicationProcess>()
let fixtureNumber = 0

describe('generated Runtime worker process', () => {
  let database: PostgresTestDatabase | undefined
  const roots: string[] = []

  beforeAll(async () => {
    await access(workerScript).catch(() => {
      throw new Error(`Missing ${workerScript}. Build @use-crux/local-workers before running this suite.`)
    })
    database = await startPostgresTestDatabase()
  }, 30_000)

  afterAll(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
    await database?.close()
  })

  afterEach(async () => {
    await Promise.all([...activeChildren].map(stopWorker))
    for (const application of activeApplications) {
      if (application.child.exitCode === null && application.child.signalCode === null) {
        application.child.kill('SIGKILL')
      }
    }
    await Promise.all([...activeApplications].map((application) => application.exited))
  })

  it('rejects stale artifacts and releases durable ownership on signal for restart', async () => {
    const fixture = await projectFixture(testDatabase().url)
    roots.push(fixture.root)
    const first = startWorker(fixture.root)
    await waitForOwnership(first)

    const duplicate = startWorker(fixture.root)
    await expect(exitOf(duplicate)).resolves.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('already held'),
    })

    first.child.kill('SIGTERM')
    await expect(exitOf(first)).resolves.toMatchObject({ code: 0 })

    const replacement = startWorker(fixture.root)
    await waitForOwnership(replacement)
    replacement.child.kill('SIGINT')
    await expect(exitOf(replacement)).resolves.toMatchObject({ code: 0 })

    const manifestFile = join(fixture.root, '.crux/generated/runtime/manifest.json')
    await writeFile(manifestFile, `${(await readFile(manifestFile, 'utf8')).trim()} \n`)
    await expect(exitOf(startWorker(fixture.root))).resolves.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('does not match its manifest'),
    })
  })

  it('handles SIGTERM deterministically while the configured host is loading', async () => {
    const fixture = await projectFixture(testDatabase().url, true)
    roots.push(fixture.root)
    const marker = join(fixture.root, 'startup.marker')
    const worker = startWorker(fixture.root, { CRUX_RUNTIME_WORKER_STARTUP_MARKER: marker })
    await expect.poll(
      async () => access(marker).then(() => true, () => false),
      { timeout: 10_000 },
    ).toBe(true)

    worker.child.kill('SIGTERM')

    await expect(exitOf(worker)).resolves.toEqual({ code: 0, signal: null, stderr: '' })
  })

  it('recovers public Flow Work across separate application and worker processes', async () => {
    const fixture = await projectFixture(testDatabase().url, false, true)
    roots.push(fixture.root)

    const accepted = await runApplication(fixture, 'spawn', {
      documentId: 'doc_1',
      idempotencyKey: 'request_1',
    })
    const replay = await runApplication(fixture, 'spawn', {
      documentId: 'doc_1',
      idempotencyKey: 'request_1',
    })
    expect(replay.id).toBe(accepted.id)
    await expect(runApplication(fixture, 'spawn', {
      documentId: 'doc_2',
      idempotencyKey: 'request_1',
    })).resolves.toMatchObject({ error: 'WORK_IDEMPOTENCY_CONFLICT' })

    const detached = await runApplication(fixture, 'detach', { id: accepted.id })
    expect(detached).toMatchObject({
      id: accepted.id,
      status: { state: 'queued', ownership: { state: 'detached' } },
    })

    const first = startWorker(fixture.root)
    await waitForOwnership(first)
    await expect.poll(
      () => access(fixture.executionMarker).then(() => true, () => false),
      { timeout: 30_000 },
    ).toBe(true)
    first.child.kill('SIGKILL')
    await expect(exitOf(first)).resolves.toMatchObject({ signal: 'SIGKILL' })
    await expireWorkLease(fixture, accepted.id as string)

    const replacement = startWorker(fixture.root)
    await waitForOwnership(replacement)
    const joined = await runApplication(fixture, 'result', { id: accepted.id })
    expect(joined).toMatchObject({
      id: accepted.id,
      result: { documentId: 'doc_1', approved: true },
      status: { state: 'completed', ownership: { state: 'detached' } },
      effects: { kind: 'effect.scope' },
      stats: {
        lifecycle: {
          cancellations: 0,
          resumptions: 0,
          steeringInputs: 0,
          suspensions: 0,
        },
      },
    })
    replacement.child.kill('SIGTERM')
    await expect(exitOf(replacement)).resolves.toMatchObject({ code: 0 })
  }, 90_000)

  it('recovers an interrupted Effect exactly once in a replacement worker process', async () => {
    const fixture = await projectFixture(testDatabase().url, false, false, true)
    roots.push(fixture.root)
    const application = startApplication(fixture, 'interrupt', {
      documentId: 'doc_effect_1',
    })
    activeApplications.add(application)
    void application.exited.finally(() => activeApplications.delete(application))
    await expect.poll(
      () => access(fixture.recoveryReadyMarker).then(() => true, () => false),
      { timeout: 30_000 },
    ).toBe(true)

    application.child.kill('SIGKILL')
    await expect(application.exited).resolves.toMatchObject({ signal: 'SIGKILL' })

    const worker = startWorker(fixture.root)
    await waitForOwnership(worker)
    await expect.poll(
      () => access(fixture.recoveryEffectMarker).then(() => true, () => false),
      { timeout: 30_000 },
    ).toBe(true)
    const scope = JSON.parse(await readFile(fixture.recoveryScopeMarker, 'utf8'))
    const status = await runApplication(fixture, 'effect-status', { scope })
    expect(status).toMatchObject({
      scopeRecord: { scope: { status: 'completed' } },
      receipts: expect.arrayContaining([
        expect.objectContaining({
          receipt: expect.objectContaining({ recovery: 'recovered' }),
        }),
      ]),
      units: [{ unit: { status: 'recovered' } }],
      reconciliationRequired: [],
    })
    expect(status.attempts).toEqual([
      expect.objectContaining({ originalReceiptId: expect.any(String) }),
    ])
    expect((await readFile(fixture.recoveryCallsMarker, 'utf8')).trim().split('\n'))
      .toHaveLength(1)

    worker.child.kill('SIGTERM')
    await expect(exitOf(worker)).resolves.toMatchObject({ code: 0 })
  }, 90_000)

  function testDatabase(): PostgresTestDatabase {
    if (!database) throw new Error('PostgreSQL test database is unavailable.')
    return database
  }

  function projectFixture(
    url: string,
    delayStartup = false,
    publicWork = false,
    effectRecovery = false,
  ): Promise<RuntimeWorkerProjectFixture> {
    return createRuntimeWorkerProjectFixture({
      packageRoot,
      url,
      fixtureNumber: fixtureNumber++,
      delayStartup,
      publicWork,
      effectRecovery,
    })
  }
})
function startWorker(root: string, env: Readonly<Record<string, string>> = {}): WorkerProcess {
  const worker = startWorkerProcess(workerScript, root, env)
  activeChildren.add(worker)
  void worker.exited.finally(() => activeChildren.delete(worker))
  return worker
}
