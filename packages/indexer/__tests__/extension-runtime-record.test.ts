import type { ProjectDefinitionKind } from '@use-crux/core/project-index'
import { describe, expect, it } from 'vitest'
import { createIndexerExtensionRuntime, facts, type IndexerExtension } from '../indexer/extensions'
import { cruxCoreExtension } from '../indexer/extractors/crux-core-extension'
import { createStaticExtraction } from '../indexer/static/extraction/engine'
import { parseStaticDefinitionsFromFacts, staticParseResultFromFacts } from '../indexer/static/file'
import { createParseMemo, type SourceReader } from '../indexer/static/extraction/source-io'
import {
  createTypeScriptStaticSyntaxFrontend,
  parseStaticFactsFromSyntaxRecords,
} from '../indexer/static-index/syntax'
import { createStaticExtractionParser } from '../indexer/static/extraction/parser'

describe('indexer extension record runtime', () => {
  it('runs a matching static extractor from syntax records through stable readers and builders', async () => {
    const runtime = createIndexerExtensionRuntime({
      extensions: [
        extension({
          name: '@acme/workflows',
          version: '1',
          extractors: [
            {
              name: 'workflow.define',
              patterns: [{ kind: 'call', name: 'defineWorkflow', importFrom: ['@acme/workflows'] }],
              extract: (ctx) => {
                const name = ctx.args.string(0) ?? 'missing'
                const target = ctx.config?.reference('target') ?? 'missing'
                return facts({
                  definitions: [
                    ctx.define.definition({
                      variableName: ctx.source.variableName,
                      id: `@acme.workflow:${ctx.config?.string('id') ?? ctx.source.localName}`,
                      kind: 'workflow' as ProjectDefinitionKind,
                      name,
                      metadata: {
                        enabled: ctx.config?.boolean('enabled'),
                        tags: ctx.config?.stringArray('tags'),
                        target,
                        nestedMode: ctx.config?.object('nested')?.string('mode'),
                        matchKind: ctx.match.kind,
                      },
                    }),
                  ],
                  references: [ctx.ref.variable('@acme.workflow/uses_tool', target)],
                })
              },
            },
          ],
        }),
      ],
    })
    const frontend = createTypeScriptStaticSyntaxFrontend({ callNames: ['defineWorkflow'] })
    const record = await frontend.parseFile({
      root: '/project',
      file: '/project/src/workflow.ts',
      source: [
        "import { defineWorkflow as define } from '@acme/workflows'",
        'const writerTool = tool({ name: "writer" })',
        "export const workflow = define('publish', {",
        "  id: 'publish',",
        '  enabled: true,',
        "  tags: ['release'],",
        '  target: writerTool,',
        "  nested: { mode: 'fast' },",
        '})',
      ].join('\n'),
    })

    const match = record.matches.find((item) => item.variableName === 'workflow')

    expect(match).toBeDefined()
    expect(
      runtime.extractStaticRecord({
        root: '/project',
        record,
        match: match!,
      }),
    ).toEqual({
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
              metadata: expect.objectContaining({
                enabled: true,
                tags: ['release'],
                target: 'writerTool',
                nestedMode: 'fast',
                matchKind: 'call',
              }),
            }),
          },
        ],
        references: [{ type: '@acme.workflow/uses_tool', toVariable: 'writerTool' }],
      },
    })
  })

  it('preserves first-party prompt references from syntax-record config readers', async () => {
    const runtime = createIndexerExtensionRuntime({ extensions: [cruxCoreExtension] })
    const frontend = createTypeScriptStaticSyntaxFrontend({ callNames: runtime.manifest.callNames })
    const record = await frontend.parseFile({
      root: '/project',
      file: '/project/src/prompt.ts',
      source: [
        'const guardrails = [privacyGuardrail]',
        'export const writer = prompt({',
        "  id: 'writer',",
        '  use: [brandContext],',
        '  tools: { search: searchTool },',
        '  constraints: [policyConstraint],',
        '  guardrails,',
        "  prompt: 'Write',",
        '})',
      ].join('\n'),
    })
    const match = record.matches.find((item) => item.variableName === 'writer')

    expect(match).toBeDefined()
    const result = runtime.extractStaticRecord({ root: '/project', record, match: match! })

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'matched',
        extractor: 'prompt',
        facts: expect.objectContaining({
          definitions: [
            expect.objectContaining({
              definition: expect.objectContaining({
                id: 'prompt:writer',
                metadata: expect.objectContaining({
                  facts: expect.objectContaining({
                    use: ['brandContext'],
                    useEntries: [expect.objectContaining({ variable: 'brandContext' })],
                    tools: {
                      hasTools: true,
                      names: ['search'],
                      variables: ['searchTool'],
                    },
                    constraints: ['policyConstraint'],
                    guardrails: ['privacyGuardrail'],
                  }),
                }),
              }),
            }),
          ],
          references: expect.arrayContaining([
            expect.objectContaining({ type: 'prompt.uses_context', toVariable: 'brandContext' }),
            expect.objectContaining({ type: 'prompt.uses_tool', toVariable: 'searchTool' }),
            expect.objectContaining({ type: 'constraint.applies_to', fromVariable: 'policyConstraint' }),
            expect.objectContaining({ type: 'guardrail.applies_to', fromVariable: 'privacyGuardrail' }),
          ]),
        }),
      }),
    )
  })

  it('preserves first-party callback source refs from syntax records', async () => {
    const runtime = createIndexerExtensionRuntime({ extensions: [cruxCoreExtension] })
    const frontend = createTypeScriptStaticSyntaxFrontend({ callNames: runtime.manifest.callNames })
    const record = await frontend.parseFile({
      root: '/project',
      file: '/project/src/prompt.ts',
      source: [
        "const promptBody = () => 'Write'",
        'export const writer = prompt({',
        "  id: 'writer',",
        '  prompt: promptBody,',
        '})',
      ].join('\n'),
    })
    const match = record.matches.find((item) => item.variableName === 'writer')

    expect(match).toBeDefined()
    const result = runtime.extractStaticRecord({ root: '/project', record, match: match! })

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'matched',
        facts: expect.objectContaining({
          sourceRefs: [
            expect.objectContaining({
              definitionId: 'prompt:writer',
              ref: expect.objectContaining({
                id: 'prompt:writer:source:prompt:prompt:promptBody',
                role: 'prompt',
                property: 'prompt',
                symbol: 'promptBody',
                source: expect.objectContaining({ file: '/project/src/prompt.ts', line: 1, column: 20 }),
                snippet: expect.objectContaining({ source: "() => 'Write'" }),
              }),
            }),
          ],
        }),
      }),
    )
  })

  it('extracts first-party router definitions from syntax records', async () => {
    const runtime = createIndexerExtensionRuntime({ extensions: [cruxCoreExtension] })
    const frontend = createTypeScriptStaticSyntaxFrontend({ callNames: runtime.manifest.callNames })
    const record = await frontend.parseFile({
      root: '/project',
      file: '/project/src/router.ts',
      source: [
        "const classifyRoute = () => 'default'",
        'export const qualityRouter = router({',
        "  id: 'quality-router',",
        '  routes: { default: writerPrompt },',
        '  classify: classifyRoute,',
        '})',
      ].join('\n'),
    })
    const match = record.matches.find((item) => item.variableName === 'qualityRouter')

    expect(match).toBeDefined()
    const result = runtime.extractStaticRecord({ root: '/project', record, match: match! })

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'matched',
        extractor: 'routing',
        facts: expect.objectContaining({
          definitions: [
            expect.objectContaining({
              definition: expect.objectContaining({
                id: 'routing.router:quality-router',
                kind: 'routing.router',
                metadata: expect.objectContaining({
                  routeKeys: ['default'],
                  routeCount: 1,
                  hasDefaultRoute: true,
                  hasClassify: true,
                }),
              }),
              extraDefinitions: [
                expect.objectContaining({
                  id: 'routing.router:quality-router:route:default',
                  kind: 'routing.router.route',
                  metadata: expect.objectContaining({ targetVariable: 'writerPrompt' }),
                }),
              ],
            }),
          ],
          references: expect.arrayContaining([
            expect.objectContaining({
              type: 'router.includes_route',
              toId: 'routing.router:quality-router:route:default',
            }),
            expect.objectContaining({
              type: 'router.route.uses_router',
              fromId: 'routing.router:quality-router:route:default',
              toVariable: 'writerPrompt',
            }),
          ]),
          sourceRefs: [
            expect.objectContaining({
              definitionId: 'routing.router:quality-router',
              ref: expect.objectContaining({ role: 'callback', property: 'classify', symbol: 'classifyRoute' }),
            }),
          ],
        }),
      }),
    )
  })

  it('matches the TypeScript parser for cascade and fallback routing facts', async () => {
    const root = '/project'
    const file = '/project/src/routing.ts'
    const runtime = createIndexerExtensionRuntime({ extensions: [cruxCoreExtension] })
    const files = {
      [file]: [
        "const accepted = () => true",
        'export const qualityFallback = fallback(writerAgent, writerPrompt, {',
        "  id: 'quality-fallback',",
        '  timeoutMs: 5000,',
        '})',
        'export const qualityCascade = cascade({',
        "  id: 'quality-cascade',",
        '  budget: { cost: 0.75 },',
        '  tiers: [',
        "    { model: cheapModel, budget: 0.75, note: 'cheap pass', evaluate: accepted },",
        '    { model: qualityFallback },',
        '  ],',
        '})',
      ].join('\n'),
    }

    const ast = await parseStaticDefinitionsFromFacts(
      root,
      file,
      createStaticExtractionParser(runtime),
      createParseMemo(memorySourceReader(files)),
    )
    const record = staticParseResultFromFacts(
      await parseStaticFactsFromSyntaxRecords({
        root,
        file,
        runtime,
        parseMemo: createParseMemo(memorySourceReader(files)),
      }),
    )

    expect(projectedRoutingFacts(record)).toEqual(projectedRoutingFacts(ast))
  })

  it('matches the TypeScript parser for file-level first-party definitions and relations', async () => {
    const root = '/project'
    const file = '/project/src/prompt.ts'
    const runtime = createIndexerExtensionRuntime({ extensions: [cruxCoreExtension] })
    const files = {
      '/project/src/context.ts': "export const brandContext = context({ id: 'brand' })",
      [file]: [
        "import { brandContext } from './context'",
        "export const searchTool = createTool({ name: 'search' })",
        'export const writer = prompt({',
        "  id: 'writer',",
        '  use: [brandContext],',
        '  tools: { search: searchTool },',
        "  prompt: 'Write',",
        '})',
      ].join('\n'),
    }

    const ast = await parseStaticDefinitionsFromFacts(
      root,
      file,
      createStaticExtractionParser(runtime),
      createParseMemo(memorySourceReader(files)),
    )
    const record = staticParseResultFromFacts(
      await parseStaticFactsFromSyntaxRecords({
        root,
        file,
        runtime,
        parseMemo: createParseMemo(memorySourceReader(files)),
      }),
    )

    expect(projectedCore(ast)).toEqual(projectedCore(record))
  })

  it('matches the TypeScript parser for prompt and context tree path projections', async () => {
    const root = '/project'
    const file = '/project/src/index.ts'
    const runtime = createIndexerExtensionRuntime({ extensions: [cruxCoreExtension] })
    const files = {
      '/project/src/prompts.ts': [
        "export const draftEdit = prompt({ id: 'draft-edit' })",
        "export const seoEdit = prompt({ id: 'seo-edit' })",
      ].join('\n'),
      '/project/src/contexts.ts': [
        "export const currentDate = context({ id: 'current-date' })",
        "export const brand = context({ id: 'brand-context' })",
      ].join('\n'),
      [file]: [
        "import { draftEdit, seoEdit } from './prompts'",
        "import { currentDate, brand } from './contexts'",
        'export const localPrompt = prompt({ id: "local-prompt" })',
        'export const localContext = context({ id: "local-context" })',
        'export const prompts = createPrompts({',
        '  editor: { edit: draftEdit, seo: seoEdit },',
        '  local: localPrompt,',
        '})',
        'export const contexts = createContexts({',
        '  currentDate,',
        '  brand: { voice: brand },',
        '  local: localContext,',
        '})',
      ].join('\n'),
    }

    const ast = await parseStaticDefinitionsFromFacts(
      root,
      file,
      createStaticExtractionParser(runtime),
      createParseMemo(memorySourceReader(files)),
    )
    const record = staticParseResultFromFacts(
      await parseStaticFactsFromSyntaxRecords({
        root,
        file,
        runtime,
        parseMemo: createParseMemo(memorySourceReader(files)),
      }),
    )

    expect(projectedPaths(record)).toEqual(projectedPaths(ast))
  })

  it('matches the TypeScript parser for local schema metadata and source refs', async () => {
    const root = '/project'
    const file = '/project/src/prompt.ts'
    const runtime = createIndexerExtensionRuntime({ extensions: [cruxCoreExtension] })
    const files = {
      [file]: [
        'const promptInput = z.object({',
        "  query: z.string().describe('Question to research'),",
        "  tags: z.array(z.string()).min(1).max(3),",
        "  locale: z.string().default('en'),",
        '  optionalScore: z.number().optional(),',
        '})',
        'export const writer = prompt({',
        "  id: 'writer',",
        '  input: promptInput,',
        "  prompt: 'Write',",
        '})',
      ].join('\n'),
    }

    const ast = await parseStaticDefinitionsFromFacts(
      root,
      file,
      createStaticExtractionParser(runtime),
      createParseMemo(memorySourceReader(files)),
    )
    const record = staticParseResultFromFacts(
      await parseStaticFactsFromSyntaxRecords({
        root,
        file,
        runtime,
        parseMemo: createParseMemo(memorySourceReader(files)),
      }),
    )

    expect(projectedSchemas(record)).toEqual(projectedSchemas(ast))
  })

  it('matches the TypeScript parser for memory and blackboard stable-reader facts', async () => {
    const root = '/project'
    const file = '/project/src/memory.ts'
    const runtime = createIndexerExtensionRuntime({ extensions: [cruxCoreExtension] })
    const files = {
      [file]: [
        'const sessionStore = upstashStore({ component: components.crux })',
        'export const sessionMemory = memory({',
        "  id: 'session',",
        '  blocks: [workingState({',
        "    id: 'profile',",
        '    priority: 2,',
        '    schema: z.object({ name: z.string() }),',
        "    write: { mode: 'replace' },",
        '  })],',
        '  store: sessionStore,',
        '})',
        'export const threadBoard = blackboard({',
        "  id: 'thread',",
        '  schema: z.object({ intent: z.enum([\'create\', \'edit\']) }),',
        "  conflictPolicy: 'last-write-wins',",
        '  store: upstashStore({ component: components.crux }),',
        '})',
      ].join('\n'),
    }

    const ast = await parseStaticDefinitionsFromFacts(
      root,
      file,
      createStaticExtractionParser(runtime),
      createParseMemo(memorySourceReader(files)),
    )
    const record = staticParseResultFromFacts(
      await parseStaticFactsFromSyntaxRecords({
        root,
        file,
        runtime,
        parseMemo: createParseMemo(memorySourceReader(files)),
      }),
    )

    expect(projectedMemoryFacts(record)).toEqual(projectedMemoryFacts(ast))
  })

  it('matches the TypeScript parser for Convex Agent stable-reader facts', async () => {
    const root = '/project'
    const file = '/project/src/agent.ts'
    const runtime = createIndexerExtensionRuntime({ extensions: [cruxCoreExtension] })
    const files = {
      [file]: [
        "const usageHandler = () => 'usage'",
        "const prepareAgent = () => 'ready'",
        'const agentTools = { searchTool }',
        'export const profileAgent = new Agent({',
        "  name: 'Profile Writer',",
        '  prompt: profilePrompt,',
        '  tools: agentTools,',
        '  usageHandler,',
        '  prepare: prepareAgent,',
        '})',
      ].join('\n'),
    }

    const ast = await parseStaticDefinitionsFromFacts(
      root,
      file,
      createStaticExtractionParser(runtime),
      createParseMemo(memorySourceReader(files)),
    )
    const record = staticParseResultFromFacts(
      await parseStaticFactsFromSyntaxRecords({
        root,
        file,
        runtime,
        parseMemo: createParseMemo(memorySourceReader(files)),
      }),
    )

    expect(projectedAgentFacts(record)).toEqual(projectedAgentFacts(ast))
  })

  it('matches the TypeScript parser for flow steps and suspensions', async () => {
    const root = '/project'
    const file = '/project/src/flow.ts'
    const runtime = createIndexerExtensionRuntime({ extensions: [cruxCoreExtension] })
    const files = {
      [file]: [
        "export const writerFlow = flow('writer-flow', async (flow) => {",
        "  await flow.step('draft', writerAgent)",
        "  await flow.waitFor('draft-approved')",
        "  return flow.step('review', writerPrompt)",
        '})',
        'export const convexWriter = cruxFlow({',
        "  name: 'convex-writer',",
        "  args: { query: z.string() },",
        '  handler: async (flow) => {',
        "    await flow.step('draft', writerAgent)",
        "    await flow.suspend('approval')",
        '  },',
        '})',
      ].join('\n'),
    }

    const ast = await parseStaticDefinitionsFromFacts(
      root,
      file,
      createStaticExtractionParser(runtime),
      createParseMemo(memorySourceReader(files)),
    )
    const record = staticParseResultFromFacts(
      await parseStaticFactsFromSyntaxRecords({
        root,
        file,
        runtime,
        parseMemo: createParseMemo(memorySourceReader(files)),
      }),
    )

    expect(projectedFlowFacts(record)).toEqual(projectedFlowFacts(ast))
  })

})

