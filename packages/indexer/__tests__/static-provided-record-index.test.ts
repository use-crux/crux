import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  indexProjectAstFromSyntaxRecordProviderForHost as indexProjectAstFromSyntaxRecordProvider,
  indexProjectAstFromSyntaxRecordsForHost as indexProjectAstFromSyntaxRecords,
  inspectProjectStaticSyntaxPlan,
} from '../host/static-index'
import { createRustOxcStaticSyntaxFrontend } from '../testing/rust-oxc-frontend'
import type { IndexPatch } from '../indexer/patches'

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

  it('projects AST patch facts from provided static syntax records', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    const source = [
      "import { prompt } from '@use-crux/core'",
      '',
      'export const writerPrompt = prompt({',
      "  id: 'writer.provided',",
      "  system: 'Write clearly.',",
      '})',
    ].join('\n')
    await writeFile(file, source)

    const record = await createRustOxcStaticSyntaxFrontend({ callNames: ['prompt'] }).parseFile({
      root,
      file,
      source,
    })
    const provided = await indexProjectAstFromSyntaxRecords({
      root,
      projectName: 'provided-records',
      records: [record],
    })

    expect(normalizedPatchFacts(provided)).toMatchObject({
      project: { root, name: 'provided-records' },
      diagnostics: [expect.objectContaining({ code: 'index.source_only' })],
      definitions: [expect.objectContaining({ id: 'prompt:writer.provided' })],
      relations: [],
    })
  })

  it('surfaces stale imported provided records as degraded diagnostics', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    const helperFile = join(root, 'src/helper.ts')
    const source = [
      "import { helper } from './helper'",
      "import { prompt } from '@use-crux/core'",
      '',
      "export const writerPrompt = prompt({ id: 'writer', prompt: helper })",
    ].join('\n')
    const helperSource = "export const helper = 'draft'"
    await writeFile(file, source)
    await writeFile(helperFile, helperSource)

    const frontend = createRustOxcStaticSyntaxFrontend({ callNames: ['prompt'] })
    const record = await frontend.parseFile({ root, file, source })
    const staleHelperRecord = await frontend.parseFile({ root, file: helperFile, source: helperSource })
    await writeFile(helperFile, "export const helper = 'changed'")

    const provided = await indexProjectAstFromSyntaxRecords({
      root,
      projectName: 'stale-provided-records',
      records: [record, staleHelperRecord],
    })

    expect(provided.status).toBe('degraded')
    expect(provided.facts.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'index.static_record_integrity',
        source: expect.objectContaining({ file: helperFile }),
      }),
    )
  })

  it('projects AST patch facts from a lazy syntax record provider', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    const secondFile = join(root, 'src/editor.ts')
    const source = [
      "import { prompt } from '@use-crux/core'",
      '',
      'export const writerPrompt = prompt({',
      "  id: 'writer.provider',",
      "  system: 'Write clearly.',",
      '})',
    ].join('\n')
    const secondSource = [
      "import { prompt } from '@use-crux/core'",
      '',
      "export const editorPrompt = prompt({ id: 'editor.provider' })",
    ].join('\n')
    await writeFile(file, source)
    await writeFile(secondFile, secondSource)

    const frontend = createRustOxcStaticSyntaxFrontend({ callNames: ['prompt'] })
    const record = await frontend.parseFile({
      root,
      file,
      source,
    })
    const secondRecord = await frontend.parseFile({
      root,
      file: secondFile,
      source: secondSource,
    })
    const recordsByFile = new Map([
      [file, record],
      [secondFile, secondRecord],
    ])
    const reads: string[] = []
    const batchReads: string[][] = []
    const provided = await indexProjectAstFromSyntaxRecordProvider({
      root,
      projectName: 'provided-record-provider',
      recordProvider: {
        identity: record.frontend,
        read: async (requestedFile) => {
          reads.push(requestedFile)
          return recordsByFile.get(requestedFile)
        },
        readMany: async (requestedFiles) => {
          batchReads.push([...requestedFiles])
          return new Map(
            requestedFiles.flatMap((requestedFile) => {
              const requestedRecord = recordsByFile.get(requestedFile)
              return requestedRecord ? [[requestedFile, requestedRecord] as const] : []
            }),
          )
        },
      },
    })

    expect(batchReads.flat()).toContain(file)
    expect(batchReads.flat()).toContain(secondFile)
    expect(reads).not.toContain(file)
    expect(reads).not.toContain(secondFile)
    expect((provided.facts.definitions ?? []).map((definition) => definition.id).sort()).toEqual([
      'prompt:editor.provider',
      'prompt:writer.provider',
    ])
  })

  it('indexes an empty project from an explicit native syntax frontend identity', async () => {
    const root = await fixtureRoot()

    const patch = await indexProjectAstFromSyntaxRecords({
      root,
      projectName: 'empty-provided-records',
      records: [],
      frontendIdentity: { name: 'oxc-rust', version: 'test' },
    })

    expect(patch.project).toMatchObject({ root, name: 'empty-provided-records' })
    expect(patch.facts.definitions).toEqual([])
  })
})

function normalizedPatchFacts(patch: IndexPatch) {
  return {
    project: patch.project,
    prompts: patch.facts.prompts,
    contexts: patch.facts.contexts,
    tools: patch.facts.tools,
    definitions: patch.facts.definitions,
    relations: patch.facts.relations,
    diagnostics: patch.facts.diagnostics,
    lintFindings: patch.facts.lintFindings,
    ruleDescriptors: patch.facts.ruleDescriptors,
    sources: patch.facts.sources,
    sourceGraph: patch.facts.sourceGraph,
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}
