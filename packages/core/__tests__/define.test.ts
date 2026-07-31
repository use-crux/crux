import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../src/prompt/prompt'
import { context } from '../src/prompt/context'

describe('prompt', () => {
  it('returns a frozen Prompt with _tag, id, description, tags', () => {
    const p = makePrompt({
      id: 'test-prompt',
      description: 'A test prompt',
      tags: ['test', 'unit'],
      system: 'You are a tester.',
    })

    expect(p._tag).toBe('Prompt')
    expect(p.id).toBe('test-prompt')
    expect(p.description).toBe('A test prompt')
    expect(p.tags).toEqual(['test', 'unit'])
    expect(Object.isFrozen(p)).toBe(true)
    expect(Object.isFrozen(p.tags)).toBe(true)
  })

    it('throws when messages combined with system', () => {
    expect(() =>
      makePrompt({
        system: 'sys',
        messages: () => [{ role: 'user', content: 'hi' }],
      } as any),
    ).toThrow(/mutually exclusive/)
  })

    it('throws when messages combined with prompt', () => {
    expect(() =>
      makePrompt({
        prompt: 'hi',
        messages: () => [{ role: 'user', content: 'hi' }],
      } as any),
    ).toThrow(/mutually exclusive/)
  })

    it('.resolve() returns ResolvedPrompt with correct fields', async () => {
    const p = makePrompt({
      system: 'You are a bot.',
      prompt: 'Do something.',
      settings: { temperature: 0.5 },
    })

    const resolved = await p.resolve({})
    expect(resolved.system).toBe('You are a bot.')
    expect(resolved.prompt).toBe('Do something.')
    expect(resolved.settings.temperature).toBe(0.5)
  })

    it('does not expose the removed prompt inspection method', () => {
    const p = makePrompt({
      system: 'You are a bot.',
      prompt: 'Do something.',
    })

    expect(p).not.toHaveProperty('inspect')
  })

    it('onPrepare hook fires on .resolve() with correct args', async () => {
    const onPrepare = vi.fn()

    const p = makePrompt({
      id: 'hook-test',
      system: 'System text.',
      prompt: 'User prompt.',
      hooks: { onPrepare },
    })

    await p.resolve({})

    expect(onPrepare).toHaveBeenCalledOnce()
    const args = onPrepare.mock.calls[0][0]
    expect(args.promptId).toBe('hook-test')
    expect(args.system).toBe('System text.')
    expect(args.prompt).toBe('User prompt.')
    expect(args.systemTokens).toBeGreaterThan(0)
    expect(args.droppedContexts).toEqual([])
  })

    it('onPrepare hook reuses the resolved pass for inspection facts', async () => {
    const onPrepare = vi.fn()
    const system = vi.fn(() => 'Context text.')
    const ctx = context({ id: 'prepare-context', system })

    const p = makePrompt({
      id: 'prepare-single-pass',
      use: [ctx],
      system: 'System text.',
      hooks: { onPrepare },
    })

    await p.resolve({})

    expect(system).toHaveBeenCalledOnce()
    expect(onPrepare.mock.calls[0][0]).toMatchObject({
      promptId: 'prepare-single-pass',
      system: 'System text.\n\nContext text.',
      droppedContexts: [],
    })
  })

    it('merges context input schemas at definition time', async () => {
    const ctx = context({
      id: 'lang',
      input: z.object({ lang: z.string() }),
      system: ({ input }) => `Respond in ${input.lang}.`,
    })

    const p = makePrompt({
      use: [ctx],
      input: z.object({ task: z.string() }),
      system: 'Bot.',
      prompt: ({ input }) => input.task,
    })

    expect(p.inputSchema).toBeDefined()

    // Should work with both fields
    const resolved = await p.resolve({
      input: { task: 'edit', lang: 'French' },
    })
    expect(resolved.system).toContain('Respond in French.')
    expect(resolved.prompt).toBe('edit')
  })

    it('defaults tags to empty array', () => {
    const p = makePrompt({ system: 'test' })
    expect(p.tags).toEqual([])
  })

    it('has hasOutput=false for text mode', () => {
    const p = makePrompt({ system: 'test' })
    expect(p.hasOutput).toBe(false)
    expect(p.outputSchema).toBeUndefined()
  })

    it('has hasOutput=true for structured mode', () => {
    const p = makePrompt({
      system: 'test',
      output: z.object({ result: z.string() }),
    })
    expect(p.hasOutput).toBe(true)
    expect(p.outputSchema).toBeDefined()
  })

    it('supports async context system functions', async () => {
    const asyncCtx = context({
      id: 'async-ctx',
      system: async () => {
        // Simulate async operation (e.g., memory lookup)
        await new Promise((r) => setTimeout(r, 1))
        return '## Async Context\nLoaded from memory.'
      },
    })

    const p = makePrompt({
      use: [asyncCtx],
      system: 'You are a bot.',
    })

    const resolved = await p.resolve({})
    expect(resolved.system).toContain('Async Context')
    expect(resolved.system).toContain('Loaded from memory.')
    expect(resolved.system).toContain('You are a bot.')
  })
})
