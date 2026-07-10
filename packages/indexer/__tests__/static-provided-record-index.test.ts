import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectProjectStaticSyntaxPlan } from '../src/host/static-index'

const roots: string[] = []
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-provided-record-index-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('provided static syntax record indexing', () => {
  it('keeps source-only static syntax planning from importing user config modules', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    const sentinel = join(root, 'config-imported.txt')
    await writeFile(
      file,
      ["import { prompt } from '@use-crux/core'", '', "export const writerPrompt = prompt({ id: 'writer.plan' })"].join(
        '\n',
      ),
    )
    await writeFile(
      join(root, 'crux.config.ts'),
      [
        "import { writeFileSync } from 'node:fs'",
        "import { config } from '@use-crux/core'",
        '',
        `writeFileSync(${JSON.stringify(sentinel)}, 'imported')`,
        '',
        'export default config({',
        "  experimental: { indexer: { nativeAst: { frontend: 'oxc' } } },",
        '})',
      ].join('\n'),
    )

    const plan = await inspectProjectStaticSyntaxPlan({ root, projectName: 'provided-records' })

    expect(plan.files).toContain(file)
    expect(plan.configFile).toBe(join(root, 'crux.config.ts'))
    expect(plan.staticSyntaxEnabled).toBe(false)
    await expect(fileExists(sentinel)).resolves.toBe(false)
  })

  it('reports the static syntax plan needed by a native parser host', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    await writeFile(
      file,
      ["import { prompt } from '@use-crux/core'", '', "export const writerPrompt = prompt({ id: 'writer.plan' })"].join(
        '\n',
      ),
    )

    const plan = await inspectProjectStaticSyntaxPlan({
      root,
      projectName: 'provided-records',
      resolutionMode: 'config-policy',
    })

    expect(plan.root).toBe(root)
    expect(plan.files).toEqual([file])
    expect(plan.callNames).toEqual([])
    expect(plan.constructorNames).toEqual(['Agent'])
    expect(plan.pruneNativeFactCallNames).toEqual([])
    expect(plan.relationSpecs).toEqual([])
    expect(plan.ruleDescriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'prompt.missing_input_schema', source: 'builtin' }),
      ]),
    )
    expect(plan.sourceGraph).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        producedBy: '@use-crux/indexer',
        capabilities: expect.arrayContaining(['project-shards', 'source-dependencies']),
        shards: expect.arrayContaining([expect.objectContaining({ id: '.', root })]),
      }),
    )
    expect(plan.staticSyntaxEnabled).toBe(false)
  })

  it('reports staticSyntaxEnabled only when the Static Index syntax experiment is configured', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    await writeFile(
      file,
      ["import { prompt } from '@use-crux/core'", '', "export const writerPrompt = prompt({ id: 'writer.plan' })"].join(
        '\n',
      ),
    )
    await writeFile(
      join(root, 'crux.config.ts'),
      [
        "import { config } from '@use-crux/core'",
        '',
        'export default config({',
        "  experimental: { indexer: { nativeAst: { frontend: 'oxc' } } },",
        '})',
      ].join('\n'),
    )

    const plan = await inspectProjectStaticSyntaxPlan({
      root,
      projectName: 'provided-records',
      resolutionMode: 'config-policy',
    })

    expect(plan.files).toContain(file)
    expect(plan.staticSyntaxEnabled).toBe(true)
  })

  it('includes the selected config file even when static globs ignore its directory', async () => {
    const root = await fixtureRoot()
    const configFile = join(root, 'packages/local-workers/lib/__fixtures__/quality-project/crux.config.ts')
    await mkdir(dirname(configFile), { recursive: true })
    await writeFile(
      configFile,
      [
        "import { config, prompt } from '@use-crux/core'",
        '',
        "export const greeter = prompt({ id: 'fixture.greeter' })",
        'export default config({})',
      ].join('\n'),
    )

    const plan = await inspectProjectStaticSyntaxPlan({ root, projectName: 'provided-records' })

    expect(plan.configFile).toBe(configFile)
    expect(plan.files).toContain(configFile)
  })
})

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}
