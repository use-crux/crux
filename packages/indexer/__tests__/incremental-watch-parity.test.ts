import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IndexLintFinding, ProjectIndexSnapshot } from '@use-crux/core/project-index'
import { afterEach, describe, expect, it } from 'vitest'
import { indexProject, indexProjectIncremental } from '..'
import { canonicalIndexPatchFactsJson } from '../contracts/parity'
import { applyIndexPatch, emptyIndexPatchState, indexPatchFromSnapshot, type IndexPatch } from '../indexer/patches'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-incremental-watch-parity-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('incremental watch parity', () => {
  it('matches a full reindex after a watch-style source change', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const writer = join(root, 'src/writer.ts')
    await writeFile(writer, promptSource('writer', 'Write clearly.'))
    await writeFile(join(root, 'src/stable.ts'), promptSource('stable', 'Stay stable.'))

    const previousIndex = await indexProject({ root, resolutionMode: 'source-only' })
    await writeFile(writer, promptSource('writer.updated', 'Write with more edge.'))

    const incremental = await indexProjectIncremental({
      root,
      previousIndex,
      files: [writer],
      mode: 'ast',
    })
    const fullUpdatedIndex = await indexProject({ root, resolutionMode: 'source-only' })

    expect(incremental.report).toMatchObject({
      planKind: 'source-file-reindex',
      fallbackUsed: false,
      staticParsedFiles: [writer],
      invalidatedDefinitionIds: ['prompt:writer'],
    })
    expect(normalizedIndexState(previousIndex, incremental.patches)).toEqual(
      normalizedIndexState(fullUpdatedIndex),
    )
  })

  it('matches a full reindex when a watch event changes lint profile config', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const configFile = join(root, 'crux.config.ts')
    await writeLintConfig(configFile, 'warning')
    await writeFile(
      join(root, 'src/writer.ts'),
      [
        "import { prompt } from '@use-crux/core'",
        '',
        "export const writer = prompt({ id: 'writer.lint-profile' })",
      ].join('\n'),
    )

    const previousIndex = await indexProject({ root, resolutionMode: 'config-policy' })
    await writeLintConfig(configFile, 'error')

    const incremental = await indexProjectIncremental({
      root,
      previousIndex,
      files: [configFile],
      mode: 'ast',
      resolutionMode: 'config-policy',
    })
    const fullUpdatedIndex = await indexProject({ root, resolutionMode: 'config-policy' })

    expect(incremental.report).toMatchObject({
      planKind: 'full-reindex-required',
      fallbackUsed: true,
      fallbackReason: 'config-or-resolver-changed',
    })
    expect(findingSeverity(incremental.patches[0], 'prompt.missing_input_schema')).toBe('error')
    expect(canonicalIndexPatchFactsJson(incremental.patches[0].facts)).toEqual(
      canonicalIndexPatchFactsJson(indexPatchFromSnapshot(fullUpdatedIndex, 'ast', 'ok').facts),
    )
  })
})

/**
 * Builds a small prompt source that is easy to mutate in watch-style tests.
 *
 * The prompt intentionally omits an input schema so lint-profile changes have
 * an observable finding to compare without adding more fixture files.
 */
function promptSource(id: string, system: string): string {
  return [
    "import { prompt } from '@use-crux/core'",
    '',
    'export const writerPrompt = prompt({',
    `  id: '${id}',`,
    `  system: '${system}',`,
    "  prompt: 'Draft.',",
    '})',
  ].join('\n')
}

/** Writes the lint policy boundary file used by config-change watch tests. */
async function writeLintConfig(file: string, severity: IndexLintFinding['severity']): Promise<void> {
  await writeFile(
    file,
    [
      "import { config } from '@use-crux/core'",
      '',
      'export default config({',
      '  lint: {',
      '    rules: {',
      `      'prompt.missing_input_schema': { severity: '${severity}' },`,
      '    },',
      '  },',
      '})',
    ].join('\n'),
  )
}

/**
 * Applies incremental patches to a previous snapshot and returns a stable
 * comparable read model. With no patches it normalizes the snapshot itself.
 */
function normalizedIndexState(
  snapshot: ProjectIndexSnapshot,
  patches: readonly IndexPatch[] = [],
): ReturnType<typeof stableIndexState> {
  const initialState = applyIndexPatch(emptyIndexPatchState(), indexPatchFromSnapshot(snapshot, 'ast', 'ok'))
  return stableIndexState(patches.reduce((state, patch) => applyIndexPatch(state, patch), initialState))
}

/** Returns the deterministic subset of patch state used for parity assertions. */
function stableIndexState(state: ReturnType<typeof applyIndexPatch>) {
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
      sources: [...state.sources].map(stableSourceRow).sort((a, b) => a.file.localeCompare(b.file)),
    }),
  ) as {
    readonly [key: string]: unknown
  }
}

/** Normalizes optional empty source-row arrays out of comparison noise. */
function stableSourceRow(source: ReturnType<typeof applyIndexPatch>['sources'][number]) {
  return {
    file: source.file,
    status: source.status,
    ...(source.shardId ? { shardId: source.shardId } : {}),
    ...(source.definitionIds && source.definitionIds.length > 0 ? { definitionIds: source.definitionIds } : {}),
    ...(source.dependencies && source.dependencies.length > 0 ? { dependencies: source.dependencies } : {}),
    ...(source.dependents && source.dependents.length > 0 ? { dependents: source.dependents } : {}),
    ...(source.diagnostics && source.diagnostics.length > 0 ? { diagnostics: source.diagnostics } : {}),
  }
}

/** Finds the selected lint finding severity in one emitted patch. */
function findingSeverity(patch: IndexPatch | undefined, ruleId: string): IndexLintFinding['severity'] | undefined {
  return patch?.facts.lintFindings?.find((finding) => finding.ruleId === ruleId)?.severity
}
