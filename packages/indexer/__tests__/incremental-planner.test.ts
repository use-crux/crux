import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IndexSourceFile, ProjectIndexSnapshot, ProjectDefinition } from '@crux/core/project-index'
import { afterEach, describe, expect, it } from 'vitest'
import { indexProject } from '../index'
import {
  indexInvalidationFromDecision,
  explainIncrementalDecision,
  planIndexFiles,
  planIndexFilesDryRun,
} from '../indexer/incremental'
import { indexBoundaryFileNames, indexCacheBoundaryFileNames } from '../indexer/incremental/boundaries'
import { normalizedIndexStateFromSnapshot } from './helpers/index-equivalence'

const root = '/project'
const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const fixture = await mkdtemp(join(process.cwd(), '.tmp-incremental-planner-'))
  roots.push(fixture)
  return fixture
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((fixture) => rm(fixture, { recursive: true, force: true })))
})

describe('incremental index planner', () => {
  it('preserves full reindex fallback when the previous graph is missing', () => {
    const decision = planIndexFiles({
      root,
      files: ['src/b.ts', 'src/a.ts', 'src/a.ts'],
    })

    expect(decision).toMatchObject({
      kind: 'full-reindex-required',
      reason: 'missing-previous-index',
      root,
      files: [join(root, 'src/a.ts'), join(root, 'src/b.ts')],
      changedFiles: [join(root, 'src/a.ts'), join(root, 'src/b.ts')],
      graphConfidence: 'missing-previous-index',
      previousIndexDefinitionCount: 0,
    })
    expect(decision.explanation.fallbackUsed).toBe(true)
  })

  it('falls back when source rows have not materialized dependency edges', () => {
    const decision = planIndexFiles({
      root,
      previousIndex: index({
        sources: [{ file: join(root, 'src/a.ts'), status: 'indexed' }],
      }),
      files: ['src/a.ts'],
    })

    expect(decision).toMatchObject({
      kind: 'full-reindex-required',
      reason: 'dependency-graph-not-materialized',
      graphConfidence: 'missing-dependent-edges',
    })
  })

  it('falls back for old snapshots without trusted source graph evidence', () => {
    const file = join(root, 'src/prompt.ts')
    const decision = planIndexFiles({
      root,
      previousIndex: index({
        trustedSourceGraph: false,
        sources: [{ file, status: 'indexed', dependencies: [], dependents: [] }],
      }),
      files: ['src/prompt.ts'],
    })

    expect(decision).toMatchObject({
      kind: 'full-reindex-required',
      reason: 'source-graph-marker-missing',
      graphConfidence: 'source-graph-marker-missing',
    })
  })

  it('plans a known leaf source as a source-file reindex', () => {
    const file = join(root, 'src/prompt.ts')
    const decision = planIndexFiles({
      root,
      previousIndex: index({
        definitions: [definition('prompt:writer', file)],
        sources: [
          {
            file,
            status: 'indexed',
            definitionIds: ['prompt:writer'],
            dependencies: [],
            dependents: [],
          },
        ],
      }),
      files: ['src/prompt.ts'],
    })

    expect(decision).toMatchObject({
      kind: 'source-file-reindex',
      changedFiles: [file],
      affectedFiles: [file],
      affectedDefinitionIds: ['prompt:writer'],
      graphConfidence: 'complete-enough-for-source-closure',
    })
    expect(decision.explanation.fallbackUsed).toBe(false)
  })

  it('walks reverse dependents transitively and deterministically', () => {
    const entry = join(root, 'src/index.ts')
    const agent = join(root, 'src/agent.ts')
    const prompt = join(root, 'src/prompt.ts')

    const decision = planIndexFiles({
      root,
      previousIndex: index({
        definitions: [definition('prompt:writer', prompt), definition('agent:writer', agent)],
        sources: [
          {
            file: entry,
            status: 'indexed',
            dependencies: [agent],
            dependents: [],
          },
          {
            file: agent,
            status: 'indexed',
            definitionIds: ['agent:writer'],
            dependencies: [prompt],
            dependents: [entry],
          },
          {
            file: prompt,
            status: 'indexed',
            definitionIds: ['prompt:writer'],
            dependencies: [],
            dependents: [agent],
          },
        ],
      }),
      files: ['src/prompt.ts'],
    })

    expect(decision).toMatchObject({
      kind: 'dependency-closure-reindex',
      changedFiles: [prompt],
      affectedFiles: [agent, entry, prompt],
      affectedDefinitionIds: ['agent:writer', 'prompt:writer'],
    })
  })

  it('handles dependent cycles without repeated files', () => {
    const a = join(root, 'src/a.ts')
    const b = join(root, 'src/b.ts')
    const decision = planIndexFiles({
      root,
      previousIndex: index({
        sources: [
          { file: a, status: 'indexed', definitionIds: ['prompt:a'], dependencies: [b], dependents: [b] },
          { file: b, status: 'indexed', definitionIds: ['prompt:b'], dependencies: [a], dependents: [a] },
        ],
      }),
      files: ['src/a.ts'],
    })

    expect(decision).toMatchObject({
      kind: 'dependency-closure-reindex',
      affectedFiles: [a, b],
      affectedDefinitionIds: ['prompt:a', 'prompt:b'],
    })
  })

  it('falls back for config and resolver boundary changes', () => {
    const source = join(root, 'src/prompt.ts')
    const decision = planIndexFiles({
      root,
      previousIndex: index({
        sources: [{ file: source, status: 'indexed', dependencies: [], dependents: [] }],
      }),
      files: ['tsconfig.json'],
    })

    expect(decision).toMatchObject({
      kind: 'full-reindex-required',
      reason: 'config-or-resolver-changed',
      graphConfidence: 'config-or-resolver-changed',
    })
  })

  it('falls back for unknown changed files', () => {
    const source = join(root, 'src/prompt.ts')
    const decision = planIndexFiles({
      root,
      previousIndex: index({
        sources: [{ file: source, status: 'indexed', dependencies: [], dependents: [] }],
      }),
      files: ['src/unknown.ts'],
    })

    expect(decision).toMatchObject({
      kind: 'full-reindex-required',
      reason: 'unknown-file',
      graphConfidence: 'unknown-file',
    })
  })

  it('falls back when the affected closure exceeds budget', () => {
    const a = join(root, 'src/a.ts')
    const b = join(root, 'src/b.ts')
    const decision = planIndexFiles({
      root,
      previousIndex: index({
        sources: [
          { file: a, status: 'indexed', dependencies: [], dependents: [b] },
          { file: b, status: 'indexed', dependencies: [a], dependents: [] },
        ],
      }),
      files: ['src/a.ts'],
      maxAffectedFiles: 1,
    })

    expect(decision).toMatchObject({
      kind: 'full-reindex-required',
      reason: 'closure-budget-exceeded',
      graphConfidence: 'closure-budget-exceeded',
    })
  })

  it('falls back when unresolved import diagnostics are present in the affected component', () => {
    const entry = join(root, 'src/index.ts')
    const prompt = join(root, 'src/prompt.ts')
    const decision = planIndexFiles({
      root,
      previousIndex: index({
        sources: [
          { file: entry, status: 'indexed', dependencies: [prompt], dependents: [] },
          {
            file: prompt,
            status: 'partial',
            definitionIds: ['prompt:writer'],
            dependencies: [],
            dependents: [entry],
            diagnostics: ['index.rich_import_failed:prompt'],
          },
        ],
        diagnostics: [
          {
            id: 'index.rich_import_failed:prompt',
            code: 'index.rich_import_failed',
            severity: 'warning',
            message: 'Import could not be resolved.',
            source: { file: prompt, line: 1 },
          },
        ],
      }),
      files: ['src/prompt.ts'],
    })

    expect(decision).toMatchObject({
      kind: 'full-reindex-required',
      reason: 'unresolved-imports-present',
      graphConfidence: 'unresolved-imports-present',
      explanation: {
        graphAvailable: true,
        fallbackUsed: true,
      },
    })
  })

  it('plans exact invalidation for known deleted leaf files', () => {
    const file = join(root, 'src/prompt.ts')
    const decision = planIndexFiles({
      root,
      previousIndex: index({
        sources: [
          {
            file,
            status: 'indexed',
            definitionIds: ['prompt:writer'],
            dependencies: [],
            dependents: [],
          },
        ],
      }),
      files: [],
      deletedFiles: ['src/prompt.ts'],
    })

    expect(decision).toMatchObject({
      kind: 'source-file-reindex',
      changedFiles: [file],
      deletedFiles: [file],
      affectedFiles: [file],
      affectedDefinitionIds: ['prompt:writer'],
    })
  })

  it('falls back for deleted files with graph edges', () => {
    const file = join(root, 'src/prompt.ts')
    const dependent = join(root, 'src/agent.ts')
    const decision = planIndexFiles({
      root,
      previousIndex: index({
        sources: [
          { file, status: 'indexed', definitionIds: ['prompt:writer'], dependencies: [], dependents: [dependent] },
          { file: dependent, status: 'indexed', dependencies: [file], dependents: [] },
        ],
      }),
      files: [],
      deletedFiles: ['src/prompt.ts'],
    })

    expect(decision).toMatchObject({
      kind: 'full-reindex-required',
      reason: 'deleted-file-unsafe',
      graphConfidence: 'deleted-file-unsafe',
    })
  })

  it('converts planner decisions into index invalidations', () => {
    const file = join(root, 'src/prompt.ts')
    const partial = planIndexFiles({
      root,
      previousIndex: index({
        sources: [{ file, status: 'indexed', definitionIds: ['prompt:writer'], dependencies: [], dependents: [] }],
      }),
      files: ['src/prompt.ts'],
    })
    const full = planIndexFiles({
      root,
      files: ['src/prompt.ts'],
    })

    expect(indexInvalidationFromDecision(partial)).toEqual({
      files: [file],
      definitionIds: ['prompt:writer'],
    })
    expect(indexInvalidationFromDecision(full)).toEqual({ all: true })
  })

  it('returns JSON-safe dry-run decisions without executing indexing', () => {
    const file = join(root, 'src/prompt.ts')
    const decision = planIndexFilesDryRun({
      root,
      previousIndex: index({
        sources: [{ file, status: 'indexed', definitionIds: ['prompt:writer'], dependencies: [], dependents: [] }],
      }),
      files: ['src/prompt.ts'],
    })

    expect(decision).toEqual(JSON.parse(JSON.stringify(decision)))
    expect(decision.kind).toBe('source-file-reindex')
  })

  it('keeps planner and cache boundary constants aligned for compiler config files', () => {
    expect(indexBoundaryFileNames).toEqual(expect.arrayContaining([...indexCacheBoundaryFileNames]))
  })

  it('provides a normalized patch equivalence harness for future partial execution tests', () => {
    const file = join(root, 'src/prompt.ts')
    const snapshot = index({
      definitions: [definition('prompt:writer', file)],
      sources: [{ file, status: 'indexed', definitionIds: ['prompt:writer'], dependencies: [], dependents: [] }],
    })

    expect(normalizedIndexStateFromSnapshot(snapshot)).toEqual(normalizedIndexStateFromSnapshot(snapshot))
  })

  it('plans from source graph rows produced by real static indexing', async () => {
    const fixture = await fixtureRoot()
    await mkdir(join(fixture, 'src'), { recursive: true })
    await writeFile(
      join(fixture, 'src/prompt.ts'),
      `
        import { prompt } from '@crux/core'
        export const writer = prompt({ id: 'writer', prompt: 'Write' })
      `,
    )
    await writeFile(
      join(fixture, 'src/index.ts'),
      `
        import { createPrompts } from '@crux/core'
        import { writer } from './prompt'
        export const prompts = createPrompts({ writer })
      `,
    )

    const snapshot = await indexProject({ root: fixture, staticOnly: true })
    const decision = planIndexFiles({
      root: fixture,
      previousIndex: snapshot,
      files: ['src/prompt.ts'],
    })

    expect(snapshot.sourceGraph).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        producedBy: '@crux/indexer',
        capabilities: expect.arrayContaining(['source-dependencies', 'source-dependents']),
      }),
    )
    expect(decision).toMatchObject({
      kind: 'dependency-closure-reindex',
      affectedFiles: [join(fixture, 'src/index.ts'), join(fixture, 'src/prompt.ts')],
      affectedDefinitionIds: ['prompt:writer'],
    })
  })

  it('explains every emitted decision kind', () => {
    const file = join(root, 'src/prompt.ts')
    const decision = planIndexFiles({
      root,
      previousIndex: index({
        sources: [{ file, status: 'indexed', dependencies: [], dependents: [] }],
      }),
      files: ['src/prompt.ts'],
    })

    expect(explainIncrementalDecision(decision)).toContain('Affected files: 1')
  })

  it('explains semantic closure vocabulary without implying execution', () => {
    const file = join(root, 'src/prompt.ts')

    expect(
      explainIncrementalDecision({
        kind: 'semantic-closure-reindex',
        root,
        changedFiles: [file],
        deletedFiles: [],
        affectedFiles: [file],
        affectedDefinitionIds: ['prompt:writer'],
        graphConfidence: 'complete-enough-for-source-closure',
        explanation: {
          summary: 'Semantic source refs may affect index facts.',
          graphAvailable: true,
          fallbackUsed: false,
          traversedFiles: [file],
        },
      }),
    ).toContain('Semantic partial execution is not implied')
  })
})

