import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { loadStaticExtensionHostManifestForProject } from '../src/host/static-compat'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const packageRoot = join(repoRoot, 'packages', 'indexer')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('project Static Index extension compatibility', () => {
  it.each([
    {
      name: 'trust deny',
      packageName: '@acme/denied-static-index-extension',
      packageVersion: '1.0.0',
      requestedVersion: undefined,
      source: 'throw new Error("denied extension package must not be imported")',
      trust: { allow: [], deny: ['@acme/denied-static-index-extension'] },
      diagnosticCode: 'index.extension_not_allowed',
    },
    {
      name: 'package version mismatch',
      packageName: '@acme/old-static-index-extension',
      packageVersion: '0.5.0',
      requestedVersion: '^1.0.0',
      source: manifestSource({
        name: '@acme/old-static-index-extension',
        crux: '{ indexer: "^0.1.0", projectIndexSchema: 1 }',
      }),
      trust: { allow: ['@acme/old-static-index-extension'], deny: [] },
      diagnosticCode: 'index.extension_version_mismatch',
    },
    {
      name: 'manifest incompatibility',
      packageName: '@acme/incompatible-static-index-extension',
      packageVersion: '1.0.0',
      requestedVersion: '^1.0.0',
      source: manifestSource({
        name: '@acme/incompatible-static-index-extension',
        crux: '{ indexer: "^99.0.0", projectIndexSchema: 1 }',
      }),
      trust: { allow: ['@acme/incompatible-static-index-extension'], deny: [] },
      diagnosticCode: 'index.extension_incompatible',
    },
  ])('reports $name diagnostics without enabling extension fallback', async (fixture) => {
    const root = await fixtureRoot()
    await linkWorkspacePackage(root, '@use-crux/core', 'packages/core')
    await writePackage(root, fixture.packageName, {
      packageVersion: fixture.packageVersion,
      source: fixture.source,
    })
    await writeStaticIndexExtensionConfig(root, {
      packageName: fixture.packageName,
      requestedVersion: fixture.requestedVersion,
      allow: fixture.trust.allow,
      deny: fixture.trust.deny,
    })

    const result = await loadStaticExtensionHostManifestForProject({
      root,
      nativeCompilerProtocolVersion: 2,
    })

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(fixture.diagnosticCode)
    expect(result.manifest.staticHost.extensionTypeScriptExtractorCount).toBe(0)
    expect(result.manifest.staticHost.requiresTypeScriptHostForExtensions).toBe(false)
    expect(result.manifest.staticHost.nativeOnlyEligible).toBe(true)
  })

  it('keeps compatible TypeScript extensions as Static Index host work', async () => {
    const root = await fixtureRoot()
    await linkWorkspacePackage(root, '@use-crux/core', 'packages/core')
    await writePackage(root, '@acme/static-index-extension', {
      packageVersion: '1.0.0',
      source: typeScriptExtractorManifestSource('@acme/static-index-extension'),
    })
    await writeStaticIndexExtensionConfig(root, {
      packageName: '@acme/static-index-extension',
      requestedVersion: '^1.0.0',
      allow: ['@acme/static-index-extension'],
      deny: [],
    })

    const result = await loadStaticExtensionHostManifestForProject({
      root,
      nativeCompilerProtocolVersion: 2,
    })

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code.startsWith('index.extension'))).toEqual([])
    expect(result.node).toEqual({ started: true, reasons: ['typescript-extension-extractors'] })
    expect(result.nativeOnlyEligible).toBe(false)
    expect(result.manifest.callNames).toContain('defineWorkflow')
    expect(result.manifest.staticInterests.extractors).toEqual([
      expect.objectContaining({
        extension: { name: '@acme/static-index-extension', version: '1' },
        name: 'workflow.define',
      }),
    ])
    expect(result.manifest.staticHost).toMatchObject({
      extensionTypeScriptExtractorCount: 1,
      requiresTypeScriptHostForExtensions: true,
      nativeOnlyEligible: false,
    })
  })
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(packageRoot, '.tmp-static-extension-host-project-compat-'))
  roots.push(root)
  return root
}

async function writePackage(
  root: string,
  name: string,
  input: {
    readonly packageVersion: string
    readonly source: string
  },
): Promise<void> {
  const target = join(root, 'node_modules', ...name.split('/'))
  await mkdir(target, { recursive: true })
  await writeFile(
    join(target, 'package.json'),
    JSON.stringify({ name, version: input.packageVersion, type: 'module', exports: './index.mjs' }),
  )
  await writeFile(join(target, 'index.mjs'), input.source)
}

async function linkWorkspacePackage(root: string, name: string, workspaceRelativePath: string): Promise<void> {
  const target = join(root, 'node_modules', ...name.split('/'))
  await mkdir(join(target, '..'), { recursive: true })
  await symlink(join(repoRoot, workspaceRelativePath), target, 'dir')
}

async function writeStaticIndexExtensionConfig(
  root: string,
  input: {
    readonly packageName: string
    readonly requestedVersion?: string
    readonly allow: readonly string[]
    readonly deny: readonly string[]
  },
): Promise<void> {
  const version = input.requestedVersion ? `, version: ${JSON.stringify(input.requestedVersion)}` : ''
  await writeFile(
    join(root, 'crux.config.ts'),
    [
      "import { config } from '@use-crux/core'",
      '',
      'export default config({',
      '  indexer: {',
      `    extensions: [{ package: ${JSON.stringify(input.packageName)}${version} }],`,
      `    trust: { mode: 'allowlisted', allow: ${JSON.stringify(input.allow)}, deny: ${JSON.stringify(input.deny)} },`,
      '  },',
      '})',
    ].join('\n'),
  )
}

function manifestSource(input: { readonly name: string; readonly crux: string }): string {
  return `
    export default {
      name: ${JSON.stringify(input.name)},
      version: '1',
      crux: ${input.crux}
    }
  `
}

function typeScriptExtractorManifestSource(name: string): string {
  return `
    export default {
      name: ${JSON.stringify(name)},
      version: '1',
      crux: { indexer: '^0.1.0', projectIndexSchema: 1 },
      static: {
        evidence: { mode: 'declared' },
        interests: {
          calls: [{ name: 'defineWorkflow', importFrom: ['@acme/workflows'], configArg: 0 }]
        }
      },
      extractors: [
        {
          name: 'workflow.define',
          patterns: [{ kind: 'call', name: 'defineWorkflow', importFrom: ['@acme/workflows'], configArg: 0 }],
          extract(ctx) {
            return { kind: 'facts', facts: { definitions: [] } }
          }
        }
      ]
    }
  `
}
