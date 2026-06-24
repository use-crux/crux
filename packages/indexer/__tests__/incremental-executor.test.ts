import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { indexProject, indexProjectIncremental, indexProjectSemantic } from '..'
import { applyIndexPatch, indexPatchFromSnapshot, emptyIndexPatchState } from '../indexer/patches'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-incremental-executor-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('incremental indexing executor', () => {
  it('applies a partial AST patch that matches a full source-only reindex for a leaf source change', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/writer.ts'),
      `
        import { prompt } from '@crux/core'

        export const writer = prompt({
          id: 'writer',
          system: 'Write clearly.',
          prompt: 'Draft.',
        })
      `,
    )
    await writeFile(
      join(root, 'src/stable.ts'),
      `
        import { prompt } from '@crux/core'

        export const stable = prompt({
          id: 'stable',
          system: 'Stay stable.',
          prompt: 'Draft.',
        })
      `,
    )

    const previousIndex = await indexProject({ root, resolutionMode: 'source-only' })
    await writeFile(
      join(root, 'src/writer.ts'),
      `
        import { prompt } from '@crux/core'

        export const writer = prompt({
          id: 'writer.updated',
          system: 'Write with more edge.',
          prompt: 'Draft.',
        })
      `,
    )

    const incremental = await indexProjectIncremental({
      root,
      previousIndex,
      files: [join(root, 'src/writer.ts')],
      mode: 'ast',
    })

    const patchedState = applyIndexPatch(
      applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(previousIndex, 'ast', 'ok')),
      incremental.patches[0],
    )
    const fullUpdatedIndex = await indexProject({ root, resolutionMode: 'source-only' })
    const fullUpdatedState = applyIndexPatch(
      emptyIndexPatchState(),
      indexPatchFromSnapshot(fullUpdatedIndex, 'ast', 'ok'),
    )

    expect(incremental.decision.kind).toBe('source-file-reindex')
    expect(incremental.report).toMatchObject({
      planKind: 'source-file-reindex',
      fallbackUsed: false,
      staticParsedFiles: [join(root, 'src/writer.ts')],
      invalidatedFiles: [join(root, 'src/writer.ts')],
      invalidatedDefinitionIds: ['prompt:writer'],
    })
    expect(normalizedIndexState(patchedState)).toEqual(normalizedIndexState(fullUpdatedState))
  })

  it('applies a partial AST patch for a reverse dependency closure', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/prompt.ts'),
      `
        import { prompt } from '@crux/core'

        export const writerPrompt = prompt({
          id: 'writer',
          system: 'Write clearly.',
          prompt: 'Draft.',
        })
      `,
    )
    await writeFile(
      join(root, 'src/agent.ts'),
      `
        import { agent } from '@crux/core'
        import { writerPrompt } from './prompt'

        export const writerAgent = agent({
          id: 'writer-agent',
          instructions: 'Use the writer prompt.',
          prompts: [writerPrompt],
        })
      `,
    )

    const previousIndex = await indexProject({ root, resolutionMode: 'source-only' })
    await writeFile(
      join(root, 'src/prompt.ts'),
      `
        import { prompt } from '@crux/core'

        export const writerPrompt = prompt({
          id: 'writer.v2',
          system: 'Write with a sharper brief.',
          prompt: 'Draft.',
        })
      `,
    )

    const incremental = await indexProjectIncremental({
      root,
      previousIndex,
      files: [join(root, 'src/prompt.ts')],
      mode: 'ast',
    })

    const patchedState = applyIndexPatch(
      applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(previousIndex, 'ast', 'ok')),
      incremental.patches[0],
    )
    const fullUpdatedIndex = await indexProject({ root, resolutionMode: 'source-only' })
    const fullUpdatedState = applyIndexPatch(
      emptyIndexPatchState(),
      indexPatchFromSnapshot(fullUpdatedIndex, 'ast', 'ok'),
    )

    if (incremental.decision.kind !== 'dependency-closure-reindex') {
      throw new Error(JSON.stringify(incremental.decision, null, 2))
    }
    expect(incremental.report.staticParsedFiles).toEqual([join(root, 'src/agent.ts'), join(root, 'src/prompt.ts')])
    expect(normalizedIndexState(patchedState)).toEqual(normalizedIndexState(fullUpdatedState))
  })

  it('applies an invalidation-only AST patch for a safe deleted leaf source', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/delete-me.ts'),
      `
        import { prompt } from '@crux/core'

        export const temporary = prompt({
          id: 'temporary',
          system: 'Temporary.',
          prompt: 'Draft.',
        })
      `,
    )
    await writeFile(
      join(root, 'src/stable.ts'),
      `
        import { prompt } from '@crux/core'

        export const stable = prompt({
          id: 'stable',
          system: 'Stay stable.',
          prompt: 'Draft.',
        })
      `,
    )

    const previousIndex = await indexProject({ root, resolutionMode: 'source-only' })
    await unlink(join(root, 'src/delete-me.ts'))

    const incremental = await indexProjectIncremental({
      root,
      previousIndex,
      files: [],
      deletedFiles: [join(root, 'src/delete-me.ts')],
      mode: 'ast',
    })

    const patchedState = applyIndexPatch(
      applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(previousIndex, 'ast', 'ok')),
      incremental.patches[0],
    )
    const fullUpdatedIndex = await indexProject({ root, resolutionMode: 'source-only' })
    const fullUpdatedState = applyIndexPatch(
      emptyIndexPatchState(),
      indexPatchFromSnapshot(fullUpdatedIndex, 'ast', 'ok'),
    )

    expect(incremental.decision.kind).toBe('source-file-reindex')
    expect(incremental.report.staticParsedFiles).toEqual([])
    expect(incremental.report.invalidatedDefinitionIds).toEqual(['prompt:temporary'])
    expect(normalizedIndexState(patchedState)).toEqual(normalizedIndexState(fullUpdatedState))
  })

  it('applies partial AST and semantic patches that match full reindex for a TypeScript analyzer source change', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/schema.ts'),
      `
        import { z } from 'zod'

        export const WriterInput = z.object({
          topic: z.string().describe('Topic to write about'),
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

    const previousIndex = await indexProject({ root, resolutionMode: 'source-only' })
    const previousSemanticPatch = await indexProjectSemantic({ root })
    await writeFile(
      join(root, 'src/tool.ts'),
      `
        import { tool } from '@crux/core'
        import { input } from './index'

        export const writerTool = tool({
          name: 'writer',
          description: 'Write a sharper draft',
          parameters: input,
          execute: async () => 'ok',
        })
      `,
    )

    const incremental = await indexProjectIncremental({
      root,
      previousIndex,
      files: [join(root, 'src/tool.ts')],
      mode: 'ast-and-semantic',
    })

    const patchedState = incremental.patches.reduce(
      (state, patch) => applyIndexPatch(state, patch),
      applyIndexPatch(
        applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(previousIndex, 'ast', 'ok')),
        previousSemanticPatch,
      ),
    )
    const fullUpdatedIndex = await indexProject({ root, resolutionMode: 'source-only' })
    const fullUpdatedSemanticPatch = await indexProjectSemantic({ root, previousIndex: fullUpdatedIndex })
    const fullUpdatedState = applyIndexPatch(
      applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(fullUpdatedIndex, 'ast', 'ok')),
      fullUpdatedSemanticPatch,
    )

    expect(incremental.decision.kind).toBe('source-file-reindex')
    expect(incremental.report.semanticAnalyzedFiles).toEqual([join(root, 'src/tool.ts')])
    expect(normalizedIndexState(patchedState)).toEqual(normalizedIndexState(fullUpdatedState))
  }, 15000)

  it('uses semantic source-ref support rows to partially reindex a schema support file', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/schema.ts'),
      `
        import { z } from 'zod'

        export const WriterInput = z.object({
          topic: z.string().describe('Topic to write about'),
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

    const astIndex = await indexProject({ root, resolutionMode: 'source-only' })
    const enriched = await indexProjectIncremental({
      root,
      previousIndex: astIndex,
      files: [join(root, 'src/tool.ts')],
      mode: 'ast-and-semantic',
    })
    const enrichedIndex = projectIndexFromState(
      enriched.patches.reduce(
        (state, patch) => applyIndexPatch(state, patch),
        applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(astIndex, 'ast', 'ok')),
      ),
      astIndex,
    )

    expect(enrichedIndex.sources).toContainEqual(
      expect.objectContaining({
        file: join(root, 'src/schema.ts'),
        dependents: expect.arrayContaining([join(root, 'src/tool.ts')]),
      }),
    )

    await writeFile(
      join(root, 'src/schema.ts'),
      `
        import { z } from 'zod'

        export const WriterInput = z.object({
          topic: z.string().describe('Topic to write about'),
          tone: z.enum(['plain', 'bold']).describe('Tone'),
        })
      `,
    )

    const incremental = await indexProjectIncremental({
      root,
      previousIndex: enrichedIndex,
      files: [join(root, 'src/schema.ts')],
      mode: 'ast-and-semantic',
    })
    const patchedState = incremental.patches.reduce(
      (state, patch) => applyIndexPatch(state, patch),
      applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(enrichedIndex, 'ast', 'ok')),
    )
    const fullUpdatedIndex = await indexProject({ root, resolutionMode: 'source-only' })
    const fullUpdatedSemanticPatch = await indexProjectSemantic({ root, previousIndex: enrichedIndex })
    const fullUpdatedState = applyIndexPatch(
      applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(fullUpdatedIndex, 'ast', 'ok')),
      fullUpdatedSemanticPatch,
    )

    expect(incremental.decision.kind).toBe('dependency-closure-reindex')
    expect(incremental.report.semanticAnalyzedFiles).toEqual([join(root, 'src/schema.ts'), join(root, 'src/tool.ts')])
    expect(normalizedIndexState(patchedState)).toEqual(normalizedIndexState(fullUpdatedState))
  }, 15000)

  it('reports conservative full fallback reasons during execution', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/tool.ts'),
      `
        import { tool } from '@crux/core'

        export const writerTool = tool({
          name: 'writer',
          description: 'Write a draft',
          execute: async () => 'ok',
        })
      `,
    )

    const previousIndex = await indexProject({ root, resolutionMode: 'source-only' })
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }))

    const incremental = await indexProjectIncremental({
      root,
      previousIndex,
      files: [join(root, 'tsconfig.json')],
      mode: 'ast-and-semantic',
    })

    expect(incremental.decision).toMatchObject({
      kind: 'full-reindex-required',
      reason: 'config-or-resolver-changed',
    })
    expect(incremental.patches.map((patch) => patch.phase)).toEqual(['ast', 'semantic'])
    expect(incremental.report).toMatchObject({
      planKind: 'full-reindex-required',
      fallbackUsed: true,
      fallbackReason: 'config-or-resolver-changed',
      invalidatedFiles: [],
      invalidatedDefinitionIds: [],
    })
  }, 15_000)
})

