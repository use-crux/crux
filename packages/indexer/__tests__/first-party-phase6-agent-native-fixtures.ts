import { describe, expect } from 'vitest'
import { extractNativeAndFallback, itWithRustOxc, jsonStable } from './native-first-party-fixture-helpers'

describe('first-party Phase 6 native agent fixtures', () => {
  itWithRustOxc(
    'emits exact native agent facts with routing and handoff dependencies',
    async () => {
      const source = [
        "const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })",
        "const searchDocs = createTool({ name: 'searchDocs', description: 'Search', parameters: { query: 'string' } })",
        "const qualityRouter = router({ id: 'quality-router', routes: { default: writerPrompt } })",
        "const handleAgent = () => memoryStore.get('state')",
        '',
        'export const writerAgent = agent({',
        "  id: 'writer-agent',",
        '  prompt: writerPrompt,',
        '  tools: [searchDocs],',
        '  languageModel: qualityRouter,',
        "  handoffs: ['editor-agent', { id: 'reviewer-agent' }],",
        '  constraints: [qualityConstraint],',
        '  guardrails: [safetyGuard],',
        '  handler: handleAgent,',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['prompt', 'createTool', 'router', 'agent'],
      })

      expect(record.nativeFacts?.flatMap((fact) => fact.replaces ?? [])).toEqual(
        expect.arrayContaining([{ extension: '@crux/indexer/crux-core', extractor: 'agent' }]),
      )
      expect(jsonStable(nativeOut.definitions)).toEqual(jsonStable(fallbackOut.definitions))
      expect(jsonStable(nativeOut.relations)).toEqual(jsonStable(fallbackOut.relations))
      expect(jsonStable(nativeOut.diagnostics)).toEqual(jsonStable(fallbackOut.diagnostics))
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native Convex agent facts from calls and constructors',
    async () => {
      const source = [
        "const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })",
        "const searchDocs = createTool({ name: 'searchDocs', description: 'Search', parameters: { query: 'string' } })",
        'const directTools = { searchDocs }',
        'const component = {} as never',
        'const resolve = (promptRef: unknown) => promptRef',
        "const contextHandler = () => ({ tenantId: 'tenant' })",
        'const usageHandler = () => undefined',
        'const prepareAgent = () => ({ tools: directTools })',
        '',
        'export const convexWriter = convexAgent({',
        "  name: 'Convex Writer',",
        '  languageModel: resolve(writerPrompt),',
        '  tools: directTools,',
        '  contextHandler,',
        '  usageHandler,',
        '  prepare: prepareAgent,',
        '  maxSteps: 4,',
        '})',
        '',
        'export const constructorWriter = new Agent(component, {',
        "  name: 'Constructor Writer',",
        '  prompt: writerPrompt,',
        '  tools: { searchDocs },',
        '  contextHandler,',
        '  usageHandler,',
        '  prepare: prepareAgent,',
        '  maxSteps: 2,',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['prompt', 'createTool', 'convexAgent'],
        constructorNames: ['Agent'],
      })

      const agentPackets = (record.nativeFacts ?? []).filter((fact) =>
        fact.replaces?.some(
          (replacement) => replacement.extension === '@crux/indexer/crux-core' && replacement.extractor === 'agent',
        ),
      )
      expect(record.matches.some((match) => match.kind === 'new' && match.callee.name === 'Agent')).toBe(true)
      expect(agentPackets).toHaveLength(2)
      expect(agentPackets.map((fact) => fact.replaces)).toEqual([
        [{ extension: '@crux/indexer/crux-core', extractor: 'agent' }],
        [{ extension: '@crux/indexer/crux-core', extractor: 'agent' }],
      ])

      expect(jsonStable(nativeOut.definitions)).toEqual(jsonStable(fallbackOut.definitions))
      expect(jsonStable(nativeOut.relations)).toEqual(jsonStable(fallbackOut.relations))
      expect(jsonStable(nativeOut.diagnostics)).toEqual(jsonStable(fallbackOut.diagnostics))

      expect(nativeOut.definitions.find((definition) => definition.id === 'agent:Convex-Writer')).toMatchObject({
        metadata: expect.objectContaining({
          runtime: 'convex-agent',
          hasTools: true,
          hasContextHandler: true,
          hasUsageHandler: true,
          hasPrepare: true,
          maxSteps: 'configured',
        }),
        sourceRefs: expect.arrayContaining([
          expect.objectContaining({ role: 'config', property: 'tools', symbol: 'directTools' }),
          expect.objectContaining({ role: 'callback', property: 'contextHandler', symbol: 'contextHandler' }),
          expect.objectContaining({ role: 'callback', property: 'usageHandler', symbol: 'usageHandler' }),
          expect.objectContaining({ role: 'callback', property: 'prepare', symbol: 'prepareAgent' }),
        ]),
      })
      expect(nativeOut.relations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'agent.uses_prompt', from: 'agent:Convex-Writer', to: 'prompt:writer' }),
          expect.objectContaining({ type: 'agent.uses_tool', from: 'agent:Convex-Writer', to: 'tool:searchDocs' }),
          expect.objectContaining({
            type: 'agent.uses_prompt',
            from: 'agent:Constructor-Writer',
            to: 'prompt:writer',
          }),
          expect.objectContaining({
            type: 'agent.uses_tool',
            from: 'agent:Constructor-Writer',
            to: 'tool:searchDocs',
          }),
        ]),
      )
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native Convex agent facts from member calls',
    async () => {
      const source = [
        "const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })",
        'const crux = { convexAgent }',
        '',
        'export const profileWriter = crux.convexAgent({',
        "  name: 'Profile Writer',",
        '  prompt: writerPrompt,',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['prompt', 'convexAgent'],
      })

      const agentPackets = (record.nativeFacts ?? []).filter((fact) =>
        fact.replaces?.some(
          (replacement) => replacement.extension === '@crux/indexer/crux-core' && replacement.extractor === 'agent',
        ),
      )
      expect(agentPackets).toHaveLength(1)
      expect(jsonStable(nativeOut.definitions)).toEqual(jsonStable(fallbackOut.definitions))
      expect(jsonStable(nativeOut.relations)).toEqual(jsonStable(fallbackOut.relations))
      expect(jsonStable(nativeOut.diagnostics)).toEqual(jsonStable(fallbackOut.diagnostics))
    },
    30_000,
  )
})