function index(input: {
  readonly definitions?: readonly ProjectDefinition[]
  readonly diagnostics?: ProjectIndexSnapshot['diagnostics']
  readonly sourceGraph?: ProjectIndexSnapshot['sourceGraph']
  readonly trustedSourceGraph?: boolean
  readonly sources?: readonly IndexSourceFile[]
}): ProjectIndexSnapshot {
  return {
    schemaVersion: 1,
    prompts: [],
    contexts: [],
    project: { root },
    indexedAt: '2026-06-06T00:00:00.000Z',
    ...(input.trustedSourceGraph === false
      ? {}
      : input.sourceGraph !== undefined
        ? { sourceGraph: input.sourceGraph }
        : {
            sourceGraph: {
              schemaVersion: 1,
              producedBy: '@crux/indexer',
              capabilities: [
                'source-dependencies',
                'source-dependents',
                'definition-ownership',
                'diagnostic-ownership',
              ],
            },
          }),
    definitions: [...(input.definitions ?? [])],
    relations: [],
    diagnostics: [...(input.diagnostics ?? [])],
    lintFindings: [],
    ruleDescriptors: [],
    sources: [...(input.sources ?? [])],
  }
}

function definition(id: string, file: string): ProjectDefinition {
  return {
    id,
    kind: id.startsWith('agent:') ? 'agent' : 'prompt',
    name: id,
    fidelity: 'resolved',
    source: { file, line: 1 },
  }
}
