import { execFile } from 'node:child_process'
import { cp, copyFile, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
const repository = resolve(directory, '../../../..')
const execute = promisify(execFile)

describe('admission replay cache', () => {
  it('rejects cached evidence when copied fixture bytes or the selected native artifact change', async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), 'crux-anydoc-cache-'))
    const copiedDirectory = resolve(temporary, 'packages/ingest/evals/anydoc')
    const copiedPdf = resolve(temporary, 'packages/ingest/__tests__/fixtures/layout-aware-mixed.pdf')
    const nativeArtifact = resolve(temporary, 'anydoc.node')
    const cacheDirectory = resolve(temporary, 'cache')

    try {
      await cp(directory, copiedDirectory, { recursive: true })
      await cp(resolve(repository, 'packages/ingest/src'), resolve(temporary, 'packages/ingest/src'), { recursive: true })
      await cp(resolve(repository, 'packages/ingest/private'), resolve(temporary, 'packages/ingest/private'), { recursive: true })
      await cp(resolve(directory, '../../__tests__/fixtures'), dirname(copiedPdf), { recursive: true })
      await symlink(resolve(repository, 'node_modules'), resolve(temporary, 'node_modules'), 'dir')
      await copyFile(nativeArtifactPath(), nativeArtifact)

      const first = await run(copiedDirectory, cacheDirectory, nativeArtifact)
      const original = await run(directory, resolve(temporary, 'original-cache'), nativeArtifact)
      expect(first.cacheIdentity).toBe(original.cacheIdentity)
      const cachedPath = resolve(cacheDirectory, 'families/csv.json')
      const staleFixture = JSON.parse(await readFile(cachedPath, 'utf8'))
      staleFixture.results[0].sourceHashMatches = true
      await writeFile(cachedPath, `${JSON.stringify(staleFixture)}\n`)
      await writeFile(resolve(copiedDirectory, 'fixtures/csv-control-v1.csv'), 'changed,fixture\n')

      const afterFixtureMutation = await run(copiedDirectory, cacheDirectory, nativeArtifact)
      expect(afterFixtureMutation.cacheIdentity).not.toBe(first.cacheIdentity)
      expect(afterFixtureMutation.results[0]?.sourceHashMatches).toBe(false)

      const staleArtifact = JSON.parse(await readFile(cachedPath, 'utf8'))
      staleArtifact.results[0].sourceHashMatches = false
      await writeFile(cachedPath, `${JSON.stringify(staleArtifact)}\n`)
      await writeFile(nativeArtifact, Buffer.from('not an ELF'))

      const afterArtifactMutation = await run(copiedDirectory, cacheDirectory, nativeArtifact)
      expect(afterArtifactMutation.cacheIdentity).not.toBe(afterFixtureMutation.cacheIdentity)
      expect(afterArtifactMutation.results[0]?.sourceHashMatches).toBe(false)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }, 60_000)

  it('keys every incumbent package, native artifact, and all lockfile bytes', async () => {
    const temporary = await mkdtemp(resolve(tmpdir(), 'crux-anydoc-incumbents-'))
    const cacheDirectory = resolve(temporary, 'cache')
    const mutable = [
      ['CRUX_MAMMOTH_PACKAGE_JSON', packagePath('mammoth@1.12.0/node_modules/mammoth/package.json')],
      ['CRUX_CSV_PARSE_PACKAGE_JSON', packagePath('csv-parse@6.2.1/node_modules/csv-parse/package.json')],
      ['CRUX_EXCELJS_PACKAGE_JSON', packagePath('exceljs@4.4.0/node_modules/exceljs/package.json')],
      ['CRUX_PDF_INSPECTOR_PACKAGE_JSON', packagePath('@firecrawl+pdf-inspector@1.12.0/node_modules/@firecrawl/pdf-inspector/package.json')],
      ['CRUX_PDFJS_PACKAGE_JSON', packagePath('pdfjs-dist@5.7.284/node_modules/pdfjs-dist/package.json')],
      ['CRUX_PDF_INSPECTOR_NATIVE_PACKAGE_JSON', packagePath('@firecrawl+pdf-inspector-linux-x64-gnu@1.12.0/node_modules/@firecrawl/pdf-inspector-linux-x64-gnu/package.json')],
      ['CRUX_PDF_INSPECTOR_NATIVE_ARTIFACT', packagePath('@firecrawl+pdf-inspector-linux-x64-gnu@1.12.0/node_modules/@firecrawl/pdf-inspector-linux-x64-gnu/pdf-inspector.linux-x64-gnu.node')],
    ] as const

    try {
      await symlink(resolve(repository, 'node_modules'), resolve(temporary, 'node_modules'), 'dir')
      const overrides: Record<string, string> = {}
      overrides.CRUX_ANYDOC_IDENTITY_ONLY = '1'
      for (const [environment, source] of mutable) {
        const target = resolve(temporary, `${environment}.identity`)
        await copyFile(source, target)
        overrides[environment] = target
      }
      const lockfile = resolve(temporary, 'pnpm-lock.yaml')
      await copyFile(resolve(repository, 'pnpm-lock.yaml'), lockfile)
      overrides.CRUX_ANYDOC_LOCKFILE = lockfile

      let previous = await run(directory, cacheDirectory, nativeArtifactPath(), overrides)
      for (const [environment] of mutable) {
        await writeFile(overrides[environment]!, Buffer.from(`mutated:${environment}`))
        const next = await run(directory, cacheDirectory, nativeArtifactPath(), overrides)
        expect(next.cacheIdentity, environment).not.toBe(previous.cacheIdentity)
        previous = next
      }

      await writeFile(lockfile, `${await readFile(lockfile, 'utf8')}# unrelated-transitive-lock-line\n`)
      const afterLockMutation = await run(directory, cacheDirectory, nativeArtifactPath(), overrides)
      expect(afterLockMutation.cacheIdentity).not.toBe(previous.cacheIdentity)
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }, 60_000)
})

async function run(directory: string, cacheDirectory: string, nativeArtifact: string, overrides: Readonly<Record<string, string>> = {}): Promise<any> {
  const { stdout } = await execute(process.execPath, [resolve(directory, 'admission-cli.mjs')], {
    cwd: repository,
    env: {
      ...process.env,
      CRUX_ANYDOC_EVAL_DIRECTORY: directory,
      CRUX_ANYDOC_EVAL_CACHE_DIRECTORY: cacheDirectory,
      CRUX_ANYDOC_NATIVE_ARTIFACT: nativeArtifact,
      CRUX_ANYDOC_PACKAGE_JSON: resolve(repository, 'node_modules/.pnpm/@firecrawl+anydoc@0.1.7/node_modules/@firecrawl/anydoc/package.json'),
      CRUX_ANYDOC_LOCKFILE: resolve(repository, 'pnpm-lock.yaml'),
      CRUX_ANYDOC_FORMATS: 'csv',
      ...overrides,
    },
    maxBuffer: 32 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

function packagePath(path: string): string {
  return resolve(repository, `node_modules/.pnpm/${path}`)
}

function nativeArtifactPath(): string {
  return resolve(repository, 'node_modules/.pnpm/@firecrawl+anydoc-linux-x64-gnu@0.1.7/node_modules/@firecrawl/anydoc-linux-x64-gnu/anydoc.linux-x64-gnu.node')
}
