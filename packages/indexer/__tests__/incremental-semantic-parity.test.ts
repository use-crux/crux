import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { indexProject, indexProjectIncremental } from '..'
import type { IndexPatchFacts } from '../indexer/patches'
import { applyIndexPatch, emptyIndexPatchState, indexPatchFromSnapshot } from '../indexer/patches'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-incremental-semantic-parity-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('incremental semantic backend parity', () => {
  it('matches TypeScript facts for native partial semantic runs over a schema support closure', async () => {
    const root = await fixtureRoot()
    await writeFixture(root, 'first')

    const astIndex = await indexProject({ root, resolutionMode: 'source-only' })
    const enriched = await indexProjectIncremental({
      root,
      previousIndex: astIndex,
      files: [join(root, 'src/tool.ts')],
      mode: 'ast-and-semantic',
      semanticBackend: 'typescript',
    })
    const enrichedIndex = projectIndexFromPatches(astIndex, enriched.patches)

    await writeFixture(root, 'second')

    const typescript = await indexProjectIncremental({
      root,
      previousIndex: enrichedIndex,
      files: [join(root, 'src/schema.ts')],
      mode: 'ast-and-semantic',
      semanticBackend: 'typescript',
    })
    const nativeCoverageKinds: string[] = []
    const native = await indexProjectIncremental({
      root,
      previousIndex: enrichedIndex,
      files: [join(root, 'src/schema.ts')],
      mode: 'ast-and-semantic',
      semanticBackend: { name: 'native' },
      semanticInstrumentation: {
        onNativeCoverage: (coverage) => nativeCoverageKinds.push(coverage.kind),
      },
    })

    expect(typescript.decision.kind).toBe('dependency-closure-reindex')
    expect(native.decision.kind).toBe('dependency-closure-reindex')
    expect(typescript.report.semanticStatus).toBe('ready')
    expect(native.report.semanticStatus).toBe('ready')
    expect(nativeCoverageKinds.length).toBeGreaterThan(0)
    expect(normalizedFacts(semanticFacts(native))).toEqual(normalizedFacts(semanticFacts(typescript)))
  }, 30_000)
})

async function writeFixture(root: string, revision: 'first' | 'second'): Promise<void> {
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
  await writeFile(
    join(root, 'src/schema.ts'),
    `
      import { z } from 'zod'

      export const WriterInput = z.object({
        topic: z.string().describe('Topic to write about'),
        ${revision === 'second' ? "tone: z.enum(['plain', 'bold']).describe('Tone')," : ''}
      })
    `,
  )
  await writeFile(join(root, 'src/index.ts'), `export { WriterInput as input } from './schema'`)
  await writeFile(
    join(root, 'src/tool.ts'),
    `
      import { tool } from '@crux/core'
      import { input } from './index'

      export const writerTool = tool({
        name: 'writer',
        description: 'Write a draft',
        parameters: input,
        execute: async () => 'ok',
      })
    `,
  )
}

function projectIndexFromPatches(
  base: Awaited<ReturnType<typeof indexProject>>,
  patches: Awaited<ReturnType<typeof indexProjectIncremental>>['patches'],
): Awaited<ReturnType<typeof indexProject>> {
  const state = patches.reduce(
    (current, patch) => applyIndexPatch(current, patch),
    applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(base, 'ast', 'ok')),
  )
  return {
    ...base,
    project: state.project ?? base.project,
    prompts: [...state.prompts],
    contexts: [...state.contexts],
    tools: [...state.tools],
    lint: state.lint,
    sourceGraph: state.sourceGraph,
    definitions: [...state.definitions],
    relations: [...state.relations],
    diagnostics: [...state.diagnostics],
    lintFindings: [...state.lintFindings],
    sources: [...state.sources],
  }
}

function semanticFacts(result: Awaited<ReturnType<typeof indexProjectIncremental>>): IndexPatchFacts {
  const patch = result.patches.find((candidate) => candidate.phase === 'semantic')
  if (!patch) throw new Error('incremental result missing semantic patch')
  return patch.facts
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
