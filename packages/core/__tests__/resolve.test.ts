import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { compilePrompt, type ResolveCallOptions } from '../resolver/compile'
import { context } from '../prompt/context'
import { setTokenizer, defaultTokenizer } from '../shared/tokenizer'
import type { AnyPromptConfig } from '../types'

afterEach(() => {
  setTokenizer(defaultTokenizer)
})

async function resolveArgs(config: AnyPromptConfig, opts: ResolveCallOptions = {}) {
  return (await compilePrompt(config).resolve(opts)).args
}

async function inspect(config: AnyPromptConfig, opts: ResolveCallOptions = {}) {
  return compilePrompt(config).inspect(opts)
}

describe('compilePrompt input schema', () => {
  it('merges context schemas into one object schema', () => {
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

    const schema = compilePrompt({ system: 'S', use: [ctx1, ctx2] } as AnyPromptConfig).inputSchema
    expect(schema?.safeParse({ foo: 'x', bar: 42 }).success).toBe(true)
  })

  it('throws on duplicate keys across contexts', () => {
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

    expect(() => compilePrompt({ system: 'S', use: [ctx1, ctx2] } as AnyPromptConfig)).toThrow(
      /Input key "name" is defined by both "first" and "second"/,
    )
  })

  it('prompt-owned fields take precedence over context fields', () => {
    const ctx = context({
      id: 'ctx',
      input: z.object({ lang: z.string() }),
      system: 'a',
    })
    const input = z.object({ lang: z.string().optional() })

    const schema = compilePrompt({ system: 'S', input, use: [ctx] } as AnyPromptConfig).inputSchema
    expect(schema?.safeParse({}).success).toBe(true)
  })

  it('returns no schema when neither prompt nor contexts declare input', () => {
    const ctx = context({ system: 'static' })
    expect(compilePrompt({ system: 'S', use: [ctx] } as AnyPromptConfig).inputSchema).toBeUndefined()
  })
})

