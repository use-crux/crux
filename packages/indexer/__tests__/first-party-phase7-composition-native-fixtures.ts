import {
  agentDefinitionRef,
  blackboardDefinitionRef,
  compositionDefinitionRef,
  contextDefinitionRef,
  flowDefinitionRef,
  promptDefinitionRef,
  retrieverDefinitionRef,
  toolDefinitionRef,
} from '@use-crux/core/observability'
import { describe, expect } from 'vitest'
import {
  extractNativeAndFallback,
  itWithRustOxc,
  nativeFactCount,
} from './native-first-party-fixture-helpers'

describe('first-party Phase 7 composition native fixtures', () => {
  itWithRustOxc(
    'emits exact native composition facts from Rust/Oxc records',
    async () => {
      // Real `@use-crux/*` imports so the TypeScript static extractor recognizes
      // the calls in the fallback pass, matching the native Rust/Oxc frontend.
      const source = [
        "import { agent, context, createTool, flow, prompt, router } from '@use-crux/core'",
        "import { blackboard } from '@use-crux/core/agent'",
        "import { memory } from '@use-crux/core/memory'",
        "import { retriever } from '@use-crux/core/retrieval'",
        "import { llmJudge } from '@use-crux/core/scoring'",
        "import { consensus, parallel, pipeline, swarm } from '@use-crux/ai'",
        '',
        // Authored ids are intentionally hostile (spaces + punctuation) to
        // exercise `safe_id` normalization; none place a literal `-` adjacent to
        // an invalid run, the one shape where the regex/pending-dash normalizers
        // legitimately differ.
        "export const brandContext = context({ id: 'Brand Context!' })",
        "export const writerPrompt = prompt({ id: 'Writer Prompt!', prompt: 'Write' })",
        "export const reviewPrompt = prompt({ id: 'review', prompt: 'Review' })",
        "export const searchDocs = createTool({ name: 'search docs@v2', description: 'Search docs' })",
        "export const qualityScorer = llmJudge({ id: 'quality', criteria: 'Be factual' })",
        "export const docsRetriever = retriever({ id: 'Docs KB!', retrieve: async () => [] })",
        "export const writerAgent = agent({ id: 'Writer Agent!', prompt: writerPrompt, tools: [searchDocs] })",
        "export const reviewAgent = agent({ id: 'review-agent', prompt: reviewPrompt })",
        "export const routeRouter = router({ id: 'route-router', routes: { writer: writerAgent }, classify: () => 'writer' })",
        "export const agentFlow = flow({ name: 'Agent Flow!', handler: async (flow) => flow.step('write', writerAgent) })",
        "export const sharedMemory = memory({ id: 'session-memory', blocks: [] })",
        "export const sharedBoard = blackboard({ id: 'Shared Board!' })",
        '',
        'export const writerParallel = parallel({',
        "  id: 'Writer Parallel!',",
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
        "  id: 'Writer Pipeline!',",
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
        "  id: 'Writer Consensus!',",
        '  agents: [writerAgent, reviewAgent],',
        '  judge: reviewAgent,',
        '  scorer: qualityScorer,',
        '})',
        '',
        'export const writerSwarm = swarm({',
        "  id: 'Writer Swarm!',",
        "  startAgent: 'writer',",
        '  agents: { writer: writerAgent, reviewer: reviewAgent },',
        '  blackboard: sharedBoard,',
        '  memory: [sharedMemory],',
        '})',
      ].join('\n')
      const { nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: [
          'context',
          'prompt',
          'createTool',
          'llmJudge',
          'retriever',
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

      // Every DefinitionRef-touched kind's native static `ProjectDefinition.ID`
      // must be byte-identical to the id the runtime helper in
      // `@use-crux/core/observability` emits for the same authored id, so a
      // runtime span joins the Project Index. (The TypeScript bundled-extractor
      // fallback path emits no first-party definitions in this harness, so the
      // native Rust/Oxc frontend output is the static backend under test here;
      // the default TypeScript semantic backend's canonical ids for the
      // config-bearing kinds are pinned in semantic-backend-parity, and the
      // runtime helper output itself is pinned in the core definition-ref
      // unit tests.)
      const emittedIds = new Set(nativeOut.definitions.map((definition) => definition.id))
      const canonicalTouchedIds = [
        promptDefinitionRef('Writer Prompt!').id,
        contextDefinitionRef('Brand Context!').id,
        toolDefinitionRef('search docs@v2').id,
        agentDefinitionRef('Writer Agent!').id,
        flowDefinitionRef('Agent Flow!').id,
        retrieverDefinitionRef('Docs KB!').id,
        blackboardDefinitionRef('Shared Board!').id,
        compositionDefinitionRef('parallel', 'Writer Parallel!').id,
        compositionDefinitionRef('pipeline', 'Writer Pipeline!').id,
        compositionDefinitionRef('consensus', 'Writer Consensus!').id,
        compositionDefinitionRef('swarm', 'Writer Swarm!').id,
      ]
      for (const id of canonicalTouchedIds) expect(emittedIds).toContain(id)

      // The composition roots derive their canonical id solely from the authored
      // `id`; the random per-execution `compositionId` never appears in source
      // and is irrelevant to indexing. Confirm exactly the four expected roots
      // (root kinds only — branch/stage children carry `composition.<kind>.*`).
      const rootKinds = new Set([
        'composition.parallel',
        'composition.pipeline',
        'composition.consensus',
        'composition.swarm',
      ])
      const emittedCompositionIds = nativeOut.definitions
        .filter((definition) => rootKinds.has(definition.kind))
        .map((definition) => definition.id)
        .sort()
      expect(emittedCompositionIds).toEqual(
        [
          compositionDefinitionRef('parallel', 'Writer Parallel!').id,
          compositionDefinitionRef('pipeline', 'Writer Pipeline!').id,
          compositionDefinitionRef('consensus', 'Writer Consensus!').id,
          compositionDefinitionRef('swarm', 'Writer Swarm!').id,
        ].sort(),
      )
    },
    30_000,
  )
})
