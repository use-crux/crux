import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IndexPatchFacts } from '../indexer/patches'
import {
  createNativeSemanticBackend,
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from '../indexer/semantic/service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('native semantic direct tool aliases', () => {
  it('matches TypeScript facts for createTool', async () => {
    const root = await fixtureRoot()
    await writeTsconfig(root)
    const file = join(root, 'src/create-tool.ts')
    await writeFile(
      file,
      `
        import { createTool } from '@crux/core'
        import { z } from 'zod'

        const SearchInput = z.object({ query: z.string() })
        const SearchOutput = z.object({ results: z.array(z.string()) })

        async function executeSearch(input: z.infer<typeof SearchInput>) {
          return { results: [input.query] }
        }

        export const searchTool = createTool({
          name: 'search',
          parameters: SearchInput,
          output: SearchOutput,
          execute: executeSearch,
        })
      `,
    )

    await expectDirectNativeParity(root, file)
  }, 20_000)
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-native-direct-tool-'))
  roots.push(root)
  return root
}

async function expectDirectNativeParity(root: string, file: string): Promise<void> {
  const timingNames: string[] = []
  const coverageExtractors: string[][] = []
  const typescriptPatch = await createSemanticIndexService({
    backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
  }).indexFiles({ root, files: [file] })
  const nativePatch = await createSemanticIndexService({
    backend: createNativeSemanticBackend({ cache: 'disabled' }),
  }).indexFiles({
    root,
    files: [file],
    semanticInstrumentation: {
      onTiming: (timing) => timingNames.push(timing.name),
      onNativeCoverage: (coverage) => coverageExtractors.push('extractors' in coverage ? [...coverage.extractors] : []),
    },
  })

  expect(typescriptPatch.status).toBe('ok')
  expect(nativePatch.status).toBe('ok')
  expect(normalizedFacts(nativePatch.facts)).toEqual(normalizedFacts(typescriptPatch.facts))
  expect(timingNames).toContain('semantic.native.extractor.direct_crux')
  expect(timingNames).not.toContain('semantic.native.analyzer.shared')
  expect(coverageExtractors).toEqual([['crux.direct-crux']])
}

async function writeTsconfig(root: string): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        target: 'ES2022',
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
    }),
  )
}

function normalizedFacts(facts: IndexPatchFacts): IndexPatchFacts {
  return {
    definitions: sortJsonRows(facts.definitions),
    sourceRefs: sortJsonRows(facts.sourceRefs),
    relations: sortJsonRows(facts.relations),
    diagnostics: sortJsonRows(facts.diagnostics),
    lintFindings: sortJsonRows(facts.lintFindings),
    sources: sortJsonRows(facts.sources),
    sourceGraph: facts.sourceGraph,
  }
}

function sortJsonRows<T>(rows: readonly T[] | undefined): T[] | undefined {
  return rows ? [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) : undefined
}
