import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { indexProject } from '../index'
import { loadIndexerExtensionReferences } from '../indexer/extensions'

const testDir = dirname(fileURLToPath(import.meta.url))
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('indexer extension loading', () => {
  it('loads allowlisted package exports and validates package metadata before compiler use', async () => {
    const root = await fixtureRoot()
    await writePackage(root, '@acme/crux-indexer', {
      packageVersion: '1.2.3',
      source: `
        export const extension = {
          name: '@acme/crux-indexer',
          version: '7',
          crux: { indexer: '^0.1.0', projectIndexSchema: 1 },
          relations: [
            {
              type: '@acme/crux-indexer/uses_tool',
              fromKinds: ['@acme/workflow'],
              toKinds: ['tool'],
              presentation: 'both',
              runtimeJoin: false
            }
          ]
        }
      `,
    })

    const result = await loadIndexerExtensionReferences({
      root,
      config: {
        extensions: [{ package: '@acme/crux-indexer', export: 'extension', version: '^1.0.0' }],
        trust: { mode: 'allowlisted', allow: ['@acme/crux-indexer'] },
      },
    })

    expect(result.diagnostics).toEqual([])
    expect(result.extensions.map((entry) => entry.extension.name)).toEqual(['@acme/crux-indexer'])
    expect(result.extensions[0]?.packageVersion).toBe('1.2.3')
  })

  it('does not import denied packages during trust preflight', async () => {
    const root = await fixtureRoot()
    await writePackage(root, '@acme/denied-indexer', {
      packageVersion: '1.0.0',
      source: 'throw new Error("should not import denied extension")',
    })

    const result = await loadIndexerExtensionReferences({
      root,
      config: {
        extensions: [{ package: '@acme/denied-indexer' }],
        trust: { mode: 'allowlisted', allow: [], deny: ['@acme/denied-indexer'] },
      },
    })

    expect(result.extensions).toEqual([])
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['index.extension_not_allowed'])
    expect(result.diagnostics[0]?.message).toContain('@acme/denied-indexer')
  })

  it('reports package version and import failures as diagnostics', async () => {
    const root = await fixtureRoot()
    await writePackage(root, '@acme/old-indexer', {
      packageVersion: '0.5.0',
      source: `
        export default {
          name: '@acme/old-indexer',
          version: '1',
          crux: { indexer: '^0.1.0', projectIndexSchema: 1 }
        }
      `,
    })

    const result = await loadIndexerExtensionReferences({
      root,
      config: {
        extensions: [{ package: '@acme/old-indexer', version: '^1.0.0' }, { package: '@acme/missing-indexer' }],
        trust: { mode: 'allowlisted', allow: ['@acme/old-indexer', '@acme/missing-indexer'] },
      },
    })

    expect(result.extensions).toEqual([])
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'index.extension_import_failed',
      'index.extension_version_mismatch',
    ])
  })

  it('lets allowlisted package extensions contribute extractor facts to project indexing', async () => {
    const root = await fixtureRoot()
    await linkWorkspacePackage(root, '@crux/core', 'packages/core')
    await writePackage(root, '@acme/crux-indexer', {
      packageVersion: '1.0.0',
      source: `
        export default {
          name: '@acme/crux-indexer',
          version: '1',
          crux: { indexer: '^0.1.0', projectIndexSchema: 1 },
          extractors: [
            {
              name: '@acme/crux-indexer/widget',
              patterns: [{ kind: 'call', name: 'defineAcmeWidget' }],
              extract(ctx) {
                const name = ctx.config?.string('id') ?? ctx.source.localName
                return {
                  kind: 'facts',
                  facts: {
                    definitions: [
                      ctx.define.definition({
                        variableName: ctx.source.variableName,
                        id: 'tool:' + ctx.source.safeId(name),
                        kind: 'tool',
                        name,
                        metadata: { extension: '@acme/crux-indexer' }
                      })
                    ]
                  }
                }
              }
            }
          ]
        }
      `,
    })
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config } from '@crux/core'

        export default config({
          indexer: {
            extensions: [{ package: '@acme/crux-indexer', version: '^1.0.0' }],
            trust: { mode: 'allowlisted', allow: ['@acme/crux-indexer'] }
          }
        })
      `,
    )
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'widget.ts'), 'export const widget = defineAcmeWidget({ id: "search" })')

    const snapshot = await indexProject({ root })

    expect(snapshot.diagnostics.filter((diagnostic) => diagnostic.code.startsWith('index.extension'))).toEqual([])
    expect(snapshot.sources.map((source) => source.file)).toContain(join(root, 'src', 'widget.ts'))
    expect(snapshot.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tool:search',
          kind: 'tool',
          name: 'search',
          metadata: expect.objectContaining({ extension: '@acme/crux-indexer' }),
        }),
      ]),
    )
  })
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testDir, '..', '.tmp-extension-loading-'))
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
  const packageRoot = join(root, 'node_modules', ...name.split('/'))
  await mkdir(packageRoot, { recursive: true })
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name, version: input.packageVersion, type: 'module', exports: './index.mjs' }),
  )
  await writeFile(join(packageRoot, 'index.mjs'), input.source)
}

async function linkWorkspacePackage(root: string, name: string, workspaceRelativePath: string): Promise<void> {
  const packageRoot = join(root, 'node_modules', ...name.split('/'))
  await mkdir(join(packageRoot, '..'), { recursive: true })
  await symlink(join(process.cwd(), workspaceRelativePath), packageRoot, 'dir')
}
