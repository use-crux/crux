import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { indexProjectAst, indexProjectAstFromSyntaxRecords, inspectProjectStaticSyntaxPlan } from '..'
import { canonicalIndexPatchFactsJson } from '../contracts/parity'
import {
  createTypeScriptStaticSyntaxFrontend,
  OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
  type StaticSyntaxFileRecord,
} from '../indexer/static-index/syntax'

const roots: string[] = []
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(testWorkspaceRoot, '.tmp-static-native-cache-parity-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Static Index native cache parity', () => {
  it('replays warm native cache hits with exact parser-backed patch parity', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/writer.ts')
    const source = [
      "import { prompt } from '@use-crux/core'",
      '',
      "export const writerPrompt = prompt({ id: 'writer.cached' })",
    ].join('\n')
    await writeFile(file, source)

    const coldPlan = await inspectProjectStaticSyntaxPlan({
      root,
      projectName: 'provided-records',
      includeCacheStatus: true,
    })
    expect(coldPlan.files).toEqual([file])
    expect(coldPlan.filesToParse).toEqual([file])
    expect(coldPlan.cacheMisses).toEqual([file])
    expect(coldPlan.cacheHits).toEqual([])

    const baseline = await indexProjectAst({ root, projectName: 'provided-records' })
    const record = await createRustIdentityRecord({ root, file, source })
    await indexProjectAstFromSyntaxRecords({
      root,
      projectName: 'provided-records',
      records: [record],
      frontendIdentity: OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
    })

    const warmPlan = await inspectProjectStaticSyntaxPlan({
      root,
      projectName: 'provided-records',
      includeCacheStatus: true,
    })

    expect(warmPlan.files).toEqual([file])
    expect(warmPlan.filesToParse).toEqual([])
    expect(warmPlan.cacheHits).toEqual([file])
    expect(warmPlan.cacheMisses).toEqual([])

    const projectedFromCacheOnly = await indexProjectAstFromSyntaxRecords({
      root,
      projectName: 'provided-records',
      records: [],
      frontendIdentity: OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
    })

    expect(canonicalIndexPatchFactsJson(projectedFromCacheOnly.facts)).toEqual(
      canonicalIndexPatchFactsJson(baseline.facts),
    )

    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }))
    const changedConfigPlan = await inspectProjectStaticSyntaxPlan({
      root,
      projectName: 'provided-records',
      includeCacheStatus: true,
    })

    expect(changedConfigPlan.filesToParse).toEqual([file])
    expect(changedConfigPlan.cacheHits).toEqual([])
    expect(changedConfigPlan.cacheMisses).toEqual([file])
  })
})

async function createRustIdentityRecord(input: {
  readonly root: string
  readonly file: string
  readonly source: string
}): Promise<StaticSyntaxFileRecord> {
  const record = await createTypeScriptStaticSyntaxFrontend({ callNames: ['prompt'] }).parseFile(input)
  return {
    ...record,
    frontend: OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
  }
}
