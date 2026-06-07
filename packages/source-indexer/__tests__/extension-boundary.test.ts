import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectDefinitionKind } from '@crux/core/catalog'
import { indexProjectAst } from '../index'
import { createStaticExtensionRegistry, extractWithExtensionRegistry, facts, type SourceIndexerExtension } from '../indexer/extensions'
import { sourceIndexerExtensionRegistry, staticPrimitiveCallNames } from '../indexer/extractors/registry'
import { staticFileParser } from '../indexer/static-parser'
import { parseStaticDefinitions } from '../indexer/static-file'
import type { StaticFileParser } from '../indexer/types'

const roots: string[] = []

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-extension-boundary-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('source indexer extension boundary', () => {
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
      '@crux/source-indexer/crux-core',
    )
    expect(staticPrimitiveCallNames.has('retriever')).toBe(true)
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
      file,
      `
        import { defineWorkflow } from '@acme/workflows'

        const workflow = defineWorkflow({
          id: 'publish',
        })
      `,
    )

    const extension: SourceIndexerExtension = {
      name: '@acme/workflows',
      version: '1',
      extractors: [
        {
          name: 'workflow.defineWorkflow',
          patterns: [{ kind: 'call', name: 'defineWorkflow', importFrom: ['@acme/workflows'] }],
          extract: (ctx) => {
            const id = ctx.config?.string('id') ?? ctx.source.localName
            const legacy = ctx.unstableNative?.legacyStaticContext
            if (!isLegacyContextWithDefine(legacy)) return { kind: 'none' }
            return facts({
              definitions: [
                {
                  variableName: ctx.source.variableName,
                  definition: legacy.define(
                    `@acme.workflow:${id}`,
                    'workflow' as ProjectDefinitionKind,
                    id,
                    legacy.objectArg,
                    { exportName: ctx.source.variableName },
                  ),
                },
              ],
            })
          },
        },
      ],
    }
    const registry = createStaticExtensionRegistry([extension])
    const parser: StaticFileParser = {
      ...staticFileParser,
      staticDefinitionFromInitializer: (rootValue, fileValue, sourceFile, variableName, initializer, localInitializers) => {
        if (!ts.isCallExpression(initializer)) return undefined
        const callName = staticFileParser.expressionName(initializer.expression)
        if (!callName) return undefined
        const firstArg = initializer.arguments[0]
        const objectArg = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
        return extractWithExtensionRegistry(registry, {
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
          helpers: staticFileParserHelpers,
          safeId: staticFileParserHelpers.safeId,
          define: staticFileParserHelpers.define,
        })
      },
      staticDefinitionFromCall: () => undefined,
      staticTreePathDefinitions: async () => [],
    }

    const parsed = await parseStaticDefinitions(root, file, parser)

    expect(registry.callNames).toEqual(['defineWorkflow'])
    expect(parsed.definitions).toEqual([
      expect.objectContaining({
        id: '@acme.workflow:publish',
        kind: 'workflow',
        name: 'publish',
      }),
    ])
  })

  it('registers relation specs through extensions and fails duplicate specs deterministically', () => {
    expect(
      sourceIndexerExtensionRegistry.extensions.flatMap((extension) => extension.relations ?? []).map((spec) => spec.type),
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

const staticFileParserHelpers = {
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

function isLegacyContextWithDefine(value: unknown): value is {
  readonly objectArg: ts.ObjectLiteralExpression | undefined
  readonly define: typeof staticFileParserHelpers.define
} {
  return Boolean(value && typeof value === 'object' && 'define' in value)
}
