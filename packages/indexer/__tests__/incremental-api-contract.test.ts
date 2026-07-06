import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectIndexSnapshot } from '@use-crux/core/project-index'
import { indexProject, indexProjectIncremental } from '..'
import { applyIndexPatch, emptyIndexPatchState, indexPatchFromSnapshot } from '../indexer/patches'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-incremental-api-contract-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('incremental indexing API contract', () => {
  it('keeps full indexing equivalent to incremental fallback from an empty previous snapshot', async () => {
    const root = await fixtureRoot()
    const file = join(root, 'src/writer.ts')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      file,
      `
        import { prompt } from '@use-crux/core'

        export const writer = prompt({
          id: 'writer',
          system: 'Write clearly.',
          prompt: 'Draft.',
        })
      `,
    )

    const incremental = await indexProjectIncremental({
      root,
      previousIndex: emptyPreviousIndex(root),
      files: [file],
      mode: 'ast',
    })
    const full = await indexProject({ root, resolutionMode: 'source-only' })
    const incrementalState = incremental.patches.reduce(
      (state, patch) => applyIndexPatch(state, patch),
      emptyIndexPatchState(),
    )
    const fullState = applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(full, 'ast', 'ok'))

    expect(incremental.report).toMatchObject({
      planKind: 'full-reindex-required',
      fallbackUsed: true,
    })
    expect(normalizedIndexState(incrementalState)).toEqual(normalizedIndexState(fullState))
  })
})

function emptyPreviousIndex(root: string): ProjectIndexSnapshot {
  return {
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
    sources: [],
  }
}

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
      sources: [...state.sources].sort((a, b) => a.file.localeCompare(b.file)),
    }),
  ) as unknown
}
