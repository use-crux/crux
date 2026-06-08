import ts from 'typescript'
import type { CatalogDiagnostic, CatalogLintFinding, ProjectDefinitionKind } from '@crux/core/catalog'
import { describe, expect, it } from 'vitest'
import {
  createSourceIndexerExtensionRuntime,
  facts,
  none,
  resolveExtensionReferences,
  staticFoundDefinitionFromStaticExtractionResult,
  type SourceIndexerExtension,
  type StaticExtractionInput,
} from '../indexer/extensions'
import { catalogLintFinding } from '../indexer/catalog-lint-rules'

describe('source indexer extension runtime', () => {
  it('exposes deterministic manifest identity for unordered extension manifests', () => {
    const runtime = createSourceIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/zeta',
          version: '2',
          extractors: [
            { name: 'z.second', patterns: [{ kind: 'call', name: 'zSecond' }], extract: () => none() },
            { name: 'z.first', patterns: [{ kind: 'call', name: 'zFirst' }], extract: () => none() },
          ],
        }),
        extension({
          name: '@acme/alpha',
          version: '1',
          relations: [
            {
              type: '@acme.alpha.uses_tool',
              fromKinds: ['@acme.alpha'],
              toKinds: ['tool'],
              presentation: 'both',
              runtimeJoin: false,
            },
          ],
          extractors: [
            { name: 'alpha.define', patterns: [{ kind: 'call', name: 'defineAlpha' }], extract: () => none() },
          ],
        }),
      ],
    })

    expect(runtime.manifest.extensions).toEqual([
      { name: '@acme/alpha', version: '1' },
      { name: '@acme/zeta', version: '2' },
    ])
    expect(runtime.manifest.extractors).toEqual([
      { extension: { name: '@acme/alpha', version: '1' }, name: 'alpha.define' },
      { extension: { name: '@acme/zeta', version: '2' }, name: 'z.first' },
      { extension: { name: '@acme/zeta', version: '2' }, name: 'z.second' },
    ])
    expect(runtime.manifest.callNames).toEqual(['defineAlpha', 'zFirst', 'zSecond'])
    expect(runtime.manifest.relationSpecs.map((spec) => spec.type)).toEqual(['@acme.alpha.uses_tool'])
    expect(runtime.manifest.capabilities).toEqual(['static-extraction'])
    expect(runtime.manifest.cacheInputs).toEqual([
      { kind: 'extension', name: '@acme/alpha', version: '1' },
      { kind: 'extractor', extension: '@acme/alpha', name: 'alpha.define' },
      { kind: 'extension', name: '@acme/zeta', version: '2' },
      { kind: 'extractor', extension: '@acme/zeta', name: 'z.first' },
      { kind: 'extractor', extension: '@acme/zeta', name: 'z.second' },
    ])
  })

  it('runs a matching static extractor through stable readers and builders', () => {
    const runtime = createSourceIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/workflows',
          version: '1',
          extractors: [
            {
              name: 'workflow.define',
              patterns: [{ kind: 'call', name: 'defineWorkflow' }],
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
        }),
      ],
    })

    const result = runtime.extractStatic(staticInput('defineWorkflow({ id: "publish" })'))

    expect(result).toEqual({
      kind: 'matched',
      extension: { name: '@acme/workflows', version: '1' },
      extractor: 'workflow.define',
      dependencies: [
        { kind: 'extension', name: '@acme/workflows', version: '1' },
        { kind: 'extractor', extension: '@acme/workflows', name: 'workflow.define' },
      ],
      diagnostics: [],
      facts: {
        definitions: [
          {
            variableName: 'workflow',
            definition: expect.objectContaining({
              id: '@acme.workflow:publish',
              kind: 'workflow',
              name: 'publish',
            }),
          },
        ],
      },
    })
  })

  it('distinguishes no-match from a matched extractor that returned none', () => {
    const runtime = createSourceIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/workflows',
          version: '1',
          extractors: [
            { name: 'workflow.define', patterns: [{ kind: 'call', name: 'defineWorkflow' }], extract: () => none() },
          ],
        }),
      ],
    })

    expect(runtime.extractStatic(staticInput('defineOther({})'))).toEqual({ kind: 'no-match' })
    expect(runtime.extractStatic(staticInput('defineWorkflow({})'))).toEqual({
      kind: 'none',
      extension: { name: '@acme/workflows', version: '1' },
      extractor: 'workflow.define',
      dependencies: [
        { kind: 'extension', name: '@acme/workflows', version: '1' },
        { kind: 'extractor', extension: '@acme/workflows', name: 'workflow.define' },
      ],
      diagnostics: [],
    })
  })

  it('continues past empty extractor matches until it finds usable facts', () => {
    const runtime = createSourceIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/workflows',
          version: '1',
          extractors: [
            { name: 'workflow.empty', patterns: [{ kind: 'call', name: 'defineWorkflow' }], extract: () => none() },
            {
              name: 'workflow.define',
              patterns: [{ kind: 'call', name: 'defineWorkflow' }],
              extract: (ctx) =>
                facts({
                  definitions: [
                    ctx.define.definition({
                      variableName: ctx.source.variableName,
                      id: '@acme.workflow:publish',
                      kind: 'workflow' as ProjectDefinitionKind,
                      name: 'publish',
                    }),
                  ],
                }),
            },
          ],
        }),
      ],
    })

    expect(runtime.extractStatic(staticInput('defineWorkflow({})'))).toEqual(
      expect.objectContaining({
        kind: 'matched',
        extractor: 'workflow.define',
      }),
    )
  })

  it('preserves degraded extractor facts, diagnostics, and dependencies immutably', () => {
    const diagnostic = catalogDiagnostic('catalog.workflow_degraded')
    const runtime = createSourceIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/workflows',
          version: '1',
          extractors: [
            {
              name: 'workflow.define',
              patterns: [{ kind: 'call', name: 'defineWorkflow' }],
              extract: (ctx) => ({
                kind: 'degraded',
                diagnostics: [diagnostic],
                dependencies: [{ kind: 'source-file', file: ctx.source.file }],
                facts: {
                  definitions: [
                    ctx.define.definition({
                      variableName: ctx.source.variableName,
                      id: '@acme.workflow:partial',
                      kind: 'workflow' as ProjectDefinitionKind,
                      name: 'partial',
                    }),
                  ],
                },
              }),
            },
          ],
        }),
      ],
    })

    expect(runtime.extractStatic(staticInput('defineWorkflow({})'))).toEqual({
      kind: 'degraded',
      extension: { name: '@acme/workflows', version: '1' },
      extractor: 'workflow.define',
      dependencies: [
        { kind: 'extension', name: '@acme/workflows', version: '1' },
        { kind: 'extractor', extension: '@acme/workflows', name: 'workflow.define' },
        { kind: 'source-file', file: '/project/src/workflow.ts' },
      ],
      diagnostics: [diagnostic],
      facts: {
        definitions: [
          {
            variableName: 'workflow',
            definition: expect.objectContaining({
              id: '@acme.workflow:partial',
              kind: 'workflow',
              name: 'partial',
            }),
          },
        ],
      },
    })
  })

  it('projects runtime extraction results into the current static parser compatibility shape', () => {
    const runtime = createSourceIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/workflows',
          version: '1',
          extractors: [
            {
              name: 'workflow.define',
              patterns: [{ kind: 'call', name: 'defineWorkflow' }],
              extract: (ctx) =>
                facts({
                  definitions: [
                    ctx.define.definition({
                      variableName: ctx.source.variableName,
                      id: '@acme.workflow:publish',
                      kind: 'workflow' as ProjectDefinitionKind,
                      name: 'publish',
                    }),
                  ],
                  references: [ctx.ref.id('@acme.workflow.uses_tool', 'tool:writer')],
                }),
            },
          ],
        }),
      ],
    })

    expect(
      staticFoundDefinitionFromStaticExtractionResult({
        result: runtime.extractStatic(staticInput('defineWorkflow({})')),
      }),
    ).toEqual({
      variableName: 'workflow',
      definition: expect.objectContaining({
        id: '@acme.workflow:publish',
        kind: 'workflow',
        name: 'publish',
      }),
      relationRefs: [{ type: '@acme.workflow.uses_tool', toId: 'tool:writer' }],
    })
  })

  it('resolves extracted references through a functional runtime boundary', () => {
    const result = resolveExtensionReferences({
      found: [
        {
          variableName: 'workflow',
          definition: definition('@acme.workflow:publish', 'workflow' as ProjectDefinitionKind, 'publish'),
          relationRefs: [{ type: '@acme.workflow.uses_tool', toId: 'tool:writer' }],
        },
      ],
    })

    expect(result.diagnostics).toEqual([])
    expect(result.relations).toEqual([
      expect.objectContaining({
        type: '@acme.workflow.uses_tool',
        from: '@acme.workflow:publish',
        to: 'tool:writer',
      }),
    ])
  })

  it('runs catalog rules in deterministic runtime order without mutating catalog facts', () => {
    const workflow = definition('@acme.workflow:publish', 'workflow' as ProjectDefinitionKind, 'publish')
    const runtime = createSourceIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/zeta',
          version: '1',
          rules: [
            {
              name: 'z.second',
              meta: ruleMeta('z.second'),
              check: ({ definitions }) => [lintFinding(`z:${definitions.length}`)],
            },
            {
              name: 'z.first',
              meta: ruleMeta('z.first'),
              check: ({ relations }) => [lintFinding(`z-first:${relations.length}`)],
            },
          ],
        }),
        extension({
          name: '@acme/alpha',
          version: '1',
          rules: [
            {
              name: 'a.first',
              meta: ruleMeta('a.first'),
              check: ({ definitions }) => [lintFinding(`a:${definitions[0]?.id ?? 'none'}`)],
            },
          ],
        }),
      ],
    })

    expect(runtime.manifest.capabilities).toEqual(['static-extraction', 'catalog-rules'])
    expect(runtime.manifest.cacheInputs).toEqual([
      { kind: 'extension', name: '@acme/alpha', version: '1' },
      { kind: 'rule', extension: '@acme/alpha', name: 'a.first' },
      { kind: 'extension', name: '@acme/zeta', version: '1' },
      { kind: 'rule', extension: '@acme/zeta', name: 'z.first' },
      { kind: 'rule', extension: '@acme/zeta', name: 'z.second' },
    ])
    expect(runtime.checkRules({ definitions: [workflow], relations: [] })).toMatchObject({
      outputs: [{ message: 'a:@acme.workflow:publish' }, { message: 'z-first:0' }, { message: 'z:1' }],
      diagnostics: [],
    })
    expect(workflow).toEqual(definition('@acme.workflow:publish', 'workflow' as ProjectDefinitionKind, 'publish'))
  })

  it('fails extension runtime construction for malformed catalog rule metadata', () => {
    expect(() =>
      createSourceIndexerExtensionRuntime({
        extensions: [
          extension({
            name: '@acme/broken',
            version: '1',
            rules: [
              {
                name: 'broken.rule',
                meta: { docs: { description: '' }, messages: {} },
                check: () => [],
              },
            ],
          }),
        ],
      }),
    ).toThrow(/rule docs\.description is required/)
  })
})

