import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const localWorkersPackageDir = join(repoRoot, 'packages', 'local-workers')
const devtoolsPackageDir = join(repoRoot, 'packages', 'devtools')

/**
 * Worker bundle entrypoints embedded by `@use-crux/local`.
 *
 * Keep this list aligned with `packages/local/internal/assets/embed`; the
 * private worker package owns the TypeScript sources that build these files.
 */
const workerEntrypoints = [
  'project-indexer.ts',
  'project-semantic-indexer.ts',
  'project-runtime-indexer.ts',
  'quality-runner.ts',
  'source-resolver.ts',
] as const

type WorkerEntrypoint = (typeof workerEntrypoints)[number]

describe('local worker package architecture', () => {
  it('keeps TypeScript worker entrypoints in the private local-workers package', () => {
    expect(existsSync(join(localWorkersPackageDir, 'package.json'))).toBe(true)
    expect(packageJson(localWorkersPackageDir)).toMatchObject({
      name: '@use-crux/local-workers',
      private: true,
    })

    for (const entrypoint of workerEntrypoints) {
      expect(existsSync(workerEntrypointPath(entrypoint)), entrypoint).toBe(true)
    }
    expect(existsSync(join(devtoolsPackageDir, 'bin'))).toBe(false)
  })

  it('builds workers and devtools UI through separate package scripts', () => {
    const localWorkers = packageJson(localWorkersPackageDir)
    const devtools = packageJson(devtoolsPackageDir)
    const localMakefile = readFileSync(join(repoRoot, 'packages', 'local', 'Makefile'), 'utf8')

    expect(localWorkers.scripts).toMatchObject({ build: 'node ./scripts/build-workers.mjs' })
    expect(devtools.scripts?.build).toBe('vite build --config ui/vite.config.ts')
    expect(devtools.scripts).not.toHaveProperty('build:workers')
    expect(localMakefile).toContain('@use-crux/local-workers')
    expect(localMakefile).not.toContain('../devtools/dist')
  })

  it('rejects staged local platform packages that omit the Rust static index worker', () => {
    const stageDir = mkdtempSync(join(tmpdir(), 'crux-npm-stage-'))
    try {
      const packageDir = join(stageDir, '@use-crux', 'local-linux-x64')
      mkdirSync(join(packageDir, 'bin'), { recursive: true })
      writeFileSync(join(packageDir, 'bin', 'crux'), 'test binary\n')
      writeJson(join(packageDir, 'package.json'), {
        name: '@use-crux/local-linux-x64',
        version: '0.4.0',
        description: 'Crux local runtime binary for linux-x64',
        os: ['linux'],
        cpu: ['x64'],
        files: ['bin'],
        license: 'Apache-2.0',
      })
      writeJson(join(stageDir, 'packages.json'), {
        packages: [
          {
            name: '@use-crux/local-linux-x64',
            version: '0.4.0',
            path: '@use-crux/local-linux-x64',
          },
        ],
      })

      const result = spawnSync(
        process.execPath,
        [join(repoRoot, 'scripts', 'validate-staged-npm-packages.mjs'), stageDir],
        {
          cwd: repoRoot,
          encoding: 'utf8',
        },
      )

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}\n${result.stderr}`).toContain('bin/crux-static-index-worker')
    } finally {
      rmSync(stageDir, { recursive: true, force: true })
    }
  }, 30_000)
})

interface WorkspacePackageJson {
  readonly name?: string
  readonly private?: boolean
  readonly scripts?: Partial<Record<string, string>>
}

function packageJson(packageDir: string): WorkspacePackageJson {
  return JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as WorkspacePackageJson
}

function workerEntrypointPath(entrypoint: WorkerEntrypoint): string {
  return join(localWorkersPackageDir, 'bin', entrypoint)
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
