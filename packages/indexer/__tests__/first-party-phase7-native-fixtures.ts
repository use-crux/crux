import { describe, expect } from 'vitest'
import {
  extractNativeAndFallback,
  expectNativeExtractionParity,
  itWithRustOxc,
  nativeFactCount,
} from './native-first-party-fixture-helpers'

describe('first-party Phase 7 native fixtures', () => {
  itWithRustOxc(
    'emits exact native memory facts from Rust/Oxc records',
    async () => {
      const source = [
        "const memoryId = createMemoryId('session')",
        'const stateSchema = z.object({ userId: z.string(), turnCount: z.number().optional() })',
        'const memoryStore = durableStore({ component: components.memory })',
        '',
        'export const sessionMemory = memory({',
        '  id: memoryId,',
        "  capture: { mode: 'afterResponse' },",
        '  budget: { maxTokens: 1200 },',
        "  evictionPolicy: 'ttl-30d',",
        '  store: memoryStore,',
        '  blocks: [',
        "    workingState({ id: 'state', schema: stateSchema, priority: 10, budget: { maxTokens: 300 }, write: { mode: 'merge' } }),",
        "    episodes({ id: 'history', embed: embedEpisode, priority: 5, retention: '30d', render: { strategy: 'recent', limit: 4 } }),",
        "    memoryBlock({ id: 'scratch', kind: 'custom', render: false }),",
        '  ],',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['memory', 'createMemoryId', 'workingState', 'episodes', 'memoryBlock', 'durableStore'],
      })

      expect(nativeFactCount(record, 'memory')).toBe(1)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native blackboard facts from Rust/Oxc records',
    async () => {
      const source = [
        "const boardId = createMemoryId('blackboard')",
        'const boardSchema = z.object({ topic: z.string(), status: z.string() })',
        '',
        'export const sharedBoard = blackboard({',
        '  id: boardId,',
        '  schema: boardSchema,',
        "  conflictPolicy: 'last-writer-wins',",
        '  store: durableStore({ component: components.memory }),',
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['blackboard', 'createMemoryId'],
      })

      expect(nativeFactCount(record, 'blackboard')).toBe(1)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )

  itWithRustOxc(
    'emits exact native routing facts from Rust/Oxc records',
    async () => {
      const source = [
        "export const writerPrompt = prompt({ id: 'writer-routing' })",
        "export const backupPrompt = prompt({ id: 'backup-routing' })",
        "export const writerAgent = agent({ id: 'writer-routing-agent', prompt: writerPrompt })",
        '',
        "export const resilientWriter = fallback(writerAgent, backupPrompt, { id: 'resilient-writer' })",
        'export const qualityCascade = cascade({',
        "  id: 'quality-routing',",
        '  tiers: [',
        "    { name: 'primary', target: writerAgent },",
        "    { name: 'backup', target: backupPrompt },",
        '  ],',
        '})',
        'export const qualityRouter = router({',
        "  id: 'quality-router',",
        '  routes: { writer: writerAgent, backup: backupPrompt },',
        "  classify: () => 'writer',",
        '})',
      ].join('\n')
      const { fallbackOut, nativeOut, record } = await extractNativeAndFallback({
        source,
        callNames: ['prompt', 'agent', 'fallback', 'cascade', 'router'],
      })

      expect(nativeFactCount(record, 'routing')).toBe(3)
      expectNativeExtractionParity(nativeOut, fallbackOut)
    },
    30_000,
  )
})
