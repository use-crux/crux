import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectDefinitionKind } from '@crux/core/project-index'
import { indexProjectAst } from '../index'
import {
  createStaticExtensionRegistry,
  extractFactsWithExtensionRegistry,
  facts,
  type IndexerExtension,
} from '../indexer/extensions'
import { sourceIndexerExtensionRegistry, staticPrimitiveCallNames } from '../indexer/extractors/registry'
import { staticFactParser } from '../indexer/static-parser'
import { parseStaticDefinitionsFromFacts } from '../indexer/static-file'
import type { StaticFactParser } from '../indexer/types'

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

    expect(sourceIndexerExtensionRegistry.extensions.map((extension) => extension.name)).toContain(
      '@crux/indexer/crux-core',
    )
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('rag.retriever')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('safety')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('scorer')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('workspace')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('eval')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('tool')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('context')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('prompt')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('agent')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('composition')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('memory')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('blackboard')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('routing')
    expect(sourceIndexerExtensionRegistry.extractors.map((item) => item.extractor.name)).toContain('flow')
    expect(staticPrimitiveCallNames.has('retriever')).toBe(true)
    expect(sourceIndexerExtensionRegistry.extractors.filter((item) => item.extractor.patterns.length === 0)).toEqual([])
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
    const registry = createStaticExtensionRegistry([extension])
    const parser: StaticFactParser = {
      ...staticFactParser,
      staticFactsFromInitializer: (
        rootValue,
        fileValue,
        sourceFile,
        variableName,
        initializer,
        localInitializers,
        importBindings,
      ) => {
        if (!ts.isCallExpression(initializer)) return undefined
        const callName = staticFactParser.expressionName(initializer.expression)
        if (!callName) return undefined
        const firstArg = initializer.arguments[0]
        const objectArg = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
        const importBinding = importBindings?.get(callName)
        return extractFactsWithExtensionRegistry(registry, {
          root: rootValue,
          file: fileValue,
          sourceFile,
          variableName,
          call: initializer,
          callName,
          firstArg,
          objectArg,
          source: { file: fileValue, line: 1 },
          localName: variableName,
          localInitializers,
          ...(importBinding
            ? { importName: importBinding.importedName, importSource: importBinding.moduleSpecifier }
            : {}),
          helpers: staticContextHelpers,
          safeId: staticContextHelpers.safeId,
          define: staticContextHelpers.define,
        })
      },
      staticFactsFromCall: () => undefined,
      staticTreePathDefinitions: async () => [],
    }

    const parsed = await parseStaticDefinitionsFromFacts(root, file, parser)

    expect(registry.callNames).toEqual(['defineWorkflow'])
    expect(parsed.definitions).toEqual([
      expect.objectContaining({
        id: '@acme.workflow:publish',
        kind: 'workflow',
        name: 'publish',
      }),
    ])
    expect(
      extractFactsWithExtensionRegistry(registry, {
        root,
        file,
        sourceFile: ts.createSourceFile(file, 'defineWorkflow({ id: "local" })', ts.ScriptTarget.Latest, true),
        variableName: 'local',
        call: ts.factory.createCallExpression(ts.factory.createIdentifier('defineWorkflow'), undefined, []),
        callName: 'defineWorkflow',
        source: { file, line: 1 },
        localName: 'local',
        localInitializers: new Map(),
        helpers: staticContextHelpers,
        safeId: staticContextHelpers.safeId,
        define: staticContextHelpers.define,
      }),
    ).toBeUndefined()
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
    const registry = createStaticExtensionRegistry([extension])
    const parser: StaticFactParser = {
      ...staticFactParser,
      staticFactsFromInitializer: (rootValue, fileValue, sourceFile, variableName, initializer, localInitializers) => {
        if (!ts.isCallExpression(initializer)) return undefined
        const callName = staticFactParser.expressionName(initializer.expression)
        if (!callName) return undefined
        const secondArg = initializer.arguments[1]
        const objectArg = secondArg && ts.isObjectLiteralExpression(secondArg) ? secondArg : undefined
        return extractFactsWithExtensionRegistry(registry, {
          root: rootValue,
          file: fileValue,
          sourceFile,
          variableName,
          call: initializer,
          callName,
          firstArg: initializer.arguments[0],
          objectArg,
          source: { file: fileValue, line: 1 },
          localName: variableName,
          localInitializers,
          helpers: staticContextHelpers,
          safeId: staticContextHelpers.safeId,
          define: staticContextHelpers.define,
        })
      },
      staticFactsFromCall: () => undefined,
      staticTreePathDefinitions: async () => [],
    }

    const parsed = await parseStaticDefinitionsFromFacts(root, file, parser)

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
    const registry = createStaticExtensionRegistry([extension])
    const parser: StaticFactParser = {
      ...staticFactParser,
      staticFactsFromInitializer: (rootValue, fileValue, sourceFile, variableName, initializer, localInitializers) => {
        if (!ts.isCallExpression(initializer)) return undefined
        const callName = staticFactParser.expressionName(initializer.expression)
        if (!callName) return undefined
        const secondArg = initializer.arguments[1]
        const objectArg = secondArg && ts.isObjectLiteralExpression(secondArg) ? secondArg : undefined
        return extractFactsWithExtensionRegistry(registry, {
          root: rootValue,
          file: fileValue,
          sourceFile,
          variableName,
          call: initializer,
          callName,
          firstArg: initializer.arguments[0],
          objectArg,
          source: { file: fileValue, line: 1 },
          localName: variableName,
          localInitializers,
          helpers: staticContextHelpers,
          safeId: staticContextHelpers.safeId,
          define: staticContextHelpers.define,
        })
      },
      staticFactsFromCall: () => undefined,
      staticTreePathDefinitions: async () => [],
    }

    const parsed = await parseStaticDefinitionsFromFacts(root, file, parser)

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

    const registry = createStaticExtensionRegistry([
      {
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
      },
    ])
    const parser: StaticFactParser = {
      ...staticFactParser,
      staticFactsFromInitializer: (
        rootValue,
        fileValue,
        sourceFile,
        variableName,
        initializer,
        localInitializers,
        importBindings,
      ) => {
        if (!ts.isCallExpression(initializer)) return undefined
        const callName = staticFactParser.expressionName(initializer.expression)
        if (!callName) return undefined
        const firstArg = initializer.arguments[0]
        const objectArg = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
        const importBinding = importBindings?.get(callName)
        return extractFactsWithExtensionRegistry(registry, {
          root: rootValue,
          file: fileValue,
          sourceFile,
          variableName,
          call: initializer,
          callName,
          firstArg,
          objectArg,
          source: { file: fileValue, line: 1 },
          localName: variableName,
          localInitializers,
          ...(importBinding
            ? { importName: importBinding.importedName, importSource: importBinding.moduleSpecifier }
            : {}),
          helpers: staticContextHelpers,
          safeId: staticContextHelpers.safeId,
          define: staticContextHelpers.define,
        })
      },
      staticFactsFromCall: () => undefined,
      staticTreePathDefinitions: async () => [],
    }

    const parsed = await parseStaticDefinitionsFromFacts(root, file, parser)

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
      sourceIndexerExtensionRegistry.extensions
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

const staticContextHelpers = {
  safeId: (value: string) => value,
  schemaProperty: () => undefined,
  define: (
    id: string,
    kind: ProjectDefinitionKind,
    name: string,
    _objectArg: unknown,
    metadata: Record<string, unknown>,
  ) => ({
    id,
    kind,
    name,
    fidelity: 'partial' as const,
    status: 'active' as const,
    source: { file: 'test.ts', line: 1 },
    metadata,
  }),
  relationRef: (type: string, target: { toVariable?: string; toId?: string }) => ({ type, ...target }),
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
