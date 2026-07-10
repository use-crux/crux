import { describe, expect, it } from 'vitest'
import type { SystemBlock } from '@use-crux/core'
import { planSystemBlocks } from '../src/cached-content/planner'

describe('planSystemBlocks', () => {
  it('treats leading providerCache blocks as the cacheable prefix', () => {
    const systemBlocks: SystemBlock[] = [
      { source: 'context:rules', text: 'Cached rules', providerCache: true },
      { source: 'context:voice', text: 'Cached voice', providerCache: true },
      { source: 'prompt', text: 'Prompt rules', providerCache: false },
    ]

    const plan = planSystemBlocks({ systemBlocks, system: 'Cached rules\n\nCached voice\n\nPrompt rules' })

    expect(plan.cacheablePrefix).toEqual(systemBlocks.slice(0, 2))
    expect(plan.uncachedInstruction).toBe('Prompt rules')
  })

  it('stops the prefix at the first uncacheable block', () => {
    const systemBlocks: SystemBlock[] = [
      { source: 'context:a', text: 'A', providerCache: true },
      { source: 'prompt', text: 'B', providerCache: false },
      { source: 'context:c', text: 'C', providerCache: true },
    ]

    const plan = planSystemBlocks({ systemBlocks, system: 'A\n\nB\n\nC' })

    expect(plan.cacheablePrefix).toEqual(systemBlocks.slice(0, 1))
    expect(plan.uncachedInstruction).toBe('B\n\nC')
  })

  it('returns an empty prefix and the flat system when no leading block is cacheable', () => {
    const systemBlocks: SystemBlock[] = [
      { source: 'prompt', text: 'Prompt rules', providerCache: false },
      { source: 'context:later', text: 'Later cached rules', providerCache: true },
    ]

    const plan = planSystemBlocks({ systemBlocks, system: 'Prompt rules\n\nLater cached rules' })

    expect(plan.cacheablePrefix).toEqual([])
    expect(plan.uncachedInstruction).toBe('Prompt rules\n\nLater cached rules')
  })

  it('omits the uncached instruction when the whole prompt is cacheable', () => {
    const systemBlocks: SystemBlock[] = [{ source: 'context:rules', text: 'Cached rules', providerCache: true }]

    const plan = planSystemBlocks({ systemBlocks, system: 'Cached rules' })

    expect(plan.cacheablePrefix).toEqual(systemBlocks)
    expect(plan.uncachedInstruction).toBeUndefined()
  })

  it('returns an empty prefix when there are no system blocks', () => {
    const plan = planSystemBlocks({ systemBlocks: undefined, system: 'Plain system' })

    expect(plan.cacheablePrefix).toEqual([])
    expect(plan.uncachedInstruction).toBe('Plain system')
  })

  it('derives the suffix from blocks even when the flat system is omitted', () => {
    const systemBlocks: SystemBlock[] = [
      { source: 'context:rules', text: 'Cached rules', providerCache: true },
      { source: 'prompt', text: 'Prompt rules', providerCache: false },
    ]

    const plan = planSystemBlocks({ systemBlocks })

    expect(plan.cacheablePrefix).toEqual(systemBlocks.slice(0, 1))
    expect(plan.uncachedInstruction).toBe('Prompt rules')
  })
})
