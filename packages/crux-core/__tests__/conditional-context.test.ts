import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { context, when, match } from '../context'
import { flattenContextEntries, mergeInputSchemas } from '../resolve'
import { prompt as makePrompt } from '../define'
import { setTokenizer, defaultTokenizer } from '../tokenizer'

// Set up tokenizer for tests that need resolve/inspect
beforeEach(() => {
  setTokenizer(defaultTokenizer)
})

// ─────────────────────────────────────────────────────────────────
// context() with `when` field
// ─────────────────────────────────────────────────────────────────

describe('context() with when field', () => {
  it('stores the when predicate on the context', () => {
    const ctx = context({
      id: 'lang',
      input: z.object({ lang: z.string().optional() }),
      when: ({ input }) => !!input.lang && input.lang !== 'English',
      system: ({ input }) => `Respond in ${input.lang}.`,
    })

    expect(ctx.when).toBeDefined()
    expect(typeof ctx.when).toBe('function')
  })

  it('when predicate receives input correctly', () => {
    const ctx = context({
      input: z.object({ lang: z.string().optional() }),
      when: ({ input }) => input.lang === 'French',
      system: 'text',
    })

    expect(ctx.when!({ lang: 'French' })).toBe(true)
    expect(ctx.when!({ lang: 'English' })).toBe(false)
    expect(ctx.when!({})).toBe(false)
  })

  it('context without when has when = undefined', () => {
    const ctx = context({ system: 'text' })
    expect(ctx.when).toBeUndefined()
  })

  it('static context supports when field', () => {
    let flag = true
    const ctx = context({
      system: 'Rules text',
      when: () => flag,
    })
    expect(ctx.when!({})).toBe(true)
    flag = false
    expect(ctx.when!({})).toBe(false)
  })

  it('context with when is still frozen', () => {
    const ctx = context({
      input: z.object({ x: z.string() }),
      when: ({ input }) => !!input.x,
      system: 'text',
    })
    expect(Object.isFrozen(ctx)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// when() wrapper function
// ─────────────────────────────────────────────────────────────────

describe('when() wrapper', () => {
  it('creates a ConditionalContext with correct tag', () => {
    const ctx = context({ id: 'test', system: 'text' })
    const cond = when(() => true, ctx)

    expect(cond._tag).toBe('ConditionalContext')
    expect(cond.context).toBe(ctx)
    expect(typeof cond.predicate).toBe('function')
  })

  it('wraps the context and stores the predicate', () => {
    const ctx = context({
      id: 'brand',
      input: z.object({ brandVoice: z.string().optional() }),
      system: ({ input }) => input.brandVoice ?? '',
    })

    const cond = when((input) => !!input.brandVoice, ctx)

    expect(cond.predicate({ brandVoice: 'Professional' })).toBe(true)
    expect(cond.predicate({ brandVoice: undefined })).toBe(false)
    expect(cond.predicate({})).toBe(false)
  })

  it('is frozen', () => {
    const ctx = context({ system: 'text' })
    const cond = when(() => true, ctx)
    expect(Object.isFrozen(cond)).toBe(true)
  })

  it('works with explicit generic for prompt-level fields', () => {
    const ctx = context({ id: 'research', system: 'Research mode' })
    const cond = when<{ mode: string }>((input) => input.mode === 'research', ctx)

    expect(cond.predicate({ mode: 'research' })).toBe(true)
    expect(cond.predicate({ mode: 'create' })).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────
// match() function
// ─────────────────────────────────────────────────────────────────

describe('match()', () => {
  const researchCtx = context({ id: 'research', system: 'Research mode' })
  const createCtx = context({ id: 'create', system: 'Create mode' })
  const optimizeCtx = context({ id: 'optimize', system: 'Optimize mode' })

  it('creates a MatchSpec with correct tag', () => {
    const spec = match({
      on: (input) => input.mode as string,
      cases: { research: researchCtx, create: createCtx },
    })

    expect(spec._tag).toBe('MatchSpec')
    expect(typeof spec.on).toBe('function')
    expect(spec.cases).toHaveProperty('research')
    expect(spec.cases).toHaveProperty('create')
  })

  it('is frozen', () => {
    const spec = match({
      on: (input) => input.mode as string,
      cases: { research: researchCtx },
    })
    expect(Object.isFrozen(spec)).toBe(true)
    expect(Object.isFrozen(spec.cases)).toBe(true)
  })

  it('supports default fallback', () => {
    const spec = match({
      on: (input) => input.mode as string,
      cases: { research: researchCtx },
      default: createCtx,
    })
    expect(spec.default).toBe(createCtx)
  })

  it('supports array of contexts per case', () => {
    const spec = match({
      on: (input) => input.mode as string,
      cases: {
        optimize: [optimizeCtx, researchCtx],
      },
    })
    const branch = spec.cases['optimize']
    expect(Array.isArray(branch)).toBe(true)
    expect((branch as any[]).length).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────
// flattenContextEntries()
// ─────────────────────────────────────────────────────────────────

describe('flattenContextEntries()', () => {
  const ctx1 = context({ id: 'a', system: 'A' })
  const ctx2 = context({ id: 'b', system: 'B' })
  const ctx3 = context({ id: 'c', system: 'C' })

  it('passes through plain contexts', () => {
    const { active, excluded } = flattenContextEntries([ctx1, ctx2], {})
    expect(active).toEqual([ctx1, ctx2])
    expect(excluded).toEqual([])
  })

  it('filters out falsy entries', () => {
    const { active } = flattenContextEntries([ctx1, false, null, undefined, ctx2], {})
    expect(active).toEqual([ctx1, ctx2])
  })

  it('excludes contexts with context-level when returning false', () => {
    const conditional = context({
      id: 'cond',
      input: z.object({ flag: z.boolean() }),
      when: ({ input }) => input.flag,
      system: 'conditional text',
    })

    const { active, excluded } = flattenContextEntries([ctx1, conditional], {
      flag: false,
    })
    expect(active).toEqual([ctx1])
    expect(excluded).toHaveLength(1)
    expect(excluded[0].source).toBe('context:cond')
    expect(excluded[0].reason).toContain('context-level when')
  })

  it('includes contexts with context-level when returning true', () => {
    const conditional = context({
      id: 'cond',
      input: z.object({ flag: z.boolean() }),
      when: ({ input }) => input.flag,
      system: 'conditional text',
    })

    const { active } = flattenContextEntries([ctx1, conditional], {
      flag: true,
    })
    expect(active).toHaveLength(2)
  })

  it('evaluates when() wrapper predicates', () => {
    const cond = when<{ mode: string }>((input) => input.mode === 'research', ctx2)

    const result1 = flattenContextEntries([ctx1, cond], { mode: 'research' })
    expect(result1.active).toEqual([ctx1, ctx2])

    const result2 = flattenContextEntries([ctx1, cond], { mode: 'create' })
    expect(result2.active).toEqual([ctx1])
    expect(result2.excluded).toHaveLength(1)
    expect(result2.excluded[0].source).toBe('context:b')
  })

  it('evaluates match() and selects correct branch', () => {
    const spec = match({
      on: (input) => input.mode as string,
      cases: {
        research: ctx1,
        create: ctx2,
        optimize: ctx3,
      },
    })

    const r1 = flattenContextEntries([spec], { mode: 'research' })
    expect(r1.active).toEqual([ctx1])

    const r2 = flattenContextEntries([spec], { mode: 'create' })
    expect(r2.active).toEqual([ctx2])

    const r3 = flattenContextEntries([spec], { mode: 'optimize' })
    expect(r3.active).toEqual([ctx3])
  })

  it('match() uses default when no case matches', () => {
    const spec = match({
      on: (input) => input.mode as string,
      cases: { research: ctx1 },
      default: ctx2,
    })

    const { active } = flattenContextEntries([spec], { mode: 'unknown' })
    expect(active).toEqual([ctx2])
  })

  it('match() excludes when no case matches and no default', () => {
    const spec = match({
      on: (input) => input.mode as string,
      cases: { research: ctx1 },
    })

    const { active, excluded } = flattenContextEntries([spec], {
      mode: 'unknown',
    })
    expect(active).toEqual([])
    expect(excluded).toHaveLength(1)
    expect(excluded[0].reason).toContain('no case for "unknown"')
  })

  it('match() with array branch includes all contexts', () => {
    const spec = match({
      on: (input) => input.mode as string,
      cases: {
        optimize: [ctx2, ctx3],
      },
    })

    const { active } = flattenContextEntries([spec], { mode: 'optimize' })
    expect(active).toEqual([ctx2, ctx3])
  })

  it('excluded context tools are NOT collected', async () => {
    const toolCtx = context({
      id: 'with-tools',
      input: z.object({ active: z.boolean() }),
      when: ({ input }) => input.active,
      system: 'text',
      tools: { searchWeb: 'tool-def' },
    })

    const { active } = flattenContextEntries([toolCtx], { active: false })
    expect(active).toEqual([])
    // Tools are only collected from active contexts, so no tools from toolCtx
  })
})

// ─────────────────────────────────────────────────────────────────
// mergeInputSchemas() with ContextEntry[]
// ─────────────────────────────────────────────────────────────────

describe('mergeInputSchemas() with ContextEntry', () => {
  it('handles plain contexts (backwards compatible)', () => {
    const ctx1 = context({
      id: 'a',
      input: z.object({ x: z.string() }),
      system: 'text',
    })
    const ctx2 = context({
      id: 'b',
      input: z.object({ y: z.number() }),
      system: 'text',
    })

    const schema = mergeInputSchemas([ctx1, ctx2], undefined)
    expect(schema).toBeDefined()

    const result = (schema as any).safeParse({ x: 'hello', y: 42 })
    expect(result.success).toBe(true)
  })

  it('filters falsy entries', () => {
    const ctx = context({
      id: 'a',
      input: z.object({ x: z.string() }),
      system: 'text',
    })

    const schema = mergeInputSchemas([ctx, false, null, undefined], undefined)
    expect(schema).toBeDefined()

    const result = (schema as any).safeParse({ x: 'hello' })
    expect(result.success).toBe(true)
  })

  it('makes ConditionalContext input keys optional', () => {
    const ctx = context({
      id: 'brand',
      input: z.object({ brandVoice: z.string() }),
      system: 'text',
    })
    const cond = when(() => true, ctx)

    const schema = mergeInputSchemas([cond], undefined)
    expect(schema).toBeDefined()

    // brandVoice should be optional since context is conditional
    const withKey = (schema as any).safeParse({ brandVoice: 'test' })
    expect(withKey.success).toBe(true)

    const withoutKey = (schema as any).safeParse({})
    expect(withoutKey.success).toBe(true) // optional — should pass without key
  })

  it('makes context-level when input keys optional', () => {
    const ctx = context({
      id: 'lang',
      input: z.object({ lang: z.string() }),
      when: ({ input }) => input.lang !== 'English',
      system: 'text',
    })

    const schema = mergeInputSchemas([ctx], undefined)
    expect(schema).toBeDefined()

    // lang should be optional since context has a when field
    const withoutKey = (schema as any).safeParse({})
    expect(withoutKey.success).toBe(true)
  })

  it('still detects key conflicts', () => {
    const ctx1 = context({
      id: 'a',
      input: z.object({ x: z.string() }),
      system: 'text',
    })
    const ctx2 = context({
      id: 'b',
      input: z.object({ x: z.number() }),
      system: 'text',
    })

    expect(() => mergeInputSchemas([ctx1, ctx2], undefined)).toThrow(/Input key "x" is defined by both/)
  })

  it('extracts contexts from match branches for schema merging', () => {
    const ctxA = context({
      id: 'a',
      input: z.object({ research: z.string() }),
      system: 'A',
    })
    const ctxB = context({
      id: 'b',
      input: z.object({ creative: z.string() }),
      system: 'B',
    })

    const spec = match({
      on: (input) => input.mode as string,
      cases: { research: ctxA, creative: ctxB },
    })

    const schema = mergeInputSchemas([spec], undefined)
    expect(schema).toBeDefined()

    // Both branch keys should be optional
    const result = (schema as any).safeParse({})
    expect(result.success).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// End-to-end: prompt + resolve with conditional contexts
// ─────────────────────────────────────────────────────────────────

describe('prompt with conditional contexts', () => {
  it('resolves with context-level when (included)', async () => {
    const langCtx = context({
      id: 'lang',
      input: z.object({ lang: z.string().optional() }),
      when: ({ input }) => !!input.lang && input.lang !== 'English',
      system: ({ input }) => `## Language\nRespond in ${input.lang}.`,
    })

    const p = makePrompt({
      id: 'test',
      use: [langCtx] as const,
      system: 'Base system.',
    })

    const resolved = await p.resolve({ input: { lang: 'French' } })
    expect(resolved.system).toContain('Respond in French')
    expect(resolved.system).toContain('Base system.')
  })

  it('resolves with context-level when (excluded)', async () => {
    const langCtx = context({
      id: 'lang',
      input: z.object({ lang: z.string().optional() }),
      when: ({ input }) => !!input.lang && input.lang !== 'English',
      system: ({ input }) => `## Language\nRespond in ${input.lang}.`,
    })

    const p = makePrompt({
      id: 'test',
      use: [langCtx] as const,
      system: 'Base system.',
    })

    const resolved = await p.resolve({ input: { lang: 'English' } })
    expect(resolved.system).toBe('Base system.')
    expect(resolved.system).not.toContain('Respond in')
  })

  it('resolves with when() wrapper', async () => {
    const brandCtx = context({
      id: 'brand',
      input: z.object({ brandVoice: z.string().optional() }),
      system: ({ input }) => `## Brand\n${input.brandVoice}`,
    })

    const p = makePrompt({
      id: 'test',
      use: [when((i) => !!i.brandVoice, brandCtx)] as const,
      system: 'Base.',
    })

    const with_ = await p.resolve({ input: { brandVoice: 'Professional' } })
    expect(with_.system).toContain('Professional')

    const without = await p.resolve({ input: {} })
    expect(without.system).toBe('Base.')
  })

  it('resolves with match()', async () => {
    const researchCtx = context({
      id: 'research',
      system: 'Research instructions',
    })
    const createCtx = context({ id: 'create', system: 'Create instructions' })

    const p = makePrompt({
      id: 'test',
      use: [
        match<{ mode: string }>({
          on: (input) => input.mode,
          cases: { research: researchCtx, create: createCtx },
        }),
      ] as const,
      input: z.object({ mode: z.string() }),
      system: 'Base.',
    })

    const r1 = await p.resolve({ input: { mode: 'research' } })
    expect(r1.system).toContain('Research instructions')
    expect(r1.system).not.toContain('Create instructions')

    const r2 = await p.resolve({ input: { mode: 'create' } })
    expect(r2.system).toContain('Create instructions')
    expect(r2.system).not.toContain('Research instructions')
  })

  it('resolves with falsy entries in use array', async () => {
    const ctx = context({ id: 'always', system: 'Always here' })

    const p = makePrompt({
      id: 'test',
      use: [ctx, false, null, undefined] as const,
      system: 'Base.',
    })

    const resolved = await p.resolve({ input: undefined })
    expect(resolved.system).toContain('Always here')
  })

  it('excluded contexts do not contribute tools', async () => {
    const toolCtx = context({
      id: 'tools',
      input: z.object({ enabled: z.boolean() }),
      when: ({ input }) => input.enabled,
      system: 'With tools',
      tools: { searchWeb: { description: 'Search' } },
    })

    const p = makePrompt({
      id: 'test',
      use: [toolCtx] as const,
      system: 'Base.',
    })

    const excluded = await p.resolve({ input: { enabled: false } })
    expect(excluded.tools).toBeUndefined()

    const included = await p.resolve({ input: { enabled: true } })
    expect(included.tools).toBeDefined()
    expect(included.tools).toHaveProperty('searchWeb')
  })

  it('inspect() reports excluded contexts', async () => {
    const alwaysCtx = context({ id: 'always', system: 'Always here' })
    const condCtx = context({
      id: 'conditional',
      input: z.object({ flag: z.boolean() }),
      when: ({ input }) => input.flag,
      system: 'Conditional text',
    })

    const p = makePrompt({
      id: 'test',
      use: [alwaysCtx, condCtx] as const,
      system: 'Base.',
    })

    const inspection = await p.inspect({ input: { flag: false } })
    expect(inspection.excludedContexts).toHaveLength(1)
    expect(inspection.excludedContexts[0].source).toBe('context:conditional')
    expect(inspection.excludedContexts[0].reason).toContain('when')
  })

  it('inspect() reports no excluded contexts when all active', async () => {
    const ctx = context({
      id: 'cond',
      input: z.object({ flag: z.boolean() }),
      when: ({ input }) => input.flag,
      system: 'Text',
    })

    const p = makePrompt({
      id: 'test',
      use: [ctx] as const,
      system: 'Base.',
    })

    const inspection = await p.inspect({ input: { flag: true } })
    expect(inspection.excludedContexts).toHaveLength(0)
  })

  it('backwards compatible: plain use array still works', async () => {
    const ctx1 = context({ id: 'a', system: 'A' })
    const ctx2 = context({ id: 'b', system: 'B' })

    const p = makePrompt({
      id: 'test',
      use: [ctx1, ctx2] as const,
      system: 'Base.',
    })

    const resolved = await p.resolve({ input: undefined })
    expect(resolved.system).toContain('A')
    expect(resolved.system).toContain('B')
  })
})
