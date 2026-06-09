import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import { collectTopLevelInitializers } from '../indexer/ast/initializers'
import { readSourceFile } from '../indexer/ast/parse'
import { sourceForNode, sourceSnippetForNode } from '../indexer/ast/snippets'
import { createStaticExtractContextForTesting } from '../indexer/extensions/static-adapter'
import { safeId } from '../indexer/definitions'
import { indexerExtensionRegistry } from '../indexer/extractors/registry'
import { parseStaticFacts, staticParseResultFromFacts } from '../indexer/static/file'
import { staticDefinitionForTesting, staticFactParser } from '../indexer/static/parser'
import type { StaticCallContext } from '../indexer/extractors/types'
import type { ExtractedFacts } from '../indexer/extensions'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('extension extractor parity', () => {
  it.each([
    ['prompt', `export const value = prompt({ id: 'hello', use: [ctx], system: systemText })`],
    ['context', `export const value = context({ id: 'ctx', input: schema, resolve })`],
    [
      'injectable',
      `export const value = injectable({ id: 'injectable', input: schema, inject: () => ({ contexts: [ctx], tools: { searchTool } }) })`,
    ],
    ['tool', `export const value = tool({ name: 'search', parameters: schema, execute })`],
    [
      'agent',
      `export const value = agent({ id: 'writer', prompt: writingPrompt, tools: [searchTool], handoffs: ['editor'] })`,
    ],
    ['composition', `export const value = parallel({ agents: { writer, editor } })`],
    ['memory', `export const value = memory({ id: 'notes', blocks: [workingState({ id: 'work', schema })] })`],
    ['blackboard', `export const value = blackboard({ id: 'board', schema })`],
    ['eval', `export const value = evaluation({ name: 'quality', prompt: writingPrompt })`],
    ['routing', `export const value = router({ id: 'router', routes: { default: writer }, classify })`],
    ['flow', `export const value = flow('draft', async (step) => { await step.step('write', writer) })`],
    [
      'rag pipeline',
      `export const value = retrievalPipeline(docs, [{ name: 'retrieve', retriever: docs, scorer: judge }])`,
    ],
  ])('matches parser-facing output for %s', async (_name, source) => {
    const root = await fixtureRoot()
    const file = join(root, 'src/index.ts')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(file, fixtureSource(source))

    const sourceFile = await readSourceFile(file)
    const localInitializers = new Map<string, ts.Expression>()
    collectTopLevelInitializers(sourceFile, localInitializers)
    const initializer = localInitializers.get('value')
    expect(initializer).toBeDefined()
    expect(initializer && ts.isCallExpression(initializer)).toBe(true)
    if (!initializer || !ts.isCallExpression(initializer)) return

    const callName = staticFactParser.expressionName(initializer.expression)
    expect(callName).toBeTruthy()
    if (!callName) return

    const staticCtx = staticCallContext(root, file, sourceFile, initializer, callName, localInitializers)
    const parserFacts = staticFactParser.staticFactsFromInitializer(
      root,
      file,
      sourceFile,
      'value',
      initializer,
      localInitializers,
    )
    const extensionFacts = extractWithRegisteredExtension(staticCtx)

    expect(normalizeFacts(extensionFacts)).toEqual(normalizeFacts(parserFacts))
  })
})