function extension(input: SourceIndexerExtension): SourceIndexerExtension {
  return input
}

function lintFinding(id: string): CatalogLintFinding {
  return catalogLintFinding({
    ruleId: 'definition.missing_eval_coverage',
    key: id,
    message: id,
    relatedDefinitionIds: [],
    evidence: [],
  })
}

function ruleMeta(description: string) {
  return {
    docs: { description },
    messages: { finding: description },
  }
}

function staticInput(sourceText: string): StaticExtractionInput {
  const file = '/project/src/workflow.ts'
  const sourceFile = ts.createSourceFile(file, `const workflow = ${sourceText}`, ts.ScriptTarget.Latest, true)
  const statement = sourceFile.statements[0]
  if (!ts.isVariableStatement(statement)) throw new Error('Expected variable statement fixture.')
  const declaration = statement.declarationList.declarations[0]
  if (!declaration?.initializer || !ts.isCallExpression(declaration.initializer)) {
    throw new Error('Expected call initializer fixture.')
  }
  const call = declaration.initializer
  const firstArg = call.arguments[0]
  const objectArg = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
  const callName = call.expression.getText(sourceFile)
  return {
    root: '/project',
    file,
    sourceFile,
    variableName: 'workflow',
    call,
    callName,
    firstArg,
    objectArg,
    source: { file, line: 1 },
    localName: 'workflow',
    localInitializers: new Map(),
    helpers: staticContextHelpers,
    safeId: staticContextHelpers.safeId,
    define: staticContextHelpers.define,
  }
}

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
    source: { file: '/project/src/workflow.ts', line: 1 },
    metadata,
  }),
  relationRef: (type: string, target: { toVariable?: string; toId?: string }) => ({ type, ...target }),
}

function catalogDiagnostic(code: string): CatalogDiagnostic {
  return {
    id: `${code}:workflow`,
    code,
    severity: 'warning',
    message: code,
    source: { file: '/project/src/workflow.ts', line: 1 },
  }
}

function definition(id: string, kind: ProjectDefinitionKind, name: string) {
  return {
    id,
    kind,
    name,
    fidelity: 'partial' as const,
    status: 'active' as const,
    source: { file: '/project/src/workflow.ts', line: 1 },
  }
}
