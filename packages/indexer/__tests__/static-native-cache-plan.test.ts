import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  indexProjectAstFromSyntaxRecordsForHost as indexProjectAstFromSyntaxRecords,
  inspectProjectStaticSyntaxPlan,
} from '../host/static-index'
import { compileProjectIndex } from '../indexer/compiler'
import {
  createProvidedStaticSyntaxFrontend,
  createTypeScriptStaticSyntaxFrontend,
  type StaticSyntaxFileRecord,
} from '../indexer/static-index/syntax'
import { OXC_STATIC_SYNTAX_FRONTEND_IDENTITY } from '../indexer/static-index/syntax'

const roots: string[] = []
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-static-native-cache-plan-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Static Index cache planning', () => {
  it('misses Static Index cache entries written by a different Rust/Oxc frontend identity', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    const source = [
      "import { prompt } from '@use-crux/core'",
      '',
      "export const writerPrompt = prompt({ id: 'writer.frontend-cache' })",
    ].join('\n')
    await writeFile(file, source)

    await indexProjectAstFromSyntaxRecords({
      root,
      projectName: 'provided-records',
      records: [
        await createRustIdentityRecord({
          root,
          file,
          source,
          frontendVersion: 'oxc_parser@0.133.0+stale-test',
        }),
      ],
      frontendIdentity: {
        ...OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
        version: 'oxc_parser@0.133.0+stale-test',
      },
    })

    const plan = await inspectProjectStaticSyntaxPlan({
      root,
      projectName: 'provided-records',
      includeCacheStatus: true,
    })

    expect(plan.cacheHits).toEqual([])
    expect(plan.cacheMisses).toEqual([file])
    expect(plan.filesToParse).toEqual([file])
  })

  it('misses Static Index cache entries when a loaded extension package identity changes', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    const source = [
      "import { prompt } from '@use-crux/core'",
      '',
      "export const writerPrompt = prompt({ id: 'writer.extension-package-cache' })",
    ].join('\n')
    const firstConfig = 'crux.v1.config.ts'
    const secondConfig = 'crux.v2.config.ts'
    const firstConfigFile = join(root, firstConfig)
    const secondConfigFile = join(root, secondConfig)
    await writeFile(file, source)
    await writeCacheExtensionPackage(root, '@acme/cache-indexer-v1', '1.0.0')
    await writeExtensionConfig(firstConfigFile, '@acme/cache-indexer-v1')

    const frontend = createTypeScriptStaticSyntaxFrontend({ callNames: ['config', 'prompt'] })
    const records = [
      await createRustIdentityRecord({
        root,
        file: firstConfigFile,
        source: await readFixtureSource(firstConfigFile),
        frontend,
      }),
      await createRustIdentityRecord({ root, file, source, frontend }),
    ]

    await compileProjectIndex({
      root,
      configPath: firstConfig,
      projectName: 'provided-records',
      mode: 'config-policy',
      staticSyntaxFrontend: createProvidedStaticSyntaxFrontend({
        records,
        identity: OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
      }),
    })

    const warmFirstPackage = await inspectProjectStaticSyntaxPlan({
      root,
      configPath: firstConfig,
      projectName: 'provided-records',
      resolutionMode: 'config-policy',
      includeCacheStatus: true,
    })
    expect(warmFirstPackage.callNames).toContain('defineCacheWidget')
    expect(warmFirstPackage.cacheHits).toContain(file)

    await writeCacheExtensionPackage(root, '@acme/cache-indexer-v2', '2.0.0')
    await writeExtensionConfig(secondConfigFile, '@acme/cache-indexer-v2')
    const changedPackage = await inspectProjectStaticSyntaxPlan({
      root,
      configPath: secondConfig,
      projectName: 'provided-records',
      resolutionMode: 'config-policy',
      includeCacheStatus: true,
    })

    expect(changedPackage.cacheHits).not.toContain(file)
    expect(changedPackage.cacheMisses).toContain(file)
    expect(changedPackage.filesToParse).toContain(file)
  })
})

async function createRustIdentityRecord(input: {
  readonly root: string
  readonly file: string
  readonly source: string
  readonly frontend?: ReturnType<typeof createTypeScriptStaticSyntaxFrontend>
  readonly frontendVersion?: string
}): Promise<StaticSyntaxFileRecord> {
  const frontend = input.frontend ?? createTypeScriptStaticSyntaxFrontend({ callNames: ['prompt'] })
  const record = await frontend.parseFile(input)
  return {
    ...record,
    frontend: {
      ...OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
      ...(input.frontendVersion ? { version: input.frontendVersion } : {}),
    },
  }
}

async function readFixtureSource(file: string): Promise<string> {
  return readFile(file, 'utf8')
}

async function writeCacheExtensionPackage(root: string, name: string, packageVersion: string): Promise<void> {
  const packageRoot = join(root, 'node_modules', ...name.split('/'))
  await mkdir(packageRoot, { recursive: true })
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name, version: packageVersion, type: 'module', exports: './index.mjs' }),
  )
  await writeFile(
    join(packageRoot, 'index.mjs'),
    `
      export default {
        name: '@acme/cache-indexer',
        version: '1',
        crux: { indexer: '^0.1.0', projectIndexSchema: 1 },
        extractors: [
          {
            name: 'cache-widget',
            patterns: [{ kind: 'call', name: 'defineCacheWidget' }],
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
                      metadata: { extension: '@acme/cache-indexer' }
                    })
                  ]
                }
              }
            }
          }
        ]
      }
    `,
  )
}

async function writeExtensionConfig(file: string, packageName: string): Promise<void> {
  await writeFile(
    file,
    `
      import { config } from '@use-crux/core'

      export default config({
        indexer: {
          extensions: [{ package: '${packageName}' }],
          trust: { mode: 'allowlisted', allow: ['${packageName}', '@acme/cache-indexer'] }
        }
      })
    `,
  )
}
