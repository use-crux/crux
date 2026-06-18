import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectIndexSnapshot } from '@crux/core/project-index'
import { indexProjectAst, indexProjectSemantic } from '../index'
import { applyIndexPatch, emptyIndexPatchState } from '../indexer/patches'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-semantic-preflight-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('semantic preflight budgets', () => {
  it('degrades before semantic enrichment when selected source bytes exceed budget', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/large.ts'),
      `
        import { prompt } from '@crux/core'

        const padding = '${'x'.repeat(128)}'

        export const writer = prompt({
          id: 'writer',
          prompt: padding,
        })
      `,
    )

    const semanticPatch = await indexProjectSemantic({
      root,
      projectName: 'semantic-preflight',
      semanticBudget: { maxSourceBytes: 1 },
    })

    expect(semanticPatch.status).toBe('degraded')
    expect(semanticPatch.facts.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'index.semantic_budget_exceeded',
        message: expect.stringContaining('sourceBytes'),
      }),
    )

    const astPatch = await indexProjectAst({ root, projectName: 'semantic-preflight' })
    const state = applyIndexPatch(applyIndexPatch(emptyIndexPatchState(), astPatch), semanticPatch)

    expect(state.definitions.map((definition) => definition.id)).toEqual(
      astPatch.facts.definitions?.map((definition) => definition.id),
    )
  })

  it('degrades before semantic enrichment when previous sources over-expand selection', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/current.ts'),
      `
        import { prompt } from '@crux/core'
        export const current = prompt({ id: 'current' })
      `,
    )

    const previousIndex: ProjectIndexSnapshot = {
      schemaVersion: 1,
      project: { root },
      indexedAt: new Date(0).toISOString(),
      prompts: [],
      contexts: [],
      definitions: [],
      relations: [],
      diagnostics: [],
      lintFindings: [],
      ruleDescriptors: [],
      sources: [{ file: join(root, 'src/previous.ts'), status: 'indexed' }],
    }

    const semanticPatch = await indexProjectSemantic({
      root,
      previousIndex,
      projectName: 'semantic-preflight',
      semanticBudget: { maxPreviousSourceExpansion: 0 },
    })

    expect(semanticPatch.status).toBe('degraded')
    expect(semanticPatch.facts.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'index.semantic_budget_exceeded',
        message: expect.stringContaining('previousSourceExpansion'),
      }),
    )
  })

  it('degrades before semantic enrichment when dependency closure exceeds budget', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/schema.ts'),
      `
        import { z } from 'zod'
        export const WriterInput = z.object({ topic: z.string() })
      `,
    )
    await writeFile(
      join(root, 'src/writer.ts'),
      `
        import { prompt } from '@crux/core'
        import { WriterInput } from './schema'

        export const writer = prompt({
          id: 'writer',
          input: WriterInput,
        })
      `,
    )

    const semanticPatch = await indexProjectSemantic({
      root,
      projectName: 'semantic-preflight',
      semanticBudget: { maxDependencyClosureFiles: 1 },
    })

    expect(semanticPatch.status).toBe('degraded')
    expect(semanticPatch.facts.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'index.semantic_budget_exceeded',
        message: expect.stringContaining('dependencyClosureFiles'),
      }),
    )
  })
})