describe('fact-first static parser', () => {
  it('projects extracted facts into index definitions, relations, and dependencies', async () => {
    const root = await fixtureRoot()
    const sourceFile = join(root, 'src/index.ts')
    const importedFile = join(root, 'src/shared.ts')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(
      importedFile,
      fixtureSource(`
        export const importedPrompt = prompt({ id: 'imported' })
        export const importedContext = context({ id: 'importedContext' })
        export const importedTool = tool({ name: 'importedTool' })
      `),
    )
    await writeFile(
      sourceFile,
      fixtureSource(`
        import { importedPrompt, importedTool } from './shared'

        export const exportedTool = tool({ name: 'exportedTool' })
        export const seoInjectable = injectable({
          id: 'seo',
          input: schema,
          inject: () => ({
            contexts: [importedContext],
            tools: { importedTool },
          }),
        })
        export const exportedContext = context({
          id: 'exportedContext',
          input: z.object({ locale: z.string() }),
          use: [when(() => true, seoInjectable), memory],
          tools: { exportedTool },
        })
        export const exportedPrompt = prompt({
          id: 'exported',
          input: z.object({ brief: z.string() }),
          use: [
            exportedContext,
            match({
              on: () => 'default',
              cases: { imported: importedContext },
              default: seoInjectable,
            }),
          ],
          tools: { importedTool },
        })
        export const exportedAgent = agent({
          id: 'exportedAgent',
          prompt: importedPrompt,
          tools: [importedTool, exportedTool],
        })
        export const exportedRouter = router({
          id: 'router',
          routes: { main: exportedAgent },
          classify,
        })
        export const exportedFlow = flow('draft', async (step) => {
          await step.step('write', exportedAgent)
        })

        const localPrompt = prompt({ id: 'local' })
        const localAgent = new Agent({ name: 'Local Agent', prompt: localPrompt })
        tool({ name: 'inlineTool' })

        export const promptTree = createPrompts({ nested: { imported: importedPrompt, local: localPrompt } })
      `),
    )

    const facts = await parseStaticFacts(root, sourceFile, staticFactParser)
    const projected = staticParseResultFromFacts(facts)

    expect(projected.dependencies).toEqual([importedFile])
    expect(projected.definitions.map((definition) => definition.id)).toEqual(
      expect.arrayContaining([
        'context:exportedContext',
        'prompt:exported',
        'injectable:seo',
        'tool:exportedTool',
        'agent:exportedAgent',
        'routing.router:router',
        'flow:draft',
        'prompt:local',
        'agent:Local-Agent',
        'tool:inlineTool',
        'prompt:imported',
      ]),
    )
    expect(byId(projected.definitions, 'injectable:seo')?.metadata?.facts).toEqual(
      expect.objectContaining({
        kind: 'injectable',
        mayInject: expect.arrayContaining(['contexts', 'tools']),
        useEntries: expect.arrayContaining([expect.objectContaining({ variable: 'importedContext' })]),
      }),
    )
    expect(projected.relations.map((relation) => relation.type)).toEqual(
      expect.arrayContaining([
        'prompt.uses_context',
        'prompt.uses_injectable',
        'prompt.uses_tool',
        'context.uses_injectable',
        'context.uses_memory',
        'context.uses_tool',
        'injectable.uses_context',
        'injectable.uses_tool',
        'agent.uses_prompt',
        'agent.uses_tool',
        'router.includes_route',
        'router.route.uses_agent',
        'flow.includes_step',
        'flow.step.uses_agent',
      ]),
    )
    expect(
      projected.definitions.some(
        (definition) => definition.id === 'prompt:imported' && definition.path?.join('/') === 'nested/imported',
      ),
    ).toBe(true)
    expect(byId(projected.definitions, 'prompt:exported')?.metadata?.intelligence?.dependencies).toEqual(
      expect.objectContaining({
        contexts: expect.arrayContaining(['context:exportedContext']),
        injectables: expect.arrayContaining(['injectable:seo']),
        tools: expect.arrayContaining(['tool:importedTool']),
      }),
    )
    const exportedPromptFacts = byId(projected.definitions, 'prompt:exported')?.metadata?.facts
    expect(exportedPromptFacts?.kind).toBe('prompt')
    expect(exportedPromptFacts?.kind === 'prompt' ? exportedPromptFacts.tools : undefined).toEqual(
      expect.objectContaining({
        hasTools: true,
        names: expect.arrayContaining(['importedTool']),
        variables: expect.arrayContaining(['importedTool']),
      }),
    )
    const promptContract = byId(projected.definitions, 'prompt:exported')?.metadata?.intelligence?.contract
    expect(promptContract?.inputSchema).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ brief: expect.any(Object) }),
      }),
    )
    expect(promptContract?.expandedInputSchema).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          brief: expect.any(Object),
          locale: expect.any(Object),
          value: expect.any(Object),
        }),
        required: expect.arrayContaining(['brief', 'locale']),
      }),
    )
    expect(promptContract?.expandedInputSchema?.required).not.toContain('value')
    expect(promptContract?.inputContributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'locale',
          sourceDefinitionId: 'context:exportedContext',
          conditionality: 'always',
          required: true,
        }),
        expect.objectContaining({
          field: 'value',
          sourceDefinitionId: 'injectable:seo',
          conditionality: 'match-default',
          branch: 'default',
          required: false,
        }),
      ]),
    )
  })
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.tmp-extension-parity-'))
  roots.push(root)
  return root
}

function fixtureSource(source: string): string {
  return `
    const schema = z.object({ value: z.string() })
    const systemText = 'system'

    function resolve() { return 'ctx' }
    function execute() { return memory.get('x') }
    function classify() { return 'default' }

    const ctx = context({ id: 'ctx' })
    const writingPrompt = prompt({ id: 'writing' })
    const searchTool = tool({ name: 'search' })
    const writer = agent({ id: 'writer' })
    const editor = agent({ id: 'editor' })
    const memory = memory({ id: 'mem' })
    const docs = retriever({ id: 'docs' })
    const judge = llmJudge({ id: 'judge' })

    ${source}
  `
}

function staticCallContext(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  callName: string,
  localInitializers: Map<string, ts.Expression>,
): StaticCallContext {
  const firstArg = call.arguments[0]
  const objectArg = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
  const source = sourceForNode(sourceFile, call)
  const snippet = sourceSnippetForNode(sourceFile, call)
  return {
    root,
    file,
    sourceFile,
    variableName: 'value',
    call,
    callName,
    firstArg,
    objectArg,
    source,
    snippet,
    localName: 'value',
    localInitializers,
    helpers: {
      safeId,
      schemaProperty: () => undefined,
      define: (id, kind, name, objectArgValue, metadata) =>
        staticDefinitionForTesting(file, id, kind, name, objectArgValue, source, snippet, metadata),
      relationRef: (type, target) => ({ type, ...target }),
    },
    safeId,
    define: (id, kind, name, objectArgValue, metadata) =>
      staticDefinitionForTesting(file, id, kind, name, objectArgValue, source, snippet, metadata),
  }
}

function extractWithRegisteredExtension(ctx: StaticCallContext): ExtractedFacts | undefined {
  const registered = indexerExtensionRegistry.extractors.find((item) =>
    item.extractor.patterns.some((pattern) => pattern.kind === 'call' && pattern.name === ctx.callName),
  )
  expect(registered).toBeDefined()
  if (!registered) return undefined
  const result = registered.extractor.extract(
    createStaticExtractContextForTesting(registered.extension, registered.extractor, ctx),
  )
  return result.kind === 'facts' ? result.facts : undefined
}

function normalizeFacts(facts: ExtractedFacts | undefined): unknown {
  if (!facts) return undefined
  return sortObject({
    definitions: [...(facts.definitions ?? [])].sort((a, b) => a.definition.id.localeCompare(b.definition.id)),
    references: [...(facts.references ?? [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    sourceRefs: [...(facts.sourceRefs ?? [])].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    diagnostics: facts.diagnostics ?? [],
  })
}

function byId<T extends { id: string }>(items: readonly T[], id: string): T | undefined {
  return items.find((item) => item.id === id)
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortObject(item)]),
  )
}