describe('compilePrompt resolution', () => {
  it('validates input against the compiled schema', async () => {
    const input = z.object({ name: z.string() })

    await expect(
      compilePrompt({ system: 'test', input } as AnyPromptConfig).resolve({ input: { name: 123 } }),
    ).rejects.toThrow(/Input validation failed/)
  })

  it('composes system text from prompt and contexts', async () => {
    const ctx = context({ id: 'ctx', system: 'Context here.' })
    const result = await resolveArgs({ system: 'You are a bot.', use: [ctx] } as AnyPromptConfig)
    expect(result.system).toBe('You are a bot.\n\nContext here.')
  })

  it('resolves prompt text from static strings and functions', async () => {
    const staticResult = await resolveArgs({ system: 'sys', prompt: 'do this' } as AnyPromptConfig)
    expect(staticResult.prompt).toBe('do this')

    const input = z.object({ task: z.string() })
    const dynamicResult = await resolveArgs(
      {
        input,
        system: 'sys',
        prompt: ({ input }) => `Task: ${input.task}`,
      } as AnyPromptConfig,
      { input: { task: 'edit' } },
    )
    expect(dynamicResult.prompt).toBe('Task: edit')
  })

  it('keeps segmented system text in inspect and resolved blocks', async () => {
    const ctx = context({
      id: 'current-date',
      input: z.object({ today: z.string() }),
      system: ({ input }) => `Today is ${input.today}.`,
    })
    const input = z.object({
      workspace: z.object({ name: z.string() }),
      account: z.object({ plan: z.string() }),
      today: z.string(),
    })
    const config = {
      input,
      system: ({ input }) => `Workspace ${input.workspace.name} uses ${input.account.plan}.`,
      use: [ctx],
    } as AnyPromptConfig

    const opts = {
      input: {
        workspace: { name: 'Acme Corp' },
        account: { plan: 'annual' },
        today: '2026-06-04',
      },
    }

    const inspected = await inspect(config, opts)
    expect(inspected.system.parts[0]).toMatchObject({
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
    expect(inspected.system.parts[1]).toMatchObject({
      source: 'context:current-date',
      text: 'Today is 2026-06-04.',
      segments: [
        { text: 'Today is ', dynamic: false },
        { text: '2026-06-04', dynamic: true, source: 'today' },
        { text: '.', dynamic: false },
      ],
    })

    const resolved = await resolveArgs(config, opts)
    expect(resolved.systemBlocks?.[0]).toMatchObject({ source: 'prompt', segments: inspected.system.parts[0].segments })
    expect(resolved.systemBlocks?.[1]).toMatchObject({
      source: 'context:current-date',
      segments: inspected.system.parts[1].segments,
    })
  })

  it('applies provider-specific adaptations and call-site settings precedence', async () => {
    const config = {
      system: 'core',
      prompt: 'question',
      settings: { temperature: 0.5, maxTokens: 100 },
      adapt: {
        openai: {
          prependSystem: 'BEFORE',
          appendSystem: 'AFTER',
          prependPrompt: '[',
          appendPrompt: ']',
          settings: { temperature: 0.2 },
        },
      },
    } as AnyPromptConfig

    const result = await resolveArgs(config, { provider: 'openai', modelId: '', temperature: 0.9 })
    expect(result.system).toBe('BEFORE\n\ncore\n\nAFTER')
    expect(result.prompt).toBe('[question]')
    expect(result.settings.temperature).toBe(0.9)
    expect(result.settings.maxTokens).toBe(100)
  })

  it('matches model id slash-prefix adaptations and wildcard fallbacks', async () => {
    const config = {
      system: 'S',
      adapt: {
        openai: { appendSystem: 'OPENAI' },
        '*': { appendSystem: 'WILD' },
      },
    } as AnyPromptConfig

    expect((await resolveArgs(config, { provider: '', modelId: 'openai/gpt-4o' })).system).toBe('S\n\nOPENAI')
    expect((await resolveArgs(config, { provider: 'mistral', modelId: 'mistral-large' })).system).toBe('S\n\nWILD')
  })

  it('collects context and prompt tools', async () => {
    const ctx = context({ system: 'a', tools: { ctxTool: 'ct' } })
    const config = {
      system: 'sys',
      use: [ctx],
      tools: { promptTool: 'pt' },
    } as AnyPromptConfig

    const result = await resolveArgs(config)
    expect(result.tools).toEqual({ ctxTool: 'ct', promptTool: 'pt' })
  })

  it('supports structured-output prompts while keeping tools available', async () => {
    const ctx = context({ system: 'a', tools: { ctxTool: 'ct' } })
    const config = {
      system: 'sys',
      use: [ctx],
      tools: { promptTool: 'pt' },
      output: z.object({ result: z.string() }),
    } as AnyPromptConfig

    const result = await resolveArgs(config)
    expect(result.schema).toBeDefined()
    expect(result.tools).toEqual({ ctxTool: 'ct', promptTool: 'pt' })
  })

  it('injects composed system text into messages mode', async () => {
    const ctx = context({ id: 'rules', system: 'Be polite.' })
    const result = await resolveArgs({
      use: [ctx],
      messages: () => [{ role: 'user', content: 'Hello' }],
    } as AnyPromptConfig)

    expect(result.messages?.[0]).toEqual({ role: 'system', content: 'Be polite.' })
    expect(result.messages?.[1]).toEqual({ role: 'user', content: 'Hello' })
    expect(result.system).toBeUndefined()
  })

  it('prepends composed system text to an existing system message', async () => {
    const ctx = context({ id: 'ctx', system: 'Context.' })
    const result = await resolveArgs({
      use: [ctx],
      messages: () => [
        { role: 'system', content: 'Original system.' },
        { role: 'user', content: 'Hi' },
      ],
    } as AnyPromptConfig)

    expect(result.messages?.[0]?.content).toBe('Context.\n\nOriginal system.')
  })
})

describe('compilePrompt token-aware system composition', () => {
  it('drops lower-priority contexts first when the token budget is tight', async () => {
    setTokenizer((text) => text.length)

    const low = context({ id: 'low', system: 'AAAA', priority: 10 })
    const high = context({ id: 'high', system: 'BB', priority: 90 })

    const resolved = await resolveArgs({ system: 'X', use: [low, high] } as AnyPromptConfig, { tokenBudget: 5 })
    const inspected = await inspect({ system: 'X', use: [low, high] } as AnyPromptConfig, { tokenBudget: 5 })

    expect(resolved.system).toContain('BB')
    expect(resolved.system).not.toContain('AAAA')
    expect(inspected.droppedContexts).toHaveLength(1)
    expect(inspected.droppedContexts[0]).toMatchObject({
      source: 'context:low',
      priority: 10,
      tokens: 4,
    })
  })

  it('never drops the prompt-owned system text', async () => {
    setTokenizer((text) => text.length)

    const ctx = context({ id: 'ctx', system: 'context text', priority: 10 })
    const result = await resolveArgs({ system: 'my system', use: [ctx] } as AnyPromptConfig, { tokenBudget: 10 })

    expect(result.system).toContain('my system')
  })

  it('returns system blocks with provider cache metadata', async () => {
    const cached = context({ id: 'cached', system: () => 'cached text', cache: 300_000 })
    const uncached = context({ id: 'uncached', system: 'plain text' })
    const result = await resolveArgs({ system: 'System.', use: [cached, uncached] } as AnyPromptConfig)

    expect(result.systemBlocks).toHaveLength(3)
    expect(result.systemBlocks?.[0]).toMatchObject({ source: 'prompt', providerCache: false })
    expect(result.systemBlocks?.[1]).toMatchObject({ source: 'context:cached', providerCache: true })
    expect(result.systemBlocks?.[2]).toMatchObject({ source: 'context:uncached', providerCache: false })
  })

  it('excludes skipped and dropped contexts from blocks', async () => {
    setTokenizer((text) => text.length)

    const empty = context({
      id: 'empty',
      input: z.object({ note: z.string().optional() }),
      system: ({ input }) => (input.note ? input.note : ''),
    })
    const low = context({ id: 'low', system: 'AAAA', priority: 10 })
    const high = context({ id: 'high', system: 'BB', priority: 90 })

    const skipped = await resolveArgs({ system: 'Base.', use: [empty] } as AnyPromptConfig)
    expect(skipped.systemBlocks?.map((block) => block.source)).toEqual(['prompt'])

    const budgeted = await resolveArgs({ system: 'X', use: [low, high] } as AnyPromptConfig, { tokenBudget: 5 })
    expect(budgeted.systemBlocks?.map((block) => block.source)).toEqual(['prompt', 'context:high'])
  })

  it('caches context resolver output by declared input fields', async () => {
    const resolver = vi.fn(({ input }: { input: { orgId: string } }) => `result-${input.orgId}`)
    const cached = context({
      id: 'cache-by-org',
      input: z.object({ orgId: z.string() }),
      system: resolver,
      cache: 300_000,
    })
    const compiled = compilePrompt({ system: '', use: [cached] } as AnyPromptConfig)

    const r1 = await compiled.resolve({ input: { orgId: 'a' } })
    const r2 = await compiled.resolve({ input: { orgId: 'b' } })
    const r3 = await compiled.resolve({ input: { orgId: 'a' } })

    expect(resolver).toHaveBeenCalledTimes(2)
    expect(r1.args.system).toContain('result-a')
    expect(r2.args.system).toContain('result-b')
    expect(r3.args.system).toContain('result-a')
  })
})

describe('compilePrompt inspection', () => {
  it('returns per-part token breakdown, prompt text, and tool names', async () => {
    const ctx = context({ id: 'rules', system: 'Follow rules.', tools: { search: 'tool' } })
    const result = await inspect({
      system: 'You are a bot.',
      prompt: 'What now?',
      use: [ctx],
      tools: { analyze: 'tool2' },
    } as AnyPromptConfig)

    expect(result.system.parts).toHaveLength(2)
    expect(result.system.parts[0].source).toBe('prompt')
    expect(result.system.parts[1].source).toBe('context:rules')
    expect(result.prompt?.text).toBe('What now?')
    expect(result.tools).toEqual(['search', 'analyze'])
    expect(result.totalTokens).toBeGreaterThan(0)
  })

  it('reuses the resolved pass when inspecting a PromptResolution', async () => {
    const system = vi.fn(() => 'resolved once')
    const compiled = compilePrompt({ system } as AnyPromptConfig)

    const resolution = await compiled.resolve()
    const first = resolution.inspect()
    const second = resolution.inspect()

    expect(resolution.args.system).toBe('resolved once')
    expect(first).toBe(second)
    expect(system).toHaveBeenCalledTimes(1)
  })
})
