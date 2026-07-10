import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { compilePrompt } from '../../src/resolver/compile'
import { createResolverFakes } from '../../src/resolver/fakes'
import { context } from '../../src/prompt/context'
import type { AnyPromptConfig } from '../../src/prompt/prompt-types'

describe('resolver input pipeline', () => {
  it('applies zod defaults before system functions', async () => {
    const config = {
      input: z.object({ tone: z.string().default('friendly') }),
      system: ({ input }: { input: { tone: string } }) => `tone=${input.tone}`,
    } satisfies AnyPromptConfig

    const result = await compilePrompt(config).resolve({ input: {} })

    expect(result.args.system).toBe('tone=friendly')
  })

  it('applies zod transforms before system functions', async () => {
    const config = {
      input: z.object({ name: z.string().transform((value) => value.toUpperCase()) }),
      system: ({ input }: { input: { name: string } }) => `name=${input.name}`,
    } satisfies AnyPromptConfig

    const result = await compilePrompt(config).resolve({ input: { name: 'crux' } })

    expect(result.args.system).toBe('name=CRUX')
  })

  it('passes parsed input to when gates', async () => {
    const gated = context({
      id: 'default-enabled',
      input: z.object({ enabled: z.boolean().default(true) }),
      when: ({ input }) => input.enabled,
      system: 'enabled context',
    })
    const config = {
      system: 'base',
      use: [gated],
    } satisfies AnyPromptConfig

    const result = await compilePrompt(config).resolve({ input: {} })

    expect(result.args.system).toBe('base\n\nenabled context')
  })

  it('passes final escaped input to when gates', async () => {
    const fakes = createResolverFakes({ policy: { autoEscape: true } })
    const gated = context({
      id: 'escaped-gate',
      input: z.object({ marker: z.string() }),
      when: ({ input }) => input.marker === '&lt;go&gt;',
      system: 'escaped gate',
    })
    const config = {
      system: 'base',
      use: [gated],
    } satisfies AnyPromptConfig

    const result = await compilePrompt(config, { ports: fakes.ports }).resolve({ input: { marker: '<go>' } })

    expect(result.args.system).toBe('base\n\nescaped gate')
  })

  it('sanitize receives parsed, un-escaped input', async () => {
    const fakes = createResolverFakes({ policy: { autoEscape: true } })
    let sanitizedQuery: string | undefined
    const config = {
      input: z.object({ query: z.string().default('<default>') }),
      sanitize: (input: { query: string }) => {
        sanitizedQuery = input.query
        return input
      },
      system: ({ input }: { input: { query: string } }) => input.query,
    } satisfies AnyPromptConfig

    const result = await compilePrompt(config, { ports: fakes.ports }).resolve({ input: {} })

    expect(sanitizedQuery).toBe('<default>')
    expect(result.args.system).toBe('&lt;default&gt;')
  })

  it('auto-escape runs after sanitize', async () => {
    const fakes = createResolverFakes({ policy: { autoEscape: true } })
    const config = {
      input: z.object({ query: z.string() }),
      sanitize: (input: { query: string }) => ({ query: `<sanitized>${input.query}` }),
      system: ({ input }: { input: { query: string } }) => input.query,
    } satisfies AnyPromptConfig

    const result = await compilePrompt(config, { ports: fakes.ports }).resolve({ input: { query: '<raw>' } })

    expect(result.args.system).toBe('&lt;sanitized&gt;&lt;raw&gt;')
  })

  it('passes final input to context tool functions', async () => {
    const fakes = createResolverFakes({ policy: { autoEscape: true } })
    let toolInput: string | undefined
    const toolContext = context({
      id: 'tool-context',
      input: z.object({ query: z.string() }),
      system: 'tools',
      tools: ({ input }) => {
        toolInput = input.query
        return { search: 'tool' }
      },
    })
    const config = {
      input: z.object({ query: z.string().transform((value) => `${value}<tail>`) }),
      sanitize: (input: { query: string }) => ({ query: input.query.replace('raw', 'clean') }),
      system: 'base',
      use: [toolContext],
    } satisfies AnyPromptConfig

    const result = await compilePrompt(config, { ports: fakes.ports }).resolve({ input: { query: 'raw' } })

    expect(toolInput).toBe('clean&lt;tail&gt;')
    expect(result.args.tools).toEqual({ search: 'tool' })
  })

  it('uses parsed input for context memo keying', async () => {
    const fakes = createResolverFakes()
    let runs = 0
    const cached = context({
      id: 'trimmed-cache',
      input: z.object({ query: z.string().transform((value) => value.trim()) }),
      memo: { ttl: 60_000 },
      system: ({ input }) => `query=${input.query};runs=${++runs}`,
    })
    const config = {
      system: 'base',
      use: [cached],
    } satisfies AnyPromptConfig

    const first = await compilePrompt(config, { ports: fakes.ports }).resolve({ input: { query: ' crux ' } })
    const second = await compilePrompt(config, { ports: fakes.ports }).resolve({ input: { query: 'crux' } })

    expect(first.args.system).toBe('base\n\nquery=crux;runs=1')
    expect(second.args.system).toBe('base\n\nquery=crux;runs=1')
    expect(fakes.instrumentation.events.map((event) => event.kind)).toEqual(['miss', 'hit'])
  })

  it('raw input used unchanged when no schema declared', async () => {
    const rawInput = { query: 'raw' }
    let sanitizeReceivedRawInput = false
    const config = {
      sanitize: (input: Record<string, unknown>) => {
        sanitizeReceivedRawInput = input === rawInput
        return input
      },
      system: ({ input }: { input: { query?: string } }) => `query=${input.query}`,
    } satisfies AnyPromptConfig

    const result = await compilePrompt(config).resolve({ input: rawInput })

    expect(sanitizeReceivedRawInput).toBe(true)
    expect(result.args.system).toBe('query=raw')
  })

  it('warns once when nested strings present with auto-escape on', async () => {
    const fakes = createResolverFakes({ policy: { autoEscape: true } })
    const config = {
      input: z.object({
        title: z.string(),
        profile: z.object({
          bio: z.string(),
          links: z.array(z.object({ label: z.string() })),
        }),
      }),
      system: ({ input }: { input: { title: string; profile: { bio: string } } }) =>
        `${input.title}:${input.profile.bio}`,
    } satisfies AnyPromptConfig

    const result = await compilePrompt(config, { ports: fakes.ports }).resolve({
      input: {
        title: '<top>',
        profile: { bio: '<nested>', links: [{ label: '<also nested>' }] },
      },
    })

    expect(result.args.system).toBe('&lt;top&gt;:<nested>')
    expect(fakes.diagnostics.warnings.map((warning) => warning.message)).toEqual([
      'auto-escape: input field "profile" contains nested string values; auto-escape covers top-level strings only. Escape nested content explicitly or restructure the input.',
    ])
  })
})
