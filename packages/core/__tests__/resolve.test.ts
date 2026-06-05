import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import {
  resolveStringOrFn,
  resolveAdaptation,
  mergeInputSchemas,
  composeSystem,
  collectContextTools,
  resolvePrompt,
  inspectArgs,
} from '../resolve'
import { context } from '../context'
import { setTokenizer, defaultTokenizer } from '../tokenizer'
import type { AdapterMap, ModelInfo, PromptConfig } from '../types'

// Reset tokenizer after each test to avoid state leakage
afterEach(() => {
  setTokenizer(defaultTokenizer)
})

// ─────────────────────────────────────────────────────────────────
// resolveStringOrFn
// ─────────────────────────────────────────────────────────────────

describe('resolveStringOrFn', () => {
  it('returns a static string as-is', async () => {
    expect(await resolveStringOrFn('hello', {})).toBe('hello')
  })

  it('calls a function with { input } and returns its result', async () => {
    const fn = ({ input }: { input: { name: string } }) => `Hi ${input.name}`
    expect(await resolveStringOrFn(fn, { name: 'Alice' })).toBe('Hi Alice')
  })

  it('returns empty string for undefined', async () => {
    expect(await resolveStringOrFn(undefined, {})).toBe('')
  })

  it('handles async functions', async () => {
    const fn = async ({ input }: { input: { name: string } }) => {
      await new Promise((r) => setTimeout(r, 1))
      return `Hi ${input.name}`
    }
    expect(await resolveStringOrFn(fn, { name: 'Bob' })).toBe('Hi Bob')
  })
})

// ─────────────────────────────────────────────────────────────────
// resolveAdaptation
// ─────────────────────────────────────────────────────────────────

