import ts from 'typescript'
import type { IndexDiagnostic, IndexLintFinding, ProjectDefinitionKind } from '@crux/core/project-index'
import { describe, expect, it } from 'vitest'
import {
  createIndexerExtensionRuntime,
  facts,
  isIndexerExtensionAllowed,
  none,
  resolveIndexerExtensionReferences,
  staticFoundDefinitionFromStaticExtractionResult,
  validateIndexerExtensionManifest,
  type IndexerExtension,
  type StaticExtractionInput,
} from '../indexer/extensions'
import { internalStaticCallContext, internalTypeScriptContext } from '../indexer/extensions/internal-native'
import { createExtractContext } from '../indexer/extensions/runtime'
import { indexLintFinding } from '../indexer/lints/rules'

describe('indexer extension runtime', () => {
  it('exposes deterministic manifest identity for unordered extension manifests', () => {
    const runtime = createIndexerExtensionRuntime({
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
              type: '@acme/alpha/uses_tool',
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
      {
        extension: { name: '@acme/alpha', version: '1' },
        name: 'alpha.define',
        patterns: [{ kind: 'call', name: 'defineAlpha' }],
      },
      {
        extension: { name: '@acme/zeta', version: '2' },
        name: 'z.first',
        patterns: [{ kind: 'call', name: 'zFirst' }],
      },
      {
        extension: { name: '@acme/zeta', version: '2' },
        name: 'z.second',
        patterns: [{ kind: 'call', name: 'zSecond' }],
      },
    ])
    expect(runtime.manifest.callNames).toEqual(['defineAlpha', 'zFirst', 'zSecond'])
    expect(runtime.manifest.relationSpecs.map((spec) => spec.type)).toEqual(['@acme/alpha/uses_tool'])
    expect(runtime.manifest.capabilities).toEqual(['static-extraction'])
    expect(runtime.manifest.cacheInputs).toEqual([
      { kind: 'extension', name: '@acme/alpha', version: '1' },
      { kind: 'extractor', extension: '@acme/alpha', name: 'alpha.define' },
      { kind: 'extension', name: '@acme/zeta', version: '2' },
      { kind: 'extractor', extension: '@acme/zeta', name: 'z.first' },
      { kind: 'extractor', extension: '@acme/zeta', name: 'z.second' },
    ])
  })

  it('projects extension rule metadata into descriptor entries', () => {
    const runtime = createIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/indexer',
          version: '1.2.3',
          rules: [
            {
              manifest: {
                id: '@acme/indexer/require-owner',
                docs: {
                  description: 'Require ownership metadata.',
                  url: 'https://example.com/rules/require-owner',
                },
                phase: 'semantic',
                requires: ['definitions', 'sources'],
                fidelity: 'best-effort',
                defaultSeverity: 'warning',
                schema: {
                  type: 'object',
                  properties: { ownerField: { type: 'string' } },
                },
                defaultOptions: [{ ownerField: 'owner' }],
              },
              messages: {
                missing: 'Missing owner.',
                invalid: 'Invalid owner.',
              },
              check: () => [],
            },
          ],
        }),
      ],
    })

    expect(runtime.ruleDescriptors).toEqual([
      {
        id: '@acme/indexer/require-owner',
        source: 'extension',
        extension: { name: '@acme/indexer', version: '1.2.3' },
        title: 'Require ownership metadata.',
        description: 'Require ownership metadata.',
        docsUrl: 'https://example.com/rules/require-owner',
        phase: 'semantic',
        requires: ['definitions', 'sources'],
        fidelity: 'best-effort',
        severity: 'warning',
        optionSchema: {
          type: 'object',
          properties: { ownerField: { type: 'string' } },
        },
        messageIds: ['invalid', 'missing'],
        defaultOptions: [{ ownerField: 'owner' }],
      },
    ])
  })

  it('runs a matching static extractor through stable readers and builders', () => {
    const runtime = createIndexerExtensionRuntime({
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

  it('runs a matching constructor extractor through stable readers and builders', () => {
    const runtime = createIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/agents',
          version: '1',
          extractors: [
            {
              name: 'agent.constructor',
              patterns: [{ kind: 'new', name: 'Agent' }],
              extract: (ctx) => {
                const id = ctx.config?.string('name') ?? ctx.source.localName
                return facts({
                  definitions: [
                    ctx.define.definition({
                      variableName: ctx.source.variableName,
                      id: `agent:${ctx.source.safeId(id)}`,
                      kind: 'agent',
                      name: id,
                      metadata: { matchKind: ctx.match.kind },
                    }),
                  ],
                })
              },
            },
          ],
        }),
      ],
    })

    expect(runtime.extractStatic(staticInput('new Agent({ name: "Writer" })'))).toEqual(
      expect.objectContaining({
        kind: 'matched',
        extractor: 'agent.constructor',
        facts: {
          definitions: [
            {
              variableName: 'workflow',
              definition: expect.objectContaining({
                id: 'agent:Writer',
                kind: 'agent',
                name: 'Writer',
                metadata: { matchKind: 'new' },
              }),
            },
          ],
        },
      }),
    )
  })

  it('runs a matching object-literal extractor through stable object readers and builders', () => {
    const runtime = createIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/tools',
          version: '1',
          extractors: [
            {
              name: 'tool.object',
              patterns: [{ kind: 'object' }],
              extract: (ctx) => {
                const name = ctx.config?.string('name')
                if (!name) return none()
                return facts({
                  definitions: [
                    ctx.define.definition({
                      variableName: ctx.source.variableName,
                      id: `tool:${ctx.source.safeId(name)}`,
                      kind: 'tool',
                      name,
                      metadata: { matchKind: ctx.match.kind },
                    }),
                  ],
                })
              },
            },
          ],
        }),
      ],
    })

    expect(runtime.extractStatic(staticInput('{ name: "search", description: "Search." }'))).toEqual(
      expect.objectContaining({
        kind: 'matched',
        extractor: 'tool.object',
        facts: {
          definitions: [
            {
              variableName: 'workflow',
              definition: expect.objectContaining({
                id: 'tool:search',
                kind: 'tool',
                name: 'search',
                metadata: { matchKind: 'object' },
              }),
            },
          ],
        },
      }),
    )
  })

  it('keeps native syntax access behind compiler-created handles', () => {
    const input = staticInput('defineWorkflow({ id: "publish" })')
    const extractor = {
      name: 'workflow.define',
      patterns: [{ kind: 'call' as const, name: 'defineWorkflow' }],
      extract: () => none(),
    }
    const ctx = createExtractContext(extension({ name: '@acme/workflows', version: '1' }), extractor, input)

    expect(internalStaticCallContext(ctx)).toBe(input)
    expect(internalTypeScriptContext(ctx)).toEqual({
      sourceFile: input.sourceFile,
      call: input.call,
      objectArg: input.objectArg,
    })

    const forgedCtx = {
      ...ctx,
      internalNative: {
        staticContext: input,
        typescript: {
          sourceFile: input.sourceFile,
          call: input.call,
          objectArg: input.objectArg,
        },
      },
    } as unknown as typeof ctx

    expect(internalStaticCallContext(forgedCtx)).toBeUndefined()
    expect(internalTypeScriptContext(forgedCtx)).toBeUndefined()
  })

  it('distinguishes no-match from a matched extractor that returned none', () => {
    const runtime = createIndexerExtensionRuntime({
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
    const runtime = createIndexerExtensionRuntime({
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
    const diagnostic = indexDiagnostic('index.workflow_degraded')
    const runtime = createIndexerExtensionRuntime({
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
    const runtime = createIndexerExtensionRuntime({
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

  it('runs index rules in deterministic runtime order without mutating index facts', () => {
    const workflow = definition('@acme.workflow:publish', 'workflow' as ProjectDefinitionKind, 'publish')
    const runtime = createIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/zeta',
          version: '1',
          rules: [
            {
              manifest: ruleManifest('@acme/zeta/second', 'z.second'),
              messages: { finding: 'z.second' },
              check: ({ definitions }) => [lintFinding(`z:${definitions.length}`)],
            },
            {
              manifest: ruleManifest('@acme/zeta/first', 'z.first'),
              messages: { finding: 'z.first' },
              check: ({ relations }) => [lintFinding(`z-first:${relations.length}`)],
            },
          ],
        }),
        extension({
          name: '@acme/alpha',
          version: '1',
          rules: [
            {
              manifest: ruleManifest('@acme/alpha/first', 'a.first'),
              messages: { finding: 'a.first' },
              check: ({ definitions }) => [lintFinding(`a:${definitions[0]?.id ?? 'none'}`)],
            },
          ],
        }),
      ],
    })

    expect(runtime.manifest.capabilities).toEqual(['static-extraction', 'index-rules'])
    expect(runtime.manifest.cacheInputs).toEqual([
      { kind: 'extension', name: '@acme/alpha', version: '1' },
      { kind: 'rule', extension: '@acme/alpha', name: '@acme/alpha/first' },
      { kind: 'extension', name: '@acme/zeta', version: '1' },
      { kind: 'rule', extension: '@acme/zeta', name: '@acme/zeta/first' },
      { kind: 'rule', extension: '@acme/zeta', name: '@acme/zeta/second' },
    ])
    expect(runtime.checkRules({ definitions: [workflow], relations: [] })).toMatchObject({
      outputs: [{ message: 'a:@acme.workflow:publish' }, { message: 'z-first:0' }, { message: 'z:1' }],
      diagnostics: [],
    })
    expect(workflow).toEqual(definition('@acme.workflow:publish', 'workflow' as ProjectDefinitionKind, 'publish'))
  })

  it('skips semantic-phase rules until semantic evidence is available', () => {
    const workflow = definition('@acme.workflow:publish', 'workflow' as ProjectDefinitionKind, 'publish')
    const sourceRef = { file: '/project/src/workflow.ts', line: 1 }
    const semantic = {
      resolveSymbol: () => ({ id: 'symbol:workflow', name: 'workflow' }),
      typeOf: () => ({ display: 'WorkflowDefinition' }),
      referencesOf: () => [sourceRef],
    }
    const runtime = createIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/semantic',
          version: '1',
          rules: [
            {
              manifest: {
                ...ruleManifest('@acme/semantic/require-type', 'semantic rule'),
                phase: 'semantic',
                requires: ['definitions'],
                fidelity: 'best-effort',
              },
              messages: { finding: 'semantic rule' },
              check: ({ definitions, semantic: semanticView }) => {
                const type = semanticView?.typeOf(definitions[0]?.source ?? sourceRef)
                return [lintFinding(type?.display ?? 'missing-semantic')]
              },
            },
          ],
        }),
      ],
    })

    expect(runtime.checkRules({ definitions: [workflow], relations: [] })).toMatchObject({
      outputs: [],
      diagnostics: [
        expect.objectContaining({
          code: 'index.rule_unavailable',
          severity: 'info',
          message: expect.stringContaining('@acme/semantic/require-type'),
        }),
      ],
    })
    expect(runtime.checkRules({ definitions: [workflow], relations: [], semantic }).outputs).toEqual([
      expect.objectContaining({ message: 'WorkflowDefinition' }),
    ])
  })

  it('fails extension runtime construction for malformed index rule metadata', () => {
    expect(() =>
      createIndexerExtensionRuntime({
        extensions: [
          extension({
            name: '@acme/broken',
            version: '1',
            rules: [
              {
                manifest: {
                  ...ruleManifest('broken.rule', ''),
                  requires: [],
                },
                messages: {},
                check: () => [],
              },
            ],
          }),
        ],
      }),
    ).toThrow(/rule manifest\.docs\.description is required/)
  })

  it('fails extension runtime construction for invalid rule manifest values', () => {
    expect(() =>
      createIndexerExtensionRuntime({
        extensions: [
          extension({
            name: '@acme/broken',
            version: '1',
            rules: [
              {
                manifest: {
                  ...ruleManifest('@acme/broken/invalid-fact', 'Invalid fact dependency.'),
                  requires: ['semantic' as 'definitions'],
                },
                messages: { finding: 'Invalid fact dependency.' },
                check: () => [],
              },
            ],
          }),
        ],
      }),
    ).toThrow(/rule manifest is invalid/)
  })

  it('fails extension runtime construction for duplicate index rule names', () => {
    expect(() =>
      createIndexerExtensionRuntime({
        extensions: [
          extension({
            name: '@acme/alpha',
            version: '1',
            rules: [
              {
                manifest: ruleManifest('@acme/alpha/require-owner', 'alpha owner'),
                messages: { finding: 'alpha owner' },
                check: () => [],
              },
              {
                manifest: ruleManifest('@acme/alpha/require-owner', 'duplicate owner'),
                messages: { finding: 'duplicate owner' },
                check: () => [],
              },
            ],
          }),
        ],
      }),
    ).toThrow(/Duplicate index rule: @acme\/alpha\/require-owner/)
  })

  it('rejects un-namespaced third-party relation and rule declarations', () => {
    const result = validateIndexerExtensionManifest(
      extension({
        name: '@acme/indexer',
        version: '1',
        relations: [
          {
            type: 'uses_tool',
            fromKinds: ['prompt'],
            toKinds: ['tool'],
            presentation: 'both',
            fidelity: 'resolved',
            runtimeJoin: false,
          },
        ],
        rules: [
          {
            manifest: ruleManifest('no-missing-owner', 'Require ownership metadata.'),
            messages: { missing: 'Missing owner.' },
            check: () => [],
          },
        ],
      }),
    )

    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toContain(
      '@acme/indexer: relation uses_tool must be prefixed with @acme/indexer/.',
    )
    expect(result.errors.join('\n')).toContain(
      '@acme/indexer: rule no-missing-owner must be prefixed with @acme/indexer/.',
    )
  })

  it('applies explicit extension trust policy before public loading', () => {
    expect(isIndexerExtensionAllowed({ name: '@crux/indexer/crux-core' })).toBe(true)
    expect(isIndexerExtensionAllowed({ name: '@acme/indexer' })).toBe(false)
    expect(
      isIndexerExtensionAllowed({ name: '@acme/indexer' }, { mode: 'allowlisted', allow: ['@acme/indexer'] }),
    ).toBe(true)
    expect(isIndexerExtensionAllowed({ name: '@acme/indexer' }, { mode: 'allowlisted', deny: ['@acme/indexer'] })).toBe(
      false,
    )
    expect(isIndexerExtensionAllowed({ name: '@acme/indexer' }, { mode: 'unsafe-local-dev' })).toBe(true)
  })

  it('resolves extension config references deterministically before package loading', () => {
    const result = resolveIndexerExtensionReferences({
      config: {
        extensions: [
          { package: '@acme/zeta', export: 'zeta', version: '^1.0.0' },
          { package: '@acme/disabled', enabled: false },
          { package: '@acme/alpha' },
        ],
        trust: { mode: 'allowlisted', allow: ['@acme/alpha', '@acme/zeta'] },
      },
      installed: [
        {
          package: '@acme/zeta',
          export: 'zeta',
          extension: extension({
            name: '@acme/zeta',
            version: '1.4.0',
            crux: { indexer: '^0.1.0', projectIndexSchema: 1 },
          }),
        },
        {
          package: '@acme/alpha',
          export: 'default',
          extension: extension({
            name: '@acme/alpha',
            version: '0.1.0',
            crux: { indexer: '^0.1.0', projectIndexSchema: 1 },
          }),
        },
      ],
    })

    expect(result.extensions.map((item) => item.extension.name)).toEqual(['@acme/alpha', '@acme/zeta'])
    expect(result.diagnostics).toEqual([])
  })

  it('reports trust and compatibility failures as loading diagnostics', () => {
    const result = resolveIndexerExtensionReferences({
      config: {
        extensions: [
          { package: '@acme/blocked' },
          { package: '@acme/incompatible' },
          { package: '@acme/missing' },
        ],
        trust: { mode: 'allowlisted', allow: ['@acme/incompatible'] },
      },
      installed: [
        { package: '@acme/blocked', export: 'default', extension: extension({ name: '@acme/blocked', version: '1.0.0' }) },
        {
          package: '@acme/incompatible',
          export: 'default',
          extension: extension({
            name: '@acme/incompatible',
            version: '1.0.0',
            crux: { indexer: '^99.0.0', projectIndexSchema: 1 },
          }),
        },
      ],
    })

    expect(result.extensions).toEqual([])
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'index.extension_not_allowed',
      'index.extension_incompatible',
      'index.extension_not_found',
    ])
  })
})

