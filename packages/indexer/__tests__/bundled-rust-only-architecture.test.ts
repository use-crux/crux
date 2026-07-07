import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '../../..')
const indexerRoot = path.join(repoRoot, 'packages/indexer')

const readRepoFile = (...segments: string[]) =>
  readFileSync(path.join(repoRoot, ...segments), 'utf8')

const platformLocalPackagePattern = /^@use-crux\/local-(?:darwin|linux|win32)-/

function collectPackageJsonFiles(root: string): string[] {
  const ignored = new Set([
    '.git',
    '.turbo',
    'dist',
    'node_modules',
    'target',
    'tmp',
    '.tmp',
  ])
  const entries = readdirSync(root)
  const files: string[] = []

  for (const entry of entries) {
    if (ignored.has(entry)) continue

    const absolute = path.join(root, entry)
    const relative = path.relative(repoRoot, absolute)
    const stats = statSync(absolute)

    if (stats.isDirectory()) {
      files.push(...collectPackageJsonFiles(absolute))
      continue
    }

    if (entry === 'package.json') {
      files.push(relative)
    }
  }

  return files
}

describe('bundled Rust-only indexing architecture', () => {
  it('does not ship first-party TypeScript static extractors', () => {
    expect(existsSync(path.join(indexerRoot, 'indexer/extractors'))).toBe(false)

    const profile = readRepoFile('packages/indexer/indexer/compiler/profile.ts')
    expect(profile).not.toContain('cruxCoreExtension')
    expect(profile).not.toContain('../extractors')
  })

  it('does not contain a TypeScript implementation of bundled lint evaluation', () => {
    expect(existsSync(path.join(indexerRoot, 'indexer/lints/findings.ts'))).toBe(
      false,
    )
    expect(existsSync(path.join(indexerRoot, 'indexer/lints/flow.ts'))).toBe(
      false,
    )
    expect(existsSync(path.join(indexerRoot, 'indexer/lints/extension.ts'))).toBe(
      false,
    )

    expect(existsSync(path.join(indexerRoot, 'indexer/compiler/index.ts'))).toBe(false)
    expect(existsSync(path.join(indexerRoot, 'indexer/lints/config.ts'))).toBe(false)
    expect(existsSync(path.join(indexerRoot, 'indexer/lints/suppressions.ts'))).toBe(false)
    expect(existsSync(path.join(indexerRoot, 'indexer/lints/profiles.ts'))).toBe(false)

    const staticWorker = readRepoFile(
      'packages/indexer/indexer/static-index/extension-host/evidence/worker.ts',
    )
    expect(staticWorker).not.toContain('indexLintFindings')
    expect(staticWorker).not.toContain('builtInIndexRuleDescriptors')
    expect(staticWorker).not.toContain('nativeLintFinalize')
  })

  it('does not expose a public in-process bundled indexing API', () => {
    const publicRoot = readRepoFile('packages/indexer/index.ts')

    for (const exportName of [
      'indexProject',
      'indexProjectAst',
      'indexProjectAstFromSyntaxRecordProvider',
      'indexProjectAstFromSyntaxRecords',
      'indexProjectRuntime',
      'indexProjectSemantic',
    ]) {
      expect(publicRoot).not.toMatch(new RegExp(`\\b${exportName}\\b`))
    }
  })

  it('does not keep a bundled TypeScript fallback branch in the extension host', () => {
    const hostManifest = readRepoFile(
      'packages/indexer/indexer/static-index/extension-host/host-plan/host-manifest.ts',
    )
    expect(hostManifest).not.toContain('typescript-bundled')
    expect(hostManifest).not.toContain('requiresTypeScriptHostForBundled')

    const evidenceHost = readRepoFile(
      'packages/indexer/indexer/static-index/extension-host/evidence/host.ts',
    )
    expect(evidenceHost).not.toContain('typescript-bundled-extractors')
  })

  it('does not keep the monolithic TypeScript Project Index compiler or syntax-record patch RPC', () => {
    expect(existsSync(path.join(indexerRoot, 'indexer/compiler/index.ts'))).toBe(false)
    expect(existsSync(path.join(indexerRoot, 'indexer/index.ts'))).toBe(false)

    const hostIndex = readRepoFile('packages/indexer/host/index.ts')
    const hostStatic = readRepoFile('packages/indexer/host/static-index.ts')
    const localWorker = readRepoFile('packages/local-workers/bin/project-indexer.ts')

    for (const source of [hostIndex, hostStatic, localWorker]) {
      expect(source).not.toContain('compileProjectIndex')
      expect(source).not.toContain('createProjectIndexCompiler')
      expect(source).not.toContain('indexProjectAstFromSyntaxRecords')
      expect(source).not.toContain('indexProjectAstFromSyntaxRecordProvider')
    }
  })
})

describe('@use-crux/local platform package staging', () => {
  it('keeps platform optionalDependencies out of committed workspace manifests', () => {
    const offenders: string[] = []

    for (const file of collectPackageJsonFiles(repoRoot)) {
      const manifest = JSON.parse(readRepoFile(file)) as {
        optionalDependencies?: Record<string, string>
      }
      const dependencyNames = Object.keys(manifest.optionalDependencies ?? {})
      const platformDependencies = dependencyNames.filter((name) =>
        platformLocalPackagePattern.test(name),
      )

      if (platformDependencies.length > 0) {
        offenders.push(`${file}: ${platformDependencies.join(', ')}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('validates the committed-manifest invariant during npm package staging', () => {
    const validator = readRepoFile('scripts/validate-staged-npm-packages.mjs')
    expect(validator).toContain('validateCommittedWorkspaceManifests')
    expect(validator).toContain('Platform optionalDependencies must be staged')
  })
})
