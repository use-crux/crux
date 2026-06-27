import { existsSync, readFileSync } from 'node:fs'
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
