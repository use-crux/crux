import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectDefinitionKind } from '@use-crux/core/project-index'
import {
  astIndexPatchFromCompilerResult,
  compileProjectIndex,
  createProjectIndexCompiler,
  projectIndexSnapshotFromCompilerResult,
} from '../indexer/compiler'
import { compilerProfileCacheInputs } from '../indexer/cache-identity'
import { compilerProjectionStaticCallNames, cruxCoreCompilerProfile } from '../indexer/compiler/profile'
import { facts, type IndexerExtension } from '../indexer/extensions'
import { indexLintFinding } from '../indexer/lints/rules'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-project-index-compiler-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('project index compiler', () => {
  it('declares compiler-owned projections in the default compiler profile', () => {
    expect(cruxCoreCompilerProfile.projections?.map((projection) => projection.name)).toEqual([
      'source-ref-projection',
      'runtime-prepare-use-entries',
      'prompt-context-tree-paths',
    ])
    expect(compilerProjectionStaticCallNames(cruxCoreCompilerProfile)).toEqual([])
  })

  it('includes compiler-owned projections in compiler profile cache identity', () => {
    expect(compilerProfileCacheInputs(cruxCoreCompilerProfile)).toEqual([
      {
        kind: 'compiler-profile',
        name: '@use-crux/indexer/crux-core-profile',
        version: '1',
      },
      {
        kind: 'compiler-projection',
        name: 'source-ref-projection',
        version: '1',
        phase: 'parse',
      },
      {
        kind: 'compiler-projection',
        name: 'runtime-prepare-use-entries',
        version: '1',
        phase: 'parse',
      },
      {
        kind: 'compiler-projection',
        name: 'prompt-context-tree-paths',
        version: '1',
        phase: 'resolve',
      },
    ])
  })

  it('validates built-in rule manifests during compiler construction', () => {
    expect(() => createProjectIndexCompiler()).not.toThrow()
  })

  it('isolates indexer extensions per compiler profile', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/workflows.ts'),
      `
        import { prompt } from '@use-crux/core'

        export const marker = prompt({ id: 'marker' })
        const alpha = defineAlpha({ id: 'alpha' })
        const beta = defineBeta({ id: 'beta' })
      `,
    )

    const alphaCompiler = createProjectIndexCompiler({
      profile: testProfile('@acme/alpha-profile', [
        testExtension({
          name: '@acme/alpha',
          callName: 'defineAlpha',
          kind: 'alpha.workflow' as ProjectDefinitionKind,
          idPrefix: 'alpha.workflow',
        }),
      ]),
    })
    const betaCompiler = createProjectIndexCompiler({
      profile: testProfile('@acme/beta-profile', [
        testExtension({
          name: '@acme/beta',
          callName: 'defineBeta',
          kind: 'beta.workflow' as ProjectDefinitionKind,
          idPrefix: 'beta.workflow',
        }),
      ]),
    })

    const alpha = await alphaCompiler.compile({ root, mode: 'source-only' })
    const beta = await betaCompiler.compile({ root, mode: 'source-only' })

    expect(alpha.facts.definitions?.map((definition) => definition.id)).toContain('alpha.workflow:alpha')
    expect(alpha.facts.definitions?.map((definition) => definition.id)).not.toContain('beta.workflow:beta')
    expect(beta.facts.definitions?.map((definition) => definition.id)).toContain('beta.workflow:beta')
    expect(beta.facts.definitions?.map((definition) => definition.id)).not.toContain('alpha.workflow:alpha')
  })

  it('preserves degraded extractor diagnostics and source dependencies in compiler output', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const supportFile = join(root, 'src/support.ts')
    await writeFile(supportFile, `export const support = true`)
    await writeFile(
      join(root, 'src/workflows.ts'),
      `
        import { prompt } from '@use-crux/core'
        import { support } from './support'

        export const marker = prompt({ id: 'marker' })
        const workflow = defineDegraded({ id: 'partial' })
      `,
    )

    const compiler = createProjectIndexCompiler({
      profile: testProfile('@acme/degraded-profile', [
        {
          name: '@acme/degraded',
          version: '1',
          extractors: [
            {
              name: '@acme/degraded.define',
              patterns: [{ kind: 'call', name: 'defineDegraded' }],
              extract: (ctx) => {
                const id = ctx.config?.string('id') ?? ctx.source.localName
                return {
                  kind: 'degraded',
                  diagnostics: [
                    {
                      id: 'diagnostic:acme:degraded',
                      code: 'acme.degraded',
                      severity: 'warning',
                      message: 'Degraded workflow extraction',
                      source: { file: ctx.source.file, line: 1 },
                    },
                  ],
                  dependencies: [{ kind: 'source-file', file: supportFile }],
                  facts: {
                    definitions: [
                      ctx.define.definition({
                        variableName: ctx.source.variableName,
                        id: `acme.workflow:${id}`,
                        kind: 'workflow' as ProjectDefinitionKind,
                        name: id,
                      }),
                    ],
                  },
                }
              },
            },
          ],
        },
      ]),
    })

    const result = await compiler.compile({ root, mode: 'source-only' })

    expect(result.facts.definitions?.map((definition) => definition.id)).toContain('acme.workflow:partial')
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'acme.degraded' })]))
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: join(root, 'src/workflows.ts'),
          dependencies: expect.arrayContaining([supportFile]),
        }),
      ]),
    )
  })

  it('surfaces relation policy gaps from compiler relation resolution', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/workflows.ts'),
      `
        const source = defineUnknownRelation({ id: 'source' })
      `,
    )

    const compiler = createProjectIndexCompiler({
      profile: testProfile('@acme/relation-gap-profile', [
        {
          name: '@acme/relation-gap',
          version: '1',
          extractors: [
            {
              name: '@acme/relation-gap.define',
              patterns: [{ kind: 'call', name: 'defineUnknownRelation' }],
              extract: (ctx) => {
                const id = ctx.config?.string('id') ?? ctx.source.localName
                return facts({
                  definitions: [
                    ctx.define.definition({
                      variableName: ctx.source.variableName,
                      id: `acme.workflow:${id}`,
                      kind: 'workflow' as ProjectDefinitionKind,
                      name: id,
                    }),
                  ],
                  references: [{ type: 'workflow.uses_unknown', toVariable: 'target' }],
                })
              },
            },
          ],
        },
      ]),
    })

    const result = await compiler.compile({ root, mode: 'source-only' })

    expect(result.facts.relations).toEqual([])
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'relation.unresolved_reference',
          relatedDefinitionIds: ['acme.workflow:source'],
        }),
        expect.objectContaining({
          code: 'relation.policy_gap',
          relatedDefinitionIds: ['acme.workflow:source'],
        }),
      ]),
    )
  })

  it('skips semantic-phase extension rules in source-only compilation without dropping source facts', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/workflows.ts'),
      `
        const workflow = defineWorkflow({ id: 'publish' })
      `,
    )

    const compiler = createProjectIndexCompiler({
      profile: testProfile('@acme/semantic-rule-profile', [
        {
          name: '@acme/semantic-rule',
          version: '1',
          extractors: [
            {
              name: '@acme/semantic-rule.define',
              patterns: [{ kind: 'call', name: 'defineWorkflow' }],
              extract: (ctx) =>
                facts({
                  definitions: [
                    ctx.define.definition({
                      variableName: ctx.source.variableName,
                      id: 'acme.workflow:publish',
                      kind: 'workflow' as ProjectDefinitionKind,
                      name: 'publish',
                    }),
                  ],
                }),
            },
          ],
          rules: [
            {
              manifest: {
                id: '@acme/semantic-rule/require-type',
                docs: { description: 'Requires semantic type evidence.' },
                phase: 'semantic',
                requires: ['definitions'],
                fidelity: 'best-effort',
                defaultSeverity: 'warning',
              },
              messages: { missing: 'Missing semantic evidence.' },
              check: () => [
                indexLintFinding({
                  ruleId: 'definition.missing_eval_coverage',
                  key: 'semantic-rule-ran',
                  message: 'semantic-rule-ran',
                  relatedDefinitionIds: [],
                  evidence: [],
                }),
              ],
            },
          ],
        },
      ]),
    })

    const result = await compiler.compile({ root, mode: 'source-only' })

    expect(result.facts.definitions?.map((definition) => definition.id)).toContain('acme.workflow:publish')
    expect(result.lintFindings).not.toContainEqual(expect.objectContaining({ message: 'semantic-rule-ran' }))
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'index.rule_unavailable',
        message: expect.stringContaining('@acme/semantic-rule/require-type'),
      }),
    )
  })

  it('compiles source-only indexs as immutable results without importing user config modules', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/writer.ts'),
      `
        import { prompt } from '@use-crux/core'

        export const writer = prompt({
          id: 'writer',
          system: 'Write clearly.',
          prompt: 'Draft.',
        })
      `,
    )
    await writeFile(
      join(root, 'crux.config.ts'),
      `
        import { config } from '@use-crux/core'

        throw new Error('source-only compiler must not import config modules')

        export default config({})
      `,
    )

    const result = await compileProjectIndex({ root, projectName: 'fixture', mode: 'source-only' })
    const snapshot = projectIndexSnapshotFromCompilerResult(result)
    const patch = astIndexPatchFromCompilerResult(result)

    expect(result.project).toEqual({
      root,
      name: 'fixture',
      configFile: join(root, 'crux.config.ts'),
      runtimeConfigured: false,
    })
    expect(result.facts.definitions).toContainEqual(
      expect.objectContaining({ id: 'prompt:writer', kind: 'prompt', fidelity: 'resolved' }),
    )
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'index.source_only' }))
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'index.config_import_failed' }))
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        file: join(root, 'crux.config.ts'),
        status: 'partial',
        diagnostics: expect.arrayContaining([expect.stringContaining('index:source-only')]),
      }),
    )
    expect(snapshot.definitions.map((definition) => definition.id)).toContain('prompt:writer')
    expect(snapshot.sources).toEqual(result.sources)
    expect(patch.phase).toBe('ast')
    expect(patch.invalidates).toEqual({ all: true })
    expect(patch.facts.definitions).toEqual(result.facts.definitions)
    expect(patch.facts.sources).toEqual(result.sources)
  })

  it('emits AST patches with caller-provided exact invalidation', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/writer.ts'),
      `
        import { prompt } from '@use-crux/core'

        export const writer = prompt({
          id: 'writer',
          system: 'Write clearly.',
          prompt: 'Draft.',
        })
      `,
    )

    const result = await compileProjectIndex({
      root,
      projectName: 'fixture',
      mode: 'source-only',
      indexedAt: '2026-01-01T00:00:00.000Z',
    })
    const patch = astIndexPatchFromCompilerResult(result, {
      invalidates: { files: [join(root, 'src/writer.ts')], definitionIds: ['prompt:writer'] },
      status: 'partial',
      finishedAt: '2026-01-01T00:00:01.000Z',
    })

    expect(patch.startedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(patch.finishedAt).toBe('2026-01-01T00:00:01.000Z')
    expect(patch.status).toBe('partial')
    expect(patch.invalidates).toEqual({ files: [join(root, 'src/writer.ts')], definitionIds: ['prompt:writer'] })
    expect(patch.facts.definitions?.map((definition) => definition.id)).toContain('prompt:writer')
  })
})

function testProfile(name: string, extensions: readonly IndexerExtension[]) {
  return {
    name,
    version: '1',
    extensions,
  }
}

function testExtension(input: {
  readonly name: string
  readonly callName: string
  readonly kind: ProjectDefinitionKind
  readonly idPrefix: string
}): IndexerExtension {
  return {
    name: input.name,
    version: '1',
    extractors: [
      {
        name: `${input.name}.define`,
        patterns: [{ kind: 'call', name: input.callName }],
        extract: (ctx) => {
          const id = ctx.config?.string('id') ?? ctx.source.localName
          return facts({
            definitions: [
              ctx.define.definition({
                variableName: ctx.source.variableName,
                id: `${input.idPrefix}:${id}`,
                kind: input.kind,
                name: id,
              }),
            ],
          })
        },
      },
    ],
  }
}
