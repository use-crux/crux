import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../prompt/prompt'
import { agent as makeAgent, isAgent } from '../../agent/agent'

describe('agent', () => {
  const testPrompt = makePrompt({
    id: 'test-prompt',
    input: z.object({ content: z.string() }),
    output: z.object({ score: z.number() }),
    system: 'You are a test agent.',
  })

  it('returns an agent with _tag and id', () => {
    const agent = makeAgent({
      id: 'test-agent',
      prompt: testPrompt,
    })

    expect(agent._tag).toBe('Agent')
    expect(agent.id).toBe('test-agent')
  })

  it('preserves all config fields', () => {
    const mockModel = { provider: 'test', modelId: 'gpt-4' }
    const mockTools = { search: { execute: async () => 'result' } }

    const agent = makeAgent({
      id: 'full-agent',
      description: 'A fully configured agent',
      prompt: testPrompt,
      model: mockModel,
      tools: mockTools,
    })

    expect(agent.id).toBe('full-agent')
    expect(agent.description).toBe('A fully configured agent')
    expect(agent.prompt).toBe(testPrompt)
    expect(agent.model).toBe(mockModel)
    expect(agent.tools).toBe(mockTools)
  })

  it('defaults model, tools, and description to undefined', () => {
    const agent = makeAgent({
      id: 'minimal-agent',
      prompt: testPrompt,
    })

    expect(agent.description).toBeUndefined()
    expect(agent.model).toBeUndefined()
    expect(agent.tools).toBeUndefined()
  })

  it('stores handoffs when provided', () => {
    const agent = makeAgent({
      id: 'routing-agent',
      prompt: testPrompt,
      handoffs: ['billing', 'shipping'],
    })

    expect(agent.handoffs).toEqual([{ id: 'billing' }, { id: 'shipping' }])
  })

  it('defaults handoffs to empty array when not provided', () => {
    const agent = makeAgent({
      id: 'no-handoffs',
      prompt: testPrompt,
    })

    expect(agent.handoffs).toEqual([])
  })

  it('freezes the handoffs array', () => {
    const agent = makeAgent({
      id: 'frozen-handoffs',
      prompt: testPrompt,
      handoffs: ['billing'],
    })

    expect(Object.isFrozen(agent.handoffs)).toBe(true)
  })

  it('returns a frozen object', () => {
    const agent = makeAgent({
      id: 'frozen-agent',
      prompt: testPrompt,
    })

    expect(Object.isFrozen(agent)).toBe(true)
    expect(() => {
      ;(agent as any).id = 'mutated'
    }).toThrow()
  })

  describe('isAgent', () => {
    it('returns true for agents', () => {
      const agent = makeAgent({ id: 'a', prompt: testPrompt })
      expect(isAgent(agent)).toBe(true)
    })

    it('returns false for plain functions', () => {
      const fn = async (input: unknown) => ({ score: 1 })
      expect(isAgent(fn)).toBe(false)
    })

    it('returns false for plain objects', () => {
      expect(isAgent({ id: 'fake', _tag: 'NotAgent' })).toBe(false)
      expect(isAgent(null)).toBe(false)
      expect(isAgent(undefined)).toBe(false)
      expect(isAgent(42)).toBe(false)
    })
  })
})
