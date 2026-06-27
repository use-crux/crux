import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { indexProjectSemantic } from '..'
import type { IndexPatchFacts } from '../indexer/patches'
import { createNativeSemanticBackend, createSemanticIndexService, createTypeScriptSemanticBackend } from '../indexer/semantic/service'
import {
  semanticBackendParityFixtures,
  type SemanticBackendParityFixture,
} from './semantic-backend-parity-fixtures'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-backend-parity-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('semantic backend parity', () => {
  for (const fixture of semanticBackendParityFixtures) {
    it(`matches TypeScript semantic facts without cache for ${fixture.name}`, async () => {
      const { root, files } = await writeFixture(fixture)
      const typescriptPatch = await createSemanticIndexService({
        backend: createTypeScriptSemanticBackend({ cache: 'disabled' }),
      }).indexFiles({ root, files })
      const nativePatch = await createSemanticIndexService({
        backend: createNativeSemanticBackend({ cache: 'disabled' }),
      }).indexFiles({ root, files })

      expect(typescriptPatch.status).toBe('ok')
      expect(nativePatch.status).toBe('ok')
      assertFixtureCoverage(fixture, typescriptPatch.facts)
      expect(normalizedFacts(nativePatch.facts)).toEqual(normalizedFacts(typescriptPatch.facts))
    }, 20_000)

    it(`matches TypeScript semantic facts through public cached indexing for ${fixture.name}`, async () => {
      const { root } = await writeFixture(fixture)
      const typescriptPatch = await indexProjectSemantic({ root, semanticBackend: 'typescript' })
      const nativePatch = await indexProjectSemantic({ root, semanticBackend: { name: 'native' } })
      const cachedTypescriptPatch = await indexProjectSemantic({ root, semanticBackend: 'typescript' })
      const cachedNativePatch = await indexProjectSemantic({
        root,
        semanticBackend: { name: 'native' },
      })

      expect(typescriptPatch.status).toBe('ok')
      expect(nativePatch.status).toBe('ok')
      expect(cachedTypescriptPatch.status).toBe('ok')
      expect(cachedNativePatch.status).toBe('ok')
      assertFixtureCoverage(fixture, typescriptPatch.facts)
      expect(normalizedFacts(nativePatch.facts)).toEqual(normalizedFacts(typescriptPatch.facts))
      expect(normalizedFacts(cachedTypescriptPatch.facts)).toEqual(normalizedFacts(typescriptPatch.facts))
      expect(normalizedFacts(cachedNativePatch.facts)).toEqual(normalizedFacts(typescriptPatch.facts))
    }, 30_000)
  }
})

async function writeFixture(
  fixture: SemanticBackendParityFixture,
): Promise<{ readonly root: string; readonly files: readonly string[] }> {
  const root = await fixtureRoot()
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

  const files = Object.keys(fixture.files).map((path) => join(root, path))
  for (const [path, source] of Object.entries(fixture.files)) {
    const file = join(root, path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, source)
  }
  return { root, files }
}

function assertFixtureCoverage(fixture: SemanticBackendParityFixture, facts: IndexPatchFacts): void {
  const coverage = semanticFactCoverage(facts)
  expect(coverage.definitionIds).toEqual(expect.arrayContaining([...(fixture.expect.definitionIds ?? [])]))
  expect(coverage.relationTypes).toEqual(expect.arrayContaining([...(fixture.expect.relationTypes ?? [])]))
  expect(coverage.sourceRefRoles).toEqual(expect.arrayContaining([...(fixture.expect.sourceRefRoles ?? [])]))
  expect(coverage.lintRuleIds).toEqual(expect.arrayContaining([...(fixture.expect.lintRuleIds ?? [])]))
}

function semanticFactCoverage(facts: IndexPatchFacts): {
  readonly definitionIds: readonly string[]
  readonly relationTypes: readonly string[]
  readonly sourceRefRoles: readonly string[]
  readonly lintRuleIds: readonly string[]
} {
  return {
    definitionIds: [...new Set((facts.definitions ?? []).map((definition) => definition.id))].sort(),
    relationTypes: [...new Set((facts.relations ?? []).map((relation) => relation.type))].sort(),
    sourceRefRoles: [...new Set((facts.sourceRefs ?? []).map((ref) => ref.ref.role))].sort(),
    lintRuleIds: [...new Set((facts.lintFindings ?? []).map((finding) => finding.ruleId))].sort(),
  }
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
