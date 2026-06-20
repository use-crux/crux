import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IndexPatchFacts } from '../indexer/patches'
import { createNativeSemanticBackend, createSemanticIndexService, createTypeScriptSemanticBackend } from '../indexer/semantic/service'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-native-configless-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('configless native semantic backend', () => {
  it('matches TypeScript semantic facts when the project has no tsconfig', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const helperFile = join(root, 'src/helper.ts')
    const file = join(root, 'src/writer.ts')
    await writeFile(helperFile, `export const writerSystem = 'Write clearly.'`)
    await writeFile(
      file,
      `
        import { prompt } from '@crux/core'
        import { writerSystem } from './helper'

        export const writer = prompt({
          id: 'writer',
          system: writerSystem,
        })
      `,
    )

    const typescriptPatch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({ root, files: [file, helperFile] })
    const nativePatch = await createSemanticIndexService({
      backend: createNativeSemanticBackend({ cache: 'disabled' }),
    }).indexFiles({ root, files: [file, helperFile] })

    expect(typescriptPatch.status).toBe('ok')
    expect(nativePatch.status).toBe('ok')
    expect(normalizedFacts(nativePatch.facts)).toEqual(normalizedFacts(typescriptPatch.facts))
  })
})

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