function extension(input: IndexerExtension): IndexerExtension {
  return input
}

function lintFinding(id: string): IndexLintFinding {
  return indexLintFinding({
    ruleId: 'definition.missing_eval_coverage',
    key: id,
    message: id,
    relatedDefinitionIds: [],
    evidence: [],
  })
}

function ruleManifest(id: string, description: string) {
  return {
    id,
    docs: { description },
    phase: 'index' as const,
    requires: ['definitions'] as const,
    fidelity: 'safe' as const,
    defaultSeverity: 'info' as const,
  }
}

function staticInput(sourceText: string): StaticExtractionInput {
  const file = '/project/src/workflow.ts'
  const sourceFile = ts.createSourceFile(file, `const workflow = ${sourceText}`, ts.ScriptTarget.Latest, true)
  const statement = sourceFile.statements[0]
  if (!ts.isVariableStatement(statement)) throw new Error('Expected variable statement fixture.')
  const declaration = statement.declarationList.declarations[0]
  if (
    !declaration?.initializer ||
    (!ts.isCallExpression(declaration.initializer) &&
      !ts.isNewExpression(declaration.initializer) &&
      !ts.isObjectLiteralExpression(declaration.initializer))
  ) {
    throw new Error('Expected call, constructor, or object initializer fixture.')
  }
  const call = declaration.initializer
  const args = ts.isCallExpression(call) || ts.isNewExpression(call) ? [...(call.arguments ?? [])] : []
  const firstArg = args[0]
  const objectArg = ts.isObjectLiteralExpression(call)
    ? call
    : firstArg && ts.isObjectLiteralExpression(firstArg)
      ? firstArg
      : undefined
  const callName = ts.isObjectLiteralExpression(call) ? 'object' : call.expression.getText(sourceFile)
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

function indexDiagnostic(code: string): IndexDiagnostic {
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
