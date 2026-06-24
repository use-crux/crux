import { describe, expect } from 'vitest'
import {
  extractNativeAndFallback,
  itWithRustOxc,
  jsonStable,
  nativeFactCount,
} from './native-first-party-fixture-helpers'

describe('first-party Phase 7 composition native fixtures', () => {
  itWithRustOxc('emits exact native composition facts from Rust/Oxc records', async () => {
    const source = [
      "export const writerPrompt = prompt({ id: 'writer', prompt: 'Write' })",
      "export const reviewPrompt = prompt({ id: 'review', prompt: 'Review' })",
      "export const searchDocs = createTool({ name: 'searchDocs', description: 'Search docs' })",
      "export const qualityScorer = llmJudge({ id: 'quality', criteria: 'Be factual' })",
      "export const writerAgent = agent({ id: 'writer-agent', prompt: writerPrompt, tools: [searchDocs] })",
      "export const reviewAgent = agent({ id: 'review-agent', prompt: reviewPrompt })",
      "export const routeRouter = router({ id: 'route-router', routes: { writer: writerAgent }, classify: () => 'writer' })",
      "export const agentFlow = flow({ name: 'agent-flow', handler: async (flow) => flow.step('write', writerAgent) })",
      "export const sharedMemory = memory({ id: 'session-memory', blocks: [] })",
      "export const sharedBoard = blackboard({ id: 'shared-board' })",
      '',
      'export const writerParallel = parallel({',
      '  agents: {',
      '    writer: writerAgent,',
      '    prompted: writerPrompt,',
      '    searched: searchDocs,',
      '    routed: routeRouter,',
      '    flowed: agentFlow,',
      '  },',
      '})',
      '',
      'export const writerPipeline = pipeline({',
      '  steps: [',
      "    { name: 'write', agent: writerAgent },",
      "    { name: 'outline', prompt: writerPrompt },",
      "    { name: 'search', tool: searchDocs },",
      "    { name: 'route', agent: routeRouter },",
      "    { name: 'flow', flow: agentFlow },",
      '  ],',
      '})',
      '',
      'export const writerConsensus = consensus({',
      '  agents: [writerAgent, reviewAgent],',
      '  judge: reviewAgent,',
      '  scorer: qualityScorer,',
      '})',
      '',
      'export const writerSwarm = swarm({',
      "  startAgent: 'writer',",
      '  agents: { writer: writerAgent, reviewer: reviewAgent },',
      '  blackboard: sharedBoard,',
      '  memory: [sharedMemory],',
      '})',
    ].join('\n')
    const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
      source,
      callNames: [
        'prompt',
        'createTool',
        'llmJudge',
        'agent',
        'router',
        'flow',
        'memory',
        'blackboard',
        'parallel',
        'pipeline',
        'consensus',
        'swarm',
      ],
    })

    expect(nativeFactCount(record, 'composition')).toBe(4)
    expect(jsonStable(nativeOut.definitions)).toEqual(jsonStable(fallbackOut.definitions))
    expect(jsonStable(nativeOut.relations)).toEqual(jsonStable(fallbackOut.relations))
    expect(jsonStable(nativeOut.diagnostics)).toEqual(jsonStable(fallbackOut.diagnostics))
  }, 30_000)
})
