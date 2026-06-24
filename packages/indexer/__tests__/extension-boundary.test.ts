import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectDefinitionKind } from '@crux/core/project-index'
import { indexProjectAst } from '..'
import { createStaticExtensionRegistry, facts, type IndexerExtension } from '../indexer/extensions'
import { indexerExtensionRegistry, staticIndexerCallNames } from '../indexer/extractors/registry'
import type { ProjectIndexCompilerProfile } from '../indexer/compiler/profile'
import { createStaticExtraction, type StaticFileExtraction } from '../indexer/static/extraction/engine'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-extension-boundary-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('indexer extension boundary', () => {
  it('runs built-in Crux extractors through the extension registry', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'src/retrieval.ts'),
      `
        import { retriever } from '@crux/core'

        export const docs = retriever({
          id: 'docs',
          namespace: 'docs',
        })
      `,
    )

    const patch = await indexProjectAst({ root })

    expect(indexerExtensionRegistry.extensions.map((extension) => extension.name)).toContain(
      '@crux/indexer/crux-core',
    )
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('rag.retriever')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('safety')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('scorer')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('workspace')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('eval')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('tool')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('context')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('prompt')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('agent')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('composition')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('memory')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('blackboard')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('routing')
    expect(indexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('flow')
    expect(staticIndexerCallNames.has('retriever')).toBe(true)
    expect(indexerExtensionRegistry.extractors.filter((item) => item.extractor.patterns.length === 0)).toEqual([])
    expect(patch.facts.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'rag.retriever:docs',
          kind: 'rag.retriever',
          name: 'docs',
        }),
      ]),
    )
  })

  it('lets registered call patterns drive static discovery without hardcoded call names', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/workflow.ts')
    await writeFile(
      join(root, 'src/workflow-lib.ts'),
      `export function defineWorkflow(config: unknown) { return config }`,
    )
    await writeFile(
      file,
      `
        import { defineWorkflow as workflowFactory } from './workflow-lib'

        function defineWorkflow(config: unknown) {
          return config
        }

        const workflow = workflowFactory({
          id: 'publish',
        })

        const local = defineWorkflow({
          id: 'local',
        })
      `,
    )

    const extension: IndexerExtension = {
      name: '@acme/workflows',
      version: '1',
      extractors: [
        {
          name: 'workflow.defineWorkflow',
          patterns: [{ kind: 'call', name: 'defineWorkflow', importFrom: ['./workflow-lib'] }],
          extract: (ctx) => {
            const id = ctx.config?.string('id') ?? ctx.source.localName
            return facts({
              definitions: [
                ctx.define.definition({
                  variableName: ctx.source.variableName,
                  id: `@acme.workflow:${id}`,
                  kind: 'workflow' as ProjectDefinitionKind,
                  name: id,
                  metadata: { exportName: ctx.source.variableName },
                }),
              ],
            })
          },
        },
      ],
    }
    const extraction = createFixtureExtraction(root, extension)
    const parsed = await extraction.extractFile(file)

    expect(extraction.manifest.callNames).toEqual(['defineWorkflow'])
    expect(parsed.definitions).toEqual([
      expect.objectContaining({
        id: '@acme.workflow:publish',
        kind: 'workflow',
        name: 'publish',
      }),
    ])
  })

  it('exposes stable readers and source-ref builders for later first-party migrations', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/workflow.ts')
    await writeFile(
      file,
      `
        const schema = z.object({ topic: z.string() })
        const label = 'Launch'

        function decorate() {
          return label.toUpperCase()
        }

        function render() {
          return decorate()
        }

        const workflow = defineWorkflow('publish', {
          schema,
          render,
          prompt: \`Ship \${label}\`,
        })
      `,
    )

    const extension: IndexerExtension = {
      name: '@acme/workflows',
      version: '1',
      extractors: [
        {
          name: 'workflow.defineWorkflow',
          patterns: [{ kind: 'call', name: 'defineWorkflow', configArg: 1 }],
          extract: (ctx) => {
            const id = ctx.args.string(0) ?? ctx.source.localName
            const schema = ctx.sourceRef.schemaProperty({ property: 'schema', definitionId: `@acme.workflow:${id}` })
            return facts({
              definitions: [
                ctx.define.definition({
                  variableName: ctx.source.variableName,
                  id: `@acme.workflow:${id}`,
                  kind: 'workflow' as ProjectDefinitionKind,
                  name: id,
                  metadata: {
                    exportName: ctx.source.variableName,
                    hasRender: ctx.config?.has('render') ?? false,
                    schema: ctx.config?.schema('schema') ?? schema.schema,
                  },
                }),
              ],
              sourceRefs: [
                ...schema.sourceRefs,
                ...ctx.sourceRef.templateInterpolations({
                  property: 'prompt',
                  role: 'prompt',
                  definitionId: `@acme.workflow:${id}`,
                }),
                ...[
                  ctx.sourceRef.callbackProperty({
                    property: 'render',
                    role: 'handler',
                    definitionId: `@acme.workflow:${id}`,
                  }),
                ].filter(isDefined),
                ...ctx.sourceRef.helperRefsForProperty({
                  property: 'render',
                  definitionId: `@acme.workflow:${id}`,
                }),
              ],
            })
          },
        },
      ],
    }
    const parsed = await extractFileWithExtension(root, file, extension)

    expect(parsed.definitions).toEqual([
      expect.objectContaining({
        id: '@acme.workflow:publish',
        metadata: expect.objectContaining({
          hasRender: true,
          schema: expect.objectContaining({
            type: 'object',
          }),
        }),
        sourceRefs: expect.arrayContaining([
          expect.objectContaining({ role: 'schema', property: 'schema', symbol: 'schema' }),
          expect.objectContaining({ role: 'prompt', property: 'prompt', symbol: 'label' }),
          expect.objectContaining({ role: 'handler', property: 'render', symbol: 'render' }),
          expect.objectContaining({ role: 'helper', property: 'decorate', symbol: 'decorate' }),
        ]),
      }),
    ])
  })

  it('preserves authored argument identifiers before local initializer resolution', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src/workflow.ts')
    await writeFile(
      file,
      `
        const target = defineTarget({ id: 'docs' })

        const workflow = defineWorkflow(target, {
          id: 'publish',
        })
      `,
    )

    const extension: IndexerExtension = {
      name: '@acme/workflows',
      version: '1',
      extractors: [
        {
          name: 'workflow.defineWorkflow',
          patterns: [{ kind: 'call', name: 'defineWorkflow', configArg: 1 }],
          extract: (ctx) => {
            const id = ctx.config?.string('id') ?? ctx.source.localName
            return facts({
              definitions: [
                ctx.define.definition({
                  variableName: ctx.source.variableName,
                  id: `@acme.workflow:${id}`,
                  kind: 'workflow' as ProjectDefinitionKind,
                  name: id,
                  metadata: {
                    exportName: ctx.source.variableName,
                    targetVariable: ctx.args.identifier(0),
                  },
                }),
              ],
            })
          },
        },
      ],
    }
    const parsed = await extractFileWithExtension(root, file, extension)

    expect(parsed.definitions).toEqual([
      expect.objectContaining({
        id: '@acme.workflow:publish',
        metadata: expect.objectContaining({
          targetVariable: 'target',
        }),
      }),
    ])
  })

  it('matches importFrom patterns through tsconfig path aliases by exact module specifier', async () => {
    const root = await fixtureRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@fixtures/*': ['src/*'],
          },
        },
      }),
    )
    await writeFile(
      join(root, 'src/workflow-lib.ts'),
      `export function defineWorkflow(config: unknown) { return config }`,
    )
    const file = join(root, 'src/workflow.ts')
    await writeFile(
      file,
      `
        import { defineWorkflow } from '@fixtures/workflow-lib'

        const workflow = defineWorkflow({
          id: 'aliased',
        })
      `,
    )

    const extension: IndexerExtension = {
      name: '@acme/workflows',
      version: '1',
      extractors: [
        {
          name: 'workflow.defineWorkflow',
          patterns: [{ kind: 'call', name: 'defineWorkflow', importFrom: ['@fixtures/workflow-lib'] }],
          extract: (ctx) => {
            const id = ctx.config?.string('id') ?? ctx.source.localName
            return facts({
              definitions: [
                ctx.define.definition({
                  variableName: ctx.source.variableName,
                  id: `@acme.workflow:${id}`,
                  kind: 'workflow' as ProjectDefinitionKind,
                  name: id,
                  metadata: { exportName: ctx.source.variableName },
                }),
              ],
            })
          },
        },
      ],
    }

    const parsed = await extractFileWithExtension(root, file, extension)

    expect(parsed.definitions).toEqual([
      expect.objectContaining({
        id: '@acme.workflow:aliased',
        kind: 'workflow',
        name: 'aliased',
      }),
    ])
  })

  it('registers relation specs through extensions and fails duplicate specs deterministically', () => {
    expect(
      indexerExtensionRegistry.extensions
        .flatMap((extension) => extension.relations ?? [])
        .map((spec) => spec.type),
    ).toContain('prompt.uses_context')

    expect(() =>
      createStaticExtensionRegistry([
        {
          name: '@acme/one',
          version: '1',
          relations: [
            {
              type: '@acme.workflow.uses_tool',
              fromKinds: ['@acme.workflow'],
              toKinds: ['tool'],
              presentation: 'both',
              runtimeJoin: false,
            },
            {
              type: '@acme.workflow.uses_tool',
              fromKinds: ['@acme.workflow'],
              toKinds: ['tool'],
              presentation: 'both',
              runtimeJoin: false,
            },
          ],
        },
      ]),
    ).toThrow(/Duplicate relation spec: @acme\.workflow\.uses_tool/)
  })
})

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

function createFixtureExtraction(root: string, extension: IndexerExtension) {
  return createStaticExtraction({
    root,
    profile: fixtureCompilerProfile,
    extensions: [extension],
    cache: 'none',
  })
}

async function extractFileWithExtension(
  root: string,
  file: string,
  extension: IndexerExtension,
): Promise<StaticFileExtraction> {
  return createFixtureExtraction(root, extension).extractFile(file)
}

const fixtureCompilerProfile = {
  name: '@crux/indexer/test-profile',
  version: '1',
  extensions: [],
} as const satisfies ProjectIndexCompilerProfile