describe('resolveAdaptation', () => {
  const adapt: AdapterMap = {
    anthropic: { appendSystem: 'Be concise.' },
    openai: { settings: { temperature: 0.1 } },
    '*': { appendSystem: 'JSON only.' },
  }

  it('matches exact provider', () => {
    const info: ModelInfo = { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' }
    expect(resolveAdaptation(adapt, info)).toEqual({ appendSystem: 'Be concise.' })
  })

  it('matches modelId slash-prefix (OpenRouter style)', () => {
    const info: ModelInfo = { provider: '', modelId: 'openai/gpt-4o' }
    expect(resolveAdaptation(adapt, info)).toEqual({ settings: { temperature: 0.1 } })
  })

  it('falls back to wildcard', () => {
    const info: ModelInfo = { provider: 'mistral', modelId: 'mistral-large' }
    expect(resolveAdaptation(adapt, info)).toEqual({ appendSystem: 'JSON only.' })
  })

  it('returns undefined when no adapt map', () => {
    const info: ModelInfo = { provider: 'openai', modelId: 'gpt-4o' }
    expect(resolveAdaptation(undefined, info)).toBeUndefined()
  })

  it('exact provider takes priority over prefix and wildcard', () => {
    const info: ModelInfo = { provider: 'openai', modelId: 'openai/gpt-4o' }
    // exact provider "openai" should win, not re-match via slash prefix
    expect(resolveAdaptation(adapt, info)).toEqual({ settings: { temperature: 0.1 } })
  })
})

// ─────────────────────────────────────────────────────────────────
// mergeInputSchemas
// ─────────────────────────────────────────────────────────────────

describe('mergeInputSchemas', () => {
  it('merges two context schemas into one object', () => {
    const ctx1 = context({
      id: 'a',
      input: z.object({ foo: z.string() }),
      system: 'a',
    })
    const ctx2 = context({
      id: 'b',
      input: z.object({ bar: z.number() }),
      system: 'b',
    })

    const merged = mergeInputSchemas([ctx1, ctx2], undefined)
    expect(merged).toBeDefined()

    // Should accept valid input
    const result = (merged as any).safeParse({ foo: 'x', bar: 42 })
    expect(result.success).toBe(true)
  })

  it('throws on duplicate key across contexts', () => {
    const ctx1 = context({
      id: 'first',
      input: z.object({ name: z.string() }),
      system: 'a',
    })
    const ctx2 = context({
      id: 'second',
      input: z.object({ name: z.string() }),
      system: 'b',
    })

    expect(() => mergeInputSchemas([ctx1, ctx2], undefined)).toThrow(
      /Input key "name" is defined by both "first" and "second"/,
    )
  })

  it("prompt's own fields take precedence over context fields (no error)", () => {
    const ctx = context({
      id: 'ctx',
      input: z.object({ lang: z.string() }),
      system: 'a',
    })
    const ownInput = z.object({ lang: z.string().optional() })

    // Should NOT throw even though "lang" exists in both
    const merged = mergeInputSchemas([ctx], ownInput)
    expect(merged).toBeDefined()

    // Prompt's version (optional) should take precedence
    const result = (merged as any).safeParse({})
    expect(result.success).toBe(true)
  })

  it('returns undefined when no schemas exist', () => {
    const ctx = context({ system: 'static' })
    expect(mergeInputSchemas([ctx], undefined)).toBeUndefined()
  })

  it('returns schema for a single context with input', () => {
    const ctx = context({
      input: z.object({ x: z.number() }),
      system: 'a',
    })
    const merged = mergeInputSchemas([ctx], undefined)
    expect(merged).toBeDefined()
    const result = (merged as any).safeParse({ x: 5 })
    expect(result.success).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// composeSystem
// ─────────────────────────────────────────────────────────────────

describe('composeSystem', () => {
  it('joins prompt system + context contributions with \\n\\n', async () => {
    const ctx = context({ id: 'rules', system: 'Follow the rules.' })
    const { system } = await composeSystem('You are a bot.', [ctx], {})
    expect(system).toBe('You are a bot.\n\nFollow the rules.')
  })

  it('omits empty context returns', async () => {
    const ctx = context({
      id: 'maybe',
      input: z.object({ note: z.string().optional() }),
      system: ({ input }) => (input.note ? input.note : ''),
    })
    const { system, parts } = await composeSystem('Base.', [ctx], {})
    expect(system).toBe('Base.')
    // The context part should be marked as skipped
    const ctxPart = parts.find((p) => p.source === 'context:maybe')
    expect(ctxPart?.skipped).toBe(true)
  })

  it('drops lowest-priority contexts first when token budget is tight', async () => {
    // Use a simple 1-char-per-token tokenizer for predictability
    setTokenizer((text) => text.length)

    const low = context({ id: 'low', system: 'AAAA', priority: 10 }) // 4 tokens
    const high = context({ id: 'high', system: 'BB', priority: 90 }) // 2 tokens

    // Own system "X" = 1 token
    // Budget = 5 → can fit own(1) + separator(1) + high(2) = 4, but not low(4) extra
    const { system, droppedContexts } = await composeSystem('X', [low, high], {}, 5)

    expect(system).toContain('BB')
    expect(system).not.toContain('AAAA')
    expect(droppedContexts).toHaveLength(1)
    expect(droppedContexts[0].source).toBe('context:low')
    expect(droppedContexts[0].priority).toBe(10)
  })

  it("never drops prompt's own system text", async () => {
    setTokenizer((text) => text.length)

    const ctx = context({ id: 'ctx', system: 'context text', priority: 10 })
    // Budget just enough for the own system
    const { system } = await composeSystem('my system', [ctx], {}, 10)

    expect(system).toContain('my system')
  })

  it('reports dropped contexts with source/tokens/priority', async () => {
    setTokenizer((text) => text.length)

    const ctx = context({ id: 'dropped', system: 'abcdef', priority: 5 })
    const { droppedContexts } = await composeSystem('', [ctx], {}, 1)

    expect(droppedContexts).toHaveLength(1)
    expect(droppedContexts[0]).toMatchObject({
      source: 'context:dropped',
      tokens: 6,
      priority: 5,
    })
  })

  it('includes everything when no budget is specified', async () => {
    const ctx1 = context({ id: 'a', system: 'A' })
    const ctx2 = context({ id: 'b', system: 'B' })
    const { system, droppedContexts } = await composeSystem('SYS', [ctx1, ctx2], {})

    expect(system).toBe('SYS\n\nA\n\nB')
    expect(droppedContexts).toHaveLength(0)
  })

  it('handles async context system functions', async () => {
    const asyncCtx = context({
      id: 'async',
      system: async () => {
        await new Promise((r) => setTimeout(r, 1))
        return 'Async result'
      },
    })

    const { system } = await composeSystem('Base.', [asyncCtx], {})
    expect(system).toBe('Base.\n\nAsync result')
  })

  // ── System Blocks ──

  it('returns systemBlocks alongside flat system string', async () => {
    const ctx1 = context({ id: 'rules', system: 'Follow rules.' })
    const ctx2 = context({ id: 'brand', system: 'Be bold.' })
    const { system, blocks } = await composeSystem('You are a bot.', [ctx1, ctx2], {})

    expect(system).toBe('You are a bot.\n\nFollow rules.\n\nBe bold.')
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toMatchObject({ source: 'prompt', text: 'You are a bot.' })
    expect(blocks[1]).toMatchObject({ source: 'context:rules', text: 'Follow rules.' })
    expect(blocks[2]).toMatchObject({ source: 'context:brand', text: 'Be bold.' })
  })

  it('blocks carry providerCache from context', async () => {
    const cached = context({ id: 'cached', system: () => 'cached text', cache: 300_000 })
    const uncached = context({ id: 'uncached', system: 'plain text' })
    const { blocks } = await composeSystem('System.', [cached, uncached], {})

    expect(blocks).toHaveLength(3)
    expect(blocks[0].providerCache).toBe(false) // prompt's own system
    expect(blocks[1].providerCache).toBe(true) // cached context
    expect(blocks[2].providerCache).toBe(false) // uncached context
  })

  it('skipped contexts are excluded from blocks', async () => {
    const empty = context({
      id: 'empty',
      input: z.object({ note: z.string().optional() }),
      system: ({ input }) => (input.note ? input.note : ''),
    })
    const { blocks } = await composeSystem('Base.', [empty], {})
    // Only the prompt block should be present
    expect(blocks).toHaveLength(1)
    expect(blocks[0].source).toBe('prompt')
  })

  it('dropped contexts are excluded from blocks', async () => {
    setTokenizer((text) => text.length)
    const low = context({ id: 'low', system: 'AAAA', priority: 10 })
    const high = context({ id: 'high', system: 'BB', priority: 90 })
    const { blocks } = await composeSystem('X', [low, high], {}, 5)

    // Only prompt + high should be in blocks
    const sources = blocks.map((b) => b.source)
    expect(sources).toContain('prompt')
    expect(sources).toContain('context:high')
    expect(sources).not.toContain('context:low')
  })

  // ── Application-level resolver caching ──

  describe('resolver caching', () => {
    it('cached context resolver is called once for repeated calls with same input', async () => {
      const resolver = vi.fn(() => 'cached result')
      const cached = context({ id: 'c1', system: resolver, cache: 300_000 })

      await composeSystem('', [cached], { orgId: '123' })
      await composeSystem('', [cached], { orgId: '123' })

      expect(resolver).toHaveBeenCalledTimes(1)
    })

    it('cached context resolver is called again for different input', async () => {
      const resolver = vi.fn(({ input }: any) => `result-${input.orgId}`)
      const cached = context({
        id: 'c2',
        input: z.object({ orgId: z.string() }),
        system: resolver as any,
        cache: 300_000,
      })

      const r1 = await composeSystem('', [cached], { orgId: 'a' })
      const r2 = await composeSystem('', [cached], { orgId: 'b' })

      expect(resolver).toHaveBeenCalledTimes(2)
      expect(r1.system).toContain('result-a')
      expect(r2.system).toContain('result-b')
    })

    it('cached result expires after TTL', async () => {
      vi.useFakeTimers()
      try {
        const resolver = vi.fn(() => 'cached')
        const cached = context({ id: 'c3', system: resolver, cache: 1000 })

        await composeSystem('', [cached], {})
        expect(resolver).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(1001)
        await composeSystem('', [cached], {})
        expect(resolver).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('uncached contexts are always resolved fresh', async () => {
      const resolver = vi.fn(() => 'fresh')
      const uncached = context({ id: 'u1', system: resolver })

      await composeSystem('', [uncached], {})
      await composeSystem('', [uncached], {})

      expect(resolver).toHaveBeenCalledTimes(2)
    })
  })
})

// ─────────────────────────────────────────────────────────────────
// collectContextTools
// ─────────────────────────────────────────────────────────────────

describe('collectContextTools', () => {
  it('merges tools from multiple contexts', () => {
    const ctx1 = context({ system: 'a', tools: { search: 'tool1' } })
    const ctx2 = context({ system: 'b', tools: { analyze: 'tool2' } })

    const tools = collectContextTools([ctx1, ctx2], {})
    expect(tools).toEqual({ search: 'tool1', analyze: 'tool2' })
  })

  it('later contexts overwrite earlier on name collision', () => {
    const ctx1 = context({ system: 'a', tools: { run: 'v1' } })
    const ctx2 = context({ system: 'b', tools: { run: 'v2' } })

    const tools = collectContextTools([ctx1, ctx2], {})
    expect(tools).toEqual({ run: 'v2' })
  })

  it('contexts without tools contribute nothing', () => {
    const ctx = context({ system: 'no tools' })
    const tools = collectContextTools([ctx], {})
    expect(Object.keys(tools)).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────
// resolvePrompt (full pipeline)
// ─────────────────────────────────────────────────────────────────

describe('resolvePrompt', () => {
  it('validates input against merged schema (rejects invalid)', async () => {
    const schema = z.object({ name: z.string() })

    await expect(
      resolvePrompt({ system: 'test', input: schema } as PromptConfig<any, any, any>, { input: { name: 123 } }, schema),
    ).rejects.toThrow(/Input validation failed/)
  })

  it('composes system from prompt + contexts', async () => {
    const ctx = context({ id: 'ctx', system: 'Context here.' })
    const config: PromptConfig<any, any, any> = {
      system: 'You are a bot.',
      use: [ctx],
    }

    const result = await resolvePrompt(config, {}, undefined)
    expect(result.system).toBe('You are a bot.\n\nContext here.')
  })

  it('inspects segmented base prompt and context system text', async () => {
    const ctx = context({
      id: 'brand',
      input: z.object({ brand: z.string() }),
      system: ({ input }) => ({
        segments: [
          { text: 'Brand: ', dynamic: false },
          { text: input.brand, dynamic: true, source: 'brand' },
        ],
      }),
    })
    const config: PromptConfig<any, any, any> = {
      system: {
        segments: [
          { text: 'You are ', dynamic: false },
          { text: 'an editor', dynamic: true, source: 'role' },
          { text: '.', dynamic: false },
        ],
      },
      use: [ctx],
    }

    const inspect = await inspectArgs(config, { input: { brand: 'Crux' } }, undefined)

    expect(inspect.system.parts).toEqual([
      expect.objectContaining({
        source: 'prompt',
        text: 'You are an editor.',
        segments: [
          { text: 'You are ', dynamic: false },
          { text: 'an editor', dynamic: true, source: 'role' },
          { text: '.', dynamic: false },
        ],
        staticTokens: expect.any(Number),
        dynamicTokens: expect.any(Number),
      }),
      expect.objectContaining({
        source: 'context:brand',
        text: 'Brand: Crux',
        segments: [
          { text: 'Brand: ', dynamic: false },
          { text: 'Crux', dynamic: true, source: 'brand' },
        ],
        staticTokens: expect.any(Number),
        dynamicTokens: expect.any(Number),
      }),
    ])
  })

  it('infers granular segments for string-template base prompts and contexts', async () => {
    const ctx = context({
      id: 'current-date',
      input: z.object({ today: z.string() }),
      system: ({ input }) => `Today is ${input.today}.`,
    })
    const input = {
      workspace: { name: 'Acme Corp' },
      account: { plan: 'annual' },
      today: '2026-06-04',
    }
    const schema = z.object({
      workspace: z.object({ name: z.string() }),
      account: z.object({ plan: z.string() }),
      today: z.string(),
    })
    const config = {
      input: schema,
      system: ({ input }) => `Workspace ${input.workspace.name} uses ${input.account.plan}.`,
      use: [ctx] as const,
    } satisfies PromptConfig<typeof schema, undefined, readonly [typeof ctx]>

    const inspect = await inspectArgs(config, { input }, schema)
    expect(inspect.system.parts[0]).toMatchObject({
      source: 'prompt',
      text: 'Workspace Acme Corp uses annual.',
      segments: [
        { text: 'Workspace ', dynamic: false },
        { text: 'Acme Corp', dynamic: true, source: 'workspace.name' },
        { text: ' uses ', dynamic: false },
        { text: 'annual', dynamic: true, source: 'account.plan' },
        { text: '.', dynamic: false },
      ],
    })
    expect(inspect.system.parts[1]).toMatchObject({
      source: 'context:current-date',
      text: 'Today is 2026-06-04.',
      segments: [
        { text: 'Today is ', dynamic: false },
        { text: '2026-06-04', dynamic: true, source: 'today' },
        { text: '.', dynamic: false },
      ],
    })

    const result = await resolvePrompt(config, { input }, schema)
    expect(result.systemBlocks?.[0]).toMatchObject({
      source: 'prompt',
      segments: [
        { text: 'Workspace ', dynamic: false },
        { text: 'Acme Corp', dynamic: true, source: 'workspace.name' },
        { text: ' uses ', dynamic: false },
        { text: 'annual', dynamic: true, source: 'account.plan' },
        { text: '.', dynamic: false },
      ],
    })
    expect(result.systemBlocks?.[1]).toMatchObject({
      source: 'context:current-date',
      segments: [
        { text: 'Today is ', dynamic: false },
        { text: '2026-06-04', dynamic: true, source: 'today' },
        { text: '.', dynamic: false },
      ],
    })
  })

  it('resolves prompt text from string', async () => {
    const config: PromptConfig<any, any, any> = {
      system: 'sys',
      prompt: 'do this',
    }
    const result = await resolvePrompt(config, {}, undefined)
    expect(result.prompt).toBe('do this')
  })

  it('resolves prompt text from function', async () => {
    const config: PromptConfig<any, any, any> = {
      system: 'sys',
      prompt: ({ input }: any) => `Task: ${input.task}`,
    }
    const result = await resolvePrompt(config, { input: { task: 'edit' } }, undefined)
    expect(result.prompt).toBe('Task: edit')
  })

  it('applies adaptation: prepend/append system and prompt', async () => {
    const config: PromptConfig<any, any, any> = {
      system: 'core',
      prompt: 'question',
      adapt: {
        openai: {
          prependSystem: 'BEFORE',
          appendSystem: 'AFTER',
          prependPrompt: '[',
          appendPrompt: ']',
        },
      },
    }

    const result = await resolvePrompt(config, { provider: 'openai', modelId: '' }, undefined)
    expect(result.system).toBe('BEFORE\n\ncore\n\nAFTER')
    expect(result.prompt).toBe('[question]')
  })

  it('merges settings: config < adapt < call-site', async () => {
    const config: PromptConfig<any, any, any> = {
      system: 'sys',
      settings: { temperature: 0.5, maxTokens: 100 },
      adapt: {
        openai: { settings: { temperature: 0.2 } },
      },
    }

    const result = await resolvePrompt(config, { provider: 'openai', modelId: '', temperature: 0.9 }, undefined)
    expect(result.settings.temperature).toBe(0.9) // call-site wins
    expect(result.settings.maxTokens).toBe(100) // from config (not overridden)
  })

  it('collects tools in text mode (no output schema)', async () => {
    const ctx = context({ system: 'a', tools: { ctxTool: 'ct' } })
    const config: PromptConfig<any, any, any> = {
      system: 'sys',
      use: [ctx],
      tools: { promptTool: 'pt' },
    }

    const result = await resolvePrompt(config, {}, undefined)
    expect(result.tools).toEqual({ ctxTool: 'ct', promptTool: 'pt' })
  })

  it('collects tools in structured mode (has output schema)', async () => {
    const ctx = context({ system: 'a', tools: { ctxTool: 'ct' } })
    const config: PromptConfig<any, any, any> = {
      system: 'sys',
      use: [ctx],
      tools: { promptTool: 'pt' },
      output: z.object({ result: z.string() }),
    }

    const result = await resolvePrompt(config, {}, undefined)
    expect(result.tools).toEqual({ ctxTool: 'ct', promptTool: 'pt' })
    expect(result.schema).toBeDefined()
  })

  it('messages mode: injects system into messages array', async () => {
    const ctx = context({ id: 'rules', system: 'Be polite.' })
    const config: PromptConfig<any, any, any> = {
      use: [ctx],
      messages: () => [{ role: 'user', content: 'Hello' }],
    }

    const result = await resolvePrompt(config, {}, undefined)
    expect(result.messages).toBeDefined()
    expect(result.messages![0]).toEqual({
      role: 'system',
      content: 'Be polite.',
    })
    expect(result.messages![1]).toEqual({
      role: 'user',
      content: 'Hello',
    })
    // system should be empty since it was incorporated into messages
    expect(result.system).toBeUndefined()
  })

  it('messages mode: prepends to existing system message', async () => {
    const ctx = context({ id: 'ctx', system: 'Context.' })
    const config: PromptConfig<any, any, any> = {
      use: [ctx],
      messages: () => [
        { role: 'system', content: 'Original system.' },
        { role: 'user', content: 'Hi' },
      ],
    }

    const result = await resolvePrompt(config, {}, undefined)
    expect(result.messages![0].content).toBe('Context.\n\nOriginal system.')
  })

  it('resolvePrompt returns systemBlocks on the resolved result', async () => {
    const cached = context({ id: 'brand', system: () => 'Brand voice.', cache: 300_000 })
    const plain = context({ id: 'rules', system: 'Follow rules.' })
    const config: PromptConfig<any, any, any> = {
      system: 'You are a bot.',
      use: [cached, plain],
    }

    const result = await resolvePrompt(config, {}, undefined)
    expect(result.system).toBe('You are a bot.\n\nBrand voice.\n\nFollow rules.')
    expect(result.systemBlocks).toBeDefined()
    expect(result.systemBlocks).toHaveLength(3)
    expect(result.systemBlocks![0]).toMatchObject({ source: 'prompt', text: 'You are a bot.', providerCache: false })
    expect(result.systemBlocks![1]).toMatchObject({
      source: 'context:brand',
      text: 'Brand voice.',
      providerCache: true,
    })
    expect(result.systemBlocks![2]).toMatchObject({
      source: 'context:rules',
      text: 'Follow rules.',
      providerCache: false,
    })
  })
})

// ─────────────────────────────────────────────────────────────────
// inspectArgs
// ─────────────────────────────────────────────────────────────────

describe('inspectArgs', () => {
  it('returns per-part token breakdown with source attribution', async () => {
    const ctx = context({ id: 'rules', system: 'Follow rules.' })
    const config: PromptConfig<any, any, any> = {
      system: 'You are a bot.',
      prompt: 'What now?',
      use: [ctx],
    }

    const result = await inspectArgs(config, {}, undefined)

    expect(result.system.parts).toHaveLength(2)
    expect(result.system.parts[0].source).toBe('prompt')
    expect(result.system.parts[0].text).toBe('You are a bot.')
    expect(result.system.parts[1].source).toBe('context:rules')
    expect(result.prompt).toBeDefined()
    expect(result.prompt!.text).toBe('What now?')
    expect(result.totalTokens).toBeGreaterThan(0)
  })

  it('reports dropped contexts', async () => {
    setTokenizer((text) => text.length)

    const ctx = context({ id: 'big', system: 'A'.repeat(100), priority: 1 })
    const config: PromptConfig<any, any, any> = {
      system: 'X',
      use: [ctx],
    }

    const result = await inspectArgs(config, { tokenBudget: 5 }, undefined)
    expect(result.droppedContexts).toHaveLength(1)
    expect(result.droppedContexts[0].source).toBe('context:big')
  })

  it('includes tool names', async () => {
    const ctx = context({ system: 'a', tools: { search: 'tool' } })
    const config: PromptConfig<any, any, any> = {
      system: 'sys',
      use: [ctx],
      tools: { analyze: 'tool2' },
    }

    const result = await inspectArgs(config, {}, undefined)
    expect(result.tools).toEqual(['search', 'analyze'])
  })
})
