import { describe, expect } from 'vitest'
import { extractNativeAndFallback, itWithRustOxc, jsonStable } from './native-first-party-fixture-helpers'

describe('first-party Phase 6 native fixtures', () => {
  itWithRustOxc(
    'emits exact native tool facts from Rust/Oxc records',
    async () => {
      const source = [
        "import { createTool as defineTool, tool } from '@crux/core'",
        '',
        'const queryInput = z.object({',
        "  query: z.string().describe('Search query'),",
        '})',
        'const repeatedField = z.string()',
        'const repeatedZodInput = z.object({',
        '  first: repeatedField,',
        '  second: repeatedField,',
        '})',
        '',
        'function auditSearch() {',
        "  workspace.readFile('/audit')",
        '}',
        "const summarize = () => 'summary'",
        "const classify = () => 'reference'",
        "const dynamicName = 'dynamicTool'",
        "const dynamicDescription = 'Dynamic tool'",
        'const dynamicInput = z.object({ docId: z.string() })',
        "const executeDynamic = () => workspace.readFile('/dynamic')",
        '',
        'export const searchDocs = defineTool({',
        "  name: 'searchDocs',",
        "  description: 'Search documentation',",
        '  parameters: queryInput,',
        '  execute: async () => {',
        '    auditSearch()',
        "    memoryStore.search('docs')",
        "    workspace.writeFile('/result')",
        "    return 'result'",
        '  },',
        '  toModelOutput: true,',
        '})',
        '',
        'export const repeatedSchemaTool = defineTool({',
        "  name: 'repeatedSchemaTool',",
        "  description: 'Reuse schema aliases',",
        '  parameters: repeatedZodInput,',
        '  execute: async () => undefined,',
        '})',
        '',
        'export const summarizeDoc = tool({',
        "  title: 'summarizeDoc',",
        '  inputSchema: { docId: v.id("docs") },',
        '  handler: summarize,',
        '})',
        '',
        'export const classifyDoc = {',
        "  name: 'classifyDoc',",
        "  description: 'Classify documentation',",
        '  input: { label: v.string() },',
        '  run: classify,',
        '}',
        '',
        'const wrappedTool = defineTool({',
        '  name: dynamicName,',
        '  description: dynamicDescription,',
        '  inputSchema: dynamicInput,',
        '  execute: executeDynamic,',
        '})',
        'export const exportedWrappedTool = wrappedTool',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['createTool', 'tool'],
      })

      expect(record.nativeFacts ?? []).toHaveLength(5)
      expect(record.nativeFacts?.map((fact) => fact.replaces)).toEqual([
        [{ extension: '@crux/indexer/crux-core', extractor: 'tool' }],
        [{ extension: '@crux/indexer/crux-core', extractor: 'tool' }],
        [{ extension: '@crux/indexer/crux-core', extractor: 'tool' }],
        [{ extension: '@crux/indexer/crux-core', extractor: 'tool' }],
        [{ extension: '@crux/indexer/crux-core', extractor: 'tool' }],
      ])
      expect(jsonStable(nativeOut.definitions)).toEqual(jsonStable(fallbackOut.definitions))
      expect(jsonStable(nativeOut.relations)).toEqual(jsonStable(fallbackOut.relations))
      expect(jsonStable(nativeOut.diagnostics)).toEqual(jsonStable(fallbackOut.diagnostics))
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native context and prompt facts with injection dependencies',
    async () => {
      const source = [
        "const brandName = 'Crux'",
        'const SYSTEM = `Use ${brandName} voice`',
        'const inputSchema = z.object({ topic: z.string() })',
        "const resolveBrand = () => memoryStore.get('brand')",
        "const draftCopy = () => workspace.readFile('/draft')",
        "const searchDocs = createTool({ name: 'searchDocs', description: 'Search', parameters: { query: 'string' } })",
        'function buildTools() {',
        '  return { searchDocs }',
        '}',
        '',
        "export const baseContext = context({ id: 'base', system: SYSTEM })",
        'export const brandContext = context({',
        "  id: 'brand',",
        '  input: inputSchema,',
        '  use: [baseContext],',
        '  system: SYSTEM,',
        '  tools: buildTools(),',
        '  resolve: resolveBrand,',
        '})',
        '',
        'export const writerPrompt = prompt({',
        "  id: 'writer',",
        '  input: inputSchema,',
        '  output: { text: v.string() },',
        "  use: [brandContext, when('long', baseContext), match({ cases: { short: [brandContext] }, default: [baseContext] })],",
        '  system: SYSTEM,',
        '  prompt: draftCopy,',
        '  tools: buildTools(),',
        '  constraints: [qualityConstraint],',
        '  guardrails: [safetyGuard],',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['createTool', 'context', 'prompt', 'when', 'match'],
      })

      expect(record.nativeFacts?.flatMap((fact) => fact.replaces ?? [])).toEqual(
        expect.arrayContaining([
          { extension: '@crux/indexer/crux-core', extractor: 'context' },
          { extension: '@crux/indexer/crux-core', extractor: 'prompt' },
        ]),
      )
      expect(jsonStable(nativeOut.definitions)).toEqual(jsonStable(fallbackOut.definitions))
      expect(jsonStable(nativeOut.relations)).toEqual(jsonStable(fallbackOut.relations))
      expect(jsonStable(nativeOut.diagnostics)).toEqual(jsonStable(fallbackOut.diagnostics))
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native prompt and tool facts from member calls',
    async () => {
      const source = [
        "import { prompt } from '@crux/core'",
        '',
        "const supportAnswer = prompt({ id: 'support', system: 'Support answer.' })",
        'const target = { prompt: (...args: unknown[]) => args }',
        "const runtime = { generate: () => undefined, model: 'test-model' }",
        "const name = 'runtimeTool'",
        'const driver = { createTool: (config: unknown) => config }',
        '',
        'export const qualityTarget = target.prompt(supportAnswer, {',
        '  generate: runtime.generate,',
        '  model: runtime.model,',
        '})',
        '',
        'export const runtimeTool = driver.createTool({',
        '  name,',
        "  description: 'Runtime tool',",
        "  parameters: { query: 'string' },",
        "  execute: () => 'ok',",
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['createTool', 'prompt'],
      })

      expect(record.nativeFacts?.flatMap((fact) => fact.replaces ?? [])).toEqual(
        expect.arrayContaining([
          { extension: '@crux/indexer/crux-core', extractor: 'prompt' },
          { extension: '@crux/indexer/crux-core', extractor: 'tool' },
        ]),
      )
      expect(jsonStable(nativeOut.definitions)).toEqual(jsonStable(fallbackOut.definitions))
      expect(jsonStable(nativeOut.relations)).toEqual(jsonStable(fallbackOut.relations))
      expect(jsonStable(nativeOut.diagnostics)).toEqual(jsonStable(fallbackOut.diagnostics))
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native injectable facts with returned contributions',
    async () => {
      const source = [
        'const inputSchema = z.object({ tenantId: z.string() })',
        'const repeatedConvexField = v.string()',
        'const repeatedConvexInput = { first: repeatedConvexField, second: repeatedConvexField }',
        "const searchDocs = createTool({ name: 'searchDocs', description: 'Search', parameters: { query: 'string' } })",
        "const baseContext = context({ id: 'base', system: 'Base' })",
        "const brandContext = context({ id: 'brand', use: [baseContext], system: 'Brand' })",
        "const qualityConstraint = constraint({ name: 'quality', appliesTo: brandContext, validate: () => true })",
        "const safetyGuard = guardrail({ name: 'safe', targets: ['prompt:writer'], run: () => true })",
        'function auditInject() {}',
        'function buildInjection() {',
        '  auditInject()',
        '  return () => ({',
        "    contexts: [baseContext, when('brand', brandContext)],",
        '    tools: buildTools(),',
        '    constraints: [qualityConstraint],',
        '    guardrails: [safetyGuard],',
        "    metadata: { tier: 'gold' },",
        '  })',
        '}',
        'function buildTools() {',
        '  return { searchDocs }',
        '}',
        '',
        'export const runtimeInjection = injectable({',
        "  id: 'runtime',",
        '  input: repeatedConvexInput,',
        '  inject: buildInjection,',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['createTool', 'context', 'constraint', 'guardrail', 'injectable', 'when'],
      })

      expect(record.nativeFacts?.flatMap((fact) => fact.replaces ?? [])).toEqual(
        expect.arrayContaining([{ extension: '@crux/indexer/crux-core', extractor: 'injectable' }]),
      )
      expect(jsonStable(nativeOut.definitions)).toEqual(jsonStable(fallbackOut.definitions))
      expect(jsonStable(nativeOut.relations)).toEqual(jsonStable(fallbackOut.relations))
      expect(jsonStable(nativeOut.diagnostics)).toEqual(jsonStable(fallbackOut.diagnostics))
    },
    30_000,
  )
})