function extension(input: IndexerExtension): IndexerExtension {
  return input
}

function memorySourceReader(files: Readonly<Record<string, string>>): SourceReader {
  return {
    read: async (file) => {
      const source = files[file]
      if (source === undefined) throw new Error(`Missing fixture source: ${file}`)
      return source
    },
  }
}

function projectedCore(result: {
  readonly definitions: readonly { readonly id: string; readonly kind: string; readonly metadata?: unknown }[]
  readonly relations: readonly { readonly type: string; readonly from: string; readonly to: string }[]
}) {
  return {
    definitions: result.definitions
      .map((definition) => ({
        id: definition.id,
        kind: definition.kind,
        facts: isRecord(definition.metadata) ? definition.metadata.facts : undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    relations: result.relations
      .map((relation) => ({ type: relation.type, from: relation.from, to: relation.to }))
      .sort((a, b) => `${a.type}:${a.from}:${a.to}`.localeCompare(`${b.type}:${b.from}:${b.to}`)),
  }
}

function projectedPaths(result: {
  readonly definitions: readonly {
    readonly id: string
    readonly kind: string
    readonly path?: readonly string[]
  }[]
}) {
  return result.definitions
    .filter((definition) => definition.path)
    .map((definition) => ({ id: definition.id, kind: definition.kind, path: definition.path }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function projectedSchemas(result: {
  readonly definitions: readonly {
    readonly id: string
    readonly metadata?: unknown
    readonly sourceRefs?: readonly { readonly role: string; readonly property?: string; readonly symbol?: string }[]
  }[]
}) {
  return result.definitions
    .map((definition) => ({
      id: definition.id,
      inputSchema: isRecord(definition.metadata) ? definition.metadata.inputSchema : undefined,
      schemaRefs: definition.sourceRefs
        ?.filter((ref) => ref.role === 'schema')
        .map((ref) => ({ property: ref.property, symbol: ref.symbol })),
    }))
    .filter((definition) => definition.inputSchema || (definition.schemaRefs?.length ?? 0) > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
}

function projectedMemoryFacts(result: {
  readonly definitions: readonly {
    readonly id: string
    readonly kind: string
    readonly metadata?: unknown
  }[]
}) {
  return result.definitions
    .filter((definition) => ['memory', 'memory.block', 'memory.store', 'blackboard'].includes(definition.kind))
    .map((definition) => {
      const metadata = isRecord(definition.metadata) ? definition.metadata : {}
      return {
        id: definition.id,
        kind: definition.kind,
        backend: metadata.backend,
        blockCount: metadata.blockCount,
        schema: metadata.schema,
        priority: metadata.priority,
        writeMode: metadata.writeMode,
        component: metadata.component,
        conflictPolicy: metadata.conflictPolicy,
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

function projectedAgentFacts(result: {
  readonly definitions: readonly {
    readonly id: string
    readonly kind: string
    readonly metadata?: unknown
    readonly sourceRefs?: readonly { readonly role: string; readonly property?: string; readonly symbol?: string }[]
  }[]
  readonly relations: readonly { readonly type: string; readonly from: string; readonly to: string }[]
}) {
  return {
    definitions: result.definitions
      .filter((definition) => definition.kind === 'agent')
      .map((definition) => {
        const metadata = isRecord(definition.metadata) ? definition.metadata : {}
        return {
          id: definition.id,
          runtime: metadata.runtime,
          hasTools: metadata.hasTools,
          hasUsageHandler: metadata.hasUsageHandler,
          hasPrepare: metadata.hasPrepare,
          sourceRefs: definition.sourceRefs
            ?.map((ref) => ({ role: ref.role, property: ref.property, symbol: ref.symbol }))
            .sort((a, b) => `${a.property}:${a.symbol}`.localeCompare(`${b.property}:${b.symbol}`)),
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id)),
    relations: result.relations
      .filter((relation) => relation.from === 'agent:Profile-Writer')
      .map((relation) => ({ type: relation.type, to: relation.to }))
      .sort((a, b) => `${a.type}:${a.to}`.localeCompare(`${b.type}:${b.to}`)),
  }
}

function projectedRoutingFacts(result: {
  readonly definitions: readonly {
    readonly id: string
    readonly kind: string
    readonly metadata?: unknown
  }[]
  readonly relations: readonly { readonly type: string; readonly from: string; readonly to: string }[]
}) {
  return {
    definitions: result.definitions
      .filter((definition) => definition.kind.startsWith('routing.'))
      .map((definition) => {
        const metadata = isRecord(definition.metadata) ? definition.metadata : {}
        return {
          id: definition.id,
          kind: definition.kind,
          routingId: metadata.routingId,
          tierCount: metadata.tierCount,
          optionCount: metadata.optionCount,
          budget: metadata.budget,
          targetVariable: metadata.targetVariable,
          note: metadata.note,
          hasEvaluate: metadata.hasEvaluate,
          options: metadata.options,
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id)),
    relations: result.relations
      .filter(
        (relation) =>
          relation.type.startsWith('cascade.') ||
          relation.type.startsWith('fallback.') ||
          relation.type === 'router.includes_route',
      )
      .map((relation) => ({ type: relation.type, from: relation.from, to: relation.to }))
      .sort((a, b) => `${a.type}:${a.from}:${a.to}`.localeCompare(`${b.type}:${b.from}:${b.to}`)),
  }
}

function projectedFlowFacts(result: {
  readonly definitions: readonly {
    readonly id: string
    readonly kind: string
    readonly name: string
    readonly metadata?: unknown
  }[]
  readonly relations: readonly { readonly type: string; readonly from: string; readonly to: string }[]
}) {
  return {
    definitions: result.definitions
      .filter((definition) => definition.kind === 'flow' || definition.kind === 'flow.step')
      .map((definition) => {
        const metadata = isRecord(definition.metadata) ? definition.metadata : {}
        const facts = isRecord(metadata.facts) ? metadata.facts : {}
        return {
          id: definition.id,
          kind: definition.kind,
          name: definition.name,
          stepNames: metadata.stepNames,
          hasArgs: facts.hasArgs,
          runtime: facts.runtime,
          flowId: facts.flowId,
          stepLabel: facts.stepLabel,
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id)),
    relations: result.relations
      .filter((relation) => relation.type.startsWith('flow.'))
      .map((relation) => ({ type: relation.type, from: relation.from, to: relation.to }))
      .sort((a, b) => `${a.type}:${a.from}:${a.to}`.localeCompare(`${b.type}:${b.from}:${b.to}`)),
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}