function normalizedIndexState(state: ReturnType<typeof applyIndexPatch>): unknown {
  return JSON.parse(
    JSON.stringify({
      project: state.project,
      prompts: state.prompts,
      contexts: state.contexts,
      tools: state.tools,
      lint: state.lint,
      sourceGraph: state.sourceGraph,
      definitions: [...state.definitions].sort((a, b) => a.id.localeCompare(b.id)),
      relations: [...state.relations].sort((a, b) => a.id.localeCompare(b.id)),
      diagnostics: state.diagnostics,
      lintFindings: [...state.lintFindings].sort((a, b) => a.id.localeCompare(b.id)),
      sources: [...state.sources].map(normalizedSourceRow).sort((a, b) => a.file.localeCompare(b.file)),
    }),
  ) as unknown
}

function normalizedSourceRow(
  source: ReturnType<typeof applyIndexPatch>['sources'][number],
): ReturnType<typeof applyIndexPatch>['sources'][number] {
  return {
    file: source.file,
    status: source.status,
    ...(source.definitionIds && source.definitionIds.length > 0 ? { definitionIds: source.definitionIds } : {}),
    ...(source.dependencies && source.dependencies.length > 0 ? { dependencies: source.dependencies } : {}),
    ...(source.dependents && source.dependents.length > 0 ? { dependents: source.dependents } : {}),
    ...(source.diagnostics && source.diagnostics.length > 0 ? { diagnostics: source.diagnostics } : {}),
  }
}

function projectIndexFromState(
  state: ReturnType<typeof applyIndexPatch>,
  base: Awaited<ReturnType<typeof indexProject>>,
): Awaited<ReturnType<typeof indexProject>> {
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
