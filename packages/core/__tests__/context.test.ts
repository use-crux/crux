import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { context, createContexts } from '../prompt/context'

describe('context()', () => {
  it('static context: systemFn returns the string', () => {
    const ctx = context({ system: 'Be polite.' })
    expect(ctx.systemFn({})).toBe('Be polite.')
  })

  it('dynamic context: systemFn calls the function with input', () => {
    const ctx = context({
      input: z.object({ lang: z.string() }),
      system: ({ input }) => `Respond in ${input.lang}.`,
    })
    expect(ctx.systemFn({ lang: 'French' })).toBe('Respond in French.')
  })

  it('priority defaults to 50', () => {
    const ctx = context({ system: 'text' })
    expect(ctx.priority).toBe(50)
  })

  it('custom priority is preserved', () => {
    const ctx = context({ system: 'text', priority: 10 })
    expect(ctx.priority).toBe(10)
  })

  it('inputSchema and inputKeys extracted correctly', () => {
    const ctx = context({
      input: z.object({ foo: z.string(), bar: z.number() }),
      system: 'text',
    })
    expect(ctx.inputSchema).toBeDefined()
    expect([...ctx.inputKeys]).toEqual(['foo', 'bar'])
  })

  it('static tools returned via toolsFn', () => {
    const tools = { search: 'tool' }
    const ctx = context({ system: 'text', tools })
    expect(ctx.toolsFn).toBeDefined()
    expect(ctx.toolsFn!({})).toEqual({ search: 'tool' })
  })

  it('dynamic tools function called with input', () => {
    const ctx = context({
      input: z.object({ enabled: z.boolean() }),
      system: 'text',
      tools: ({ input }: any) => (input.enabled ? { search: 'tool' } : {}),
    })
    expect(ctx.toolsFn!({ enabled: true })).toEqual({ search: 'tool' })
    expect(ctx.toolsFn!({ enabled: false })).toEqual({})
  })

  it('context without tools has toolsFn = undefined', () => {
    const ctx = context({ system: 'text' })
    expect(ctx.toolsFn).toBeUndefined()
  })

  it('context is frozen', () => {
    const ctx = context({ id: 'test', system: 'text' })
    expect(Object.isFrozen(ctx)).toBe(true)
  })

  it('has _tag = Context', () => {
    const ctx = context({ system: 'text' })
    expect(ctx._tag).toBe('Context')
  })

  it('id and description are preserved', () => {
    const ctx = context({ id: 'my-ctx', description: 'My context', system: 'text' })
    expect(ctx.id).toBe('my-ctx')
    expect(ctx.description).toBe('My context')
  })

  it('inputKeys is frozen', () => {
    const ctx = context({
      input: z.object({ a: z.string() }),
      system: 'text',
    })
    expect(Object.isFrozen(ctx.inputKeys)).toBe(true)
  })

  it('async system function returns a promise', async () => {
    const ctx = context({
      id: 'async-ctx',
      system: async () => {
        await new Promise((r) => setTimeout(r, 1))
        return 'Async result'
      },
    })

    const result = await ctx.systemFn({})
    expect(result).toBe('Async result')
  })

  it('async system function with input', async () => {
    const ctx = context({
      id: 'async-input',
      input: z.object({ userId: z.string() }),
      system: async ({ input }) => {
        await new Promise((r) => setTimeout(r, 1))
        return `User: ${input.userId}`
      },
    })

    const result = await ctx.systemFn({ userId: 'user_123' })
    expect(result).toBe('User: user_123')
  })
  // ── Cache option parsing ──

  describe('cache option', () => {
    it('cache: number sets cacheTtl and providerCache: true', () => {
      const ctx = context({ id: 'c1', system: () => 'dynamic', cache: 300_000 })
      expect(ctx.cacheTtl).toBe(300_000)
      expect(ctx.providerCache).toBe(true)
    })

    it('cache: true sets cacheTtl to 300_000 and providerCache: true', () => {
      const ctx = context({ id: 'c1', system: () => 'dynamic', cache: true })
      expect(ctx.cacheTtl).toBe(300_000)
      expect(ctx.providerCache).toBe(true)
    })

    it('cache: { ttl: 60_000 } sets cacheTtl and providerCache defaults to true', () => {
      const ctx = context({ id: 'c1', system: () => 'dynamic', cache: { ttl: 60_000 } })
      expect(ctx.cacheTtl).toBe(60_000)
      expect(ctx.providerCache).toBe(true)
    })

    it('cache: { ttl: 60_000, providerCache: false } respects explicit providerCache', () => {
      const ctx = context({ id: 'c1', system: () => 'dynamic', cache: { ttl: 60_000, providerCache: false } })
      expect(ctx.cacheTtl).toBe(60_000)
      expect(ctx.providerCache).toBe(false)
    })

    it('cache: { providerCache: true } sets only providerCache, no TTL', () => {
      const ctx = context({ id: 'c1', system: 'text', cache: { providerCache: true } })
      expect(ctx.cacheTtl).toBe(0)
      expect(ctx.providerCache).toBe(true)
    })

    it('no cache option defaults to cacheTtl: 0 and providerCache: false', () => {
      const ctx = context({ id: 'c1', system: 'text' })
      expect(ctx.cacheTtl).toBe(0)
      expect(ctx.providerCache).toBe(false)
    })

    it('cache: false defaults to cacheTtl: 0 and providerCache: false', () => {
      const ctx = context({ id: 'c1', system: 'text', cache: false })
      expect(ctx.cacheTtl).toBe(0)
      expect(ctx.providerCache).toBe(false)
    })

    it('throws if cacheTtl > 0 but no id', () => {
      expect(() => context({ system: () => 'dynamic', cache: 300_000 })).toThrow(/cache requires an id/)
    })

    it('static string system with cache TTL silently sets cacheTtl to 0', () => {
      const ctx = context({ id: 'c1', system: 'A static string', cache: 300_000 })
      expect(ctx.cacheTtl).toBe(0) // nothing to cache for static strings
      expect(ctx.providerCache).toBe(true) // provider caching still applies
    })

    it('dynamic system with cache TTL preserves cacheTtl', () => {
      const ctx = context({
        id: 'c1',
        system: () => 'dynamic result',
        cache: 300_000,
      })
      expect(ctx.cacheTtl).toBe(300_000)
      expect(ctx.providerCache).toBe(true)
    })
  })
})

describe('createContexts()', () => {
  it('deep-freezes a nested tree', () => {
    const tree = createContexts({
      editor: {
        proseMirror: context({ system: 'PM context' }),
        instructions: context({ system: 'Instructions' }),
      },
      brand: context({ system: 'Brand' }),
    })

    expect(Object.isFrozen(tree)).toBe(true)
    expect(Object.isFrozen(tree.editor)).toBe(true)
    expect(tree.editor.proseMirror._tag).toBe('Context')
    expect(tree.brand._tag).toBe('Context')
  })

  it('throws on non-Context leaf values', () => {
    expect(() =>
      createContexts({
        bad: 'not a context' as any,
      }),
    ).toThrow(/invalid value at "bad"/)
  })

  it('throws on array values', () => {
    expect(() =>
      createContexts({
        bad: [] as any,
      }),
    ).toThrow(/invalid value/)
  })

  it('allows deeply nested trees', () => {
    const tree = createContexts({
      a: {
        b: {
          c: context({ system: 'deep' }),
        },
      },
    })
    expect(tree.a.b.c.systemFn({})).toBe('deep')
  })
})
