import { createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { postgres } from '../src/runtime'
import { startPostgresTestDatabase, type PostgresTestDatabase } from './test-database'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workerScript = resolve(packageRoot, '../local-workers/dist/runtime-worker.mjs')
const activeChildren = new Set<WorkerProcess>()

describe('generated Runtime worker process', () => {
  let database: PostgresTestDatabase
  const roots: string[] = []

  beforeAll(async () => {
    database = await startPostgresTestDatabase()
  }, 30_000)

  afterAll(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
    await database.close()
  })

  afterEach(async () => {
    await Promise.all([...activeChildren].map(stopWorker))
  })

  it('rejects stale artifacts and releases durable ownership on signal for restart', async () => {
    const root = await projectFixture(database.url)
    roots.push(root)
    const first = startWorker(root)
    await waitForOwnership(database.url, 'runtime_worker_process', first)

    const duplicate = startWorker(root)
    await expect(exitOf(duplicate)).resolves.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('already held'),
    })

    first.child.kill('SIGTERM')
    await expect(exitOf(first)).resolves.toMatchObject({ code: 0 })

    const replacement = startWorker(root)
    await waitForOwnership(database.url, 'runtime_worker_process', replacement)
    replacement.child.kill('SIGINT')
    await expect(exitOf(replacement)).resolves.toMatchObject({ code: 0 })

    const manifestFile = join(root, '.crux/generated/runtime/manifest.json')
    await writeFile(manifestFile, `${(await readFile(manifestFile, 'utf8')).trim()} \n`)
    await expect(exitOf(startWorker(root))).resolves.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('does not match its manifest'),
    })
  })

  it('handles SIGTERM deterministically while the configured host is loading', async () => {
    const root = await projectFixture(database.url, true)
    roots.push(root)
    const marker = join(root, 'startup.marker')
    const worker = startWorker(root, { CRUX_RUNTIME_WORKER_STARTUP_MARKER: marker })
    await expect.poll(async () => access(marker).then(() => true, () => false)).toBe(true)

    worker.child.kill('SIGTERM')

    await expect(exitOf(worker)).resolves.toEqual({ code: 0, signal: null, stderr: '' })
  })

  async function projectFixture(url: string, delayStartup = false): Promise<string> {
    const root = await mkdtemp(join(packageRoot, '.tmp-runtime-worker-process-'))
    const schema = delayStartup ? 'runtime_worker_process_startup' : 'runtime_worker_process'
    const setup = postgres({ url, schema })
    await setup.setup.apply()
    await setup.close()
    await mkdir(join(root, '.crux/generated/runtime'), { recursive: true })
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'config-entry.ts'),
      [
        ...(delayStartup
          ? [
              "import { writeFile } from 'node:fs/promises'",
              "if (process.env.CRUX_RUNTIME_WORKER_STARTUP_MARKER) {",
              "  await writeFile(process.env.CRUX_RUNTIME_WORKER_STARTUP_MARKER, 'loading')",
              "  await new Promise((resolve) => setTimeout(resolve, 3_000))",
              "}",
            ]
          : []),
        "import { config } from '@use-crux/core'",
        "import { node } from '@use-crux/core/runtime'",
        "import { postgres } from '@use-crux/postgres/runtime'",
        `export default config({ runtime: node({ store: postgres({ url: ${JSON.stringify(url)}, schema: '${schema}' }), namespace: 'process-test' }) })`,
      ].join('\n'),
    )
    await writeFile(
      join(root, 'program-entry.ts'),
      [
        "import { createRuntimeProgram, durableTask } from '@use-crux/core/runtime'",
        "const generatedTarget = durableTask('generated-target', { run: async () => 'ok' })",
        "export const runtimeProgram = createRuntimeProgram({ targets: [generatedTarget], transports: [] })",
      ].join('\n'),
    )
    const manifest = `${JSON.stringify({ version: 2, evalPrivacyFingerprint: 'test', targets: [{ name: 'generated-target', kind: 'task', module: './src/task.ts', export: 'generatedTarget' }], evals: [] }, null, 2)}\n`
    const hash = createHash('sha256').update(manifest).digest('hex')
    await Promise.all([
      build({
        entryPoints: [join(root, 'config-entry.ts')],
        outfile: join(root, 'config-bundle.mjs'),
        bundle: true,
        platform: 'node',
        format: 'esm',
        banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      }),
      build({ entryPoints: [join(root, 'program-entry.ts')], outfile: join(root, 'program-bundle.mjs'), bundle: true, platform: 'node', format: 'esm' }),
    ])
    await writeFile(join(root, 'crux.config.ts'), "export { default } from './config-bundle.mjs'\n")
    await writeFile(join(root, '.crux/generated/runtime/manifest.json'), manifest)
    await writeFile(
      join(root, '.crux/generated/runtime/program.ts'),
      [
        "export { runtimeProgram } from '../../../program-bundle.mjs'",
        `export const runtimeArtifactManifestHash = '${hash}'`,
        "export const runtimeProgramFormat = 'crux-runtime-program:v1'",
      ].join('\n'),
    )
    return root
  }
})

interface WorkerProcess {
  readonly child: ChildProcess
  readonly exited: Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>
  readonly stderr: () => string
}

function startWorker(root: string, env: Readonly<Record<string, string>> = {}): WorkerProcess {
  const child = spawn(process.execPath, [workerScript, root], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => { stderr += chunk })
  const exited = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(
    (resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal })),
  )
  const worker = { child, exited, stderr: () => stderr }
  activeChildren.add(worker)
  void exited.finally(() => activeChildren.delete(worker))
  return worker
}

async function exitOf(process: WorkerProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }> {
  return { ...await process.exited, stderr: process.stderr() }
}

async function waitForOwnership(url: string, schema: string, process: WorkerProcess): Promise<void> {
  const store = postgres({ url, schema })
  const ownershipPort = store.maintenanceOwnership
  if (!ownershipPort) throw new Error('Postgres maintenance ownership is unavailable.')
  try {
    await expect.poll(async () => {
      if (process.child.exitCode !== null) {
        throw new Error(`worker exited ${process.child.exitCode}: ${process.stderr()}`)
      }
      const ownership = await ownershipPort.acquire('process-test')
      if (ownership.acquired) await ownership.release()
      return ownership.acquired
    }, { timeout: 30_000 }).toBe(false)
  } finally {
    await store.close()
  }
}

async function stopWorker(worker: WorkerProcess): Promise<void> {
  if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL')
  await worker.exited
}
