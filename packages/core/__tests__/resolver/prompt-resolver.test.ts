/**
 * Boundary tests for `createPromptResolver()` on fake ports.
 *
 * Everything here runs without `setRuntime()`, observability transports, or
 * any global cleanup — the seams the contributor-contract refactor
 * (use-crux/crux#29) introduced. Covers the behaviors the characterization
 * suite pins through the global path, plus the paths that were untestable
 * before: error propagation, deterministic cache timing, registry failures,
 * and the `contributor()` factory.
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createPromptResolver, mergeInputSchemas } from '../../resolve'
import { context, when, match } from '../../context'
import { injectable } from '../../injectable'
import { contributor } from '../../contributor'
import {
  recordingObservability,
  inMemorySkillSource,
  inMemoryContextCache,
  fixedClock,
  collectingDiagnostics,
  staticPolicy,
  recordingInstrumentation,
} from '../../resolver/fakes'
import type { ResolverPorts } from '../../resolver/ports'
import type { PromptConfig, SkillEntry } from '../../types'

type AnyConfig = PromptConfig<z.ZodType, z.ZodType | undefined, readonly never[]>

interface FakePorts {
  ports: Partial<ResolverPorts>
  observability: ReturnType<typeof recordingObservability>
  skills: ReturnType<typeof inMemorySkillSource>
  clock: ReturnType<typeof fixedClock>
  diagnostics: ReturnType<typeof collectingDiagnostics>
  instrumentation: ReturnType<typeof recordingInstrumentation>
}

function fakePorts(): FakePorts {
  const observability = recordingObservability()
  const skills = inMemorySkillSource()
  const clock = fixedClock(1_000)
  const diagnostics = collectingDiagnostics()
  const instrumentation = recordingInstrumentation()
  return {
    observability,
    skills,
    clock,
    diagnostics,
    instrumentation,
    ports: {
      observability,
      skills,
      clock,
      diagnostics,
      instrumentation,
      cache: inMemoryContextCache(clock),
      policy: staticPolicy(),
    },
  }
}

describe('gating through fake ports', () => {
  it('reports exclusions with the same source/reason strings as the global path', async () => {
    const f = fakePorts()
    const resolver = createPromptResolver(f.ports)
    const config: AnyConfig = {
      system: 'S',
      use: [
        when(() => false, context({ id: 'seo', system: 'SEO.' })),
        context({ id: 'lang', when: () => false, system: 'L' }),
        match({ on: () => 'nope', cases: { a: context({ system: 'A' }) } }),
      ],
    }

    const inspect = await resolver.inspectArgs(config, {})
    expect(inspect.excludedContexts).toEqual([
      { source: 'context:seo', reason: 'when() predicate returned false' },
      { source: 'context:lang', reason: 'context-level when returned false' },
      { source: 'match[2]', reason: 'no case for "nope" and no default' },
    ])

    const excludedPreviews = f.observability.contributionPreviews('checked-not-included')
    expect(excludedPreviews.map((p) => p.sourceId)).toEqual(['context:seo', 'context:lang', 'match[2]'])
    expect(excludedPreviews.map((p) => p.injectableKind)).toEqual(['conditional', 'context', 'match'])
  })

  it('records predicate scopes nested under the resolution, with attributes', async () => {
    const f = fakePorts()
    const resolver = createPromptResolver(f.ports)
    const config: AnyConfig = { id: 'gated', system: 'S', use: [context({ id: 'c', when: () => true, system: 'C' })] }

    await resolver.resolvePrompt(config, {})
    const predicate = f.observability.scopes.find((s) => s.primitive === 'context.predicate')
    expect(predicate).toMatchObject({
      name: 'c',
      attributes: { source: 'context:c', predicate: 'context.when', included: true },
      path: ['gated', 'c'],
    })
  })
})

describe('error paths (previously uncovered)', () => {
  it('a throwing when predicate fails resolution with the original error', async () => {
    const resolver = createPromptResolver(fakePorts().ports)
    const config: AnyConfig = {
      system: 'S',
      use: [
        context({
          id: 'boom',
          when: () => {
            throw new Error('predicate exploded')
          },
          system: 'B',
        }),
      ],
    }
    await expect(resolver.resolvePrompt(config, {})).rejects.toThrow('predicate exploded')
  })

  it('a throwing inject() propagates out of resolution', async () => {
    const resolver = createPromptResolver(fakePorts().ports)
    const inj = injectable({
      id: 'bad',
      inject: () => {
        throw new Error('inject exploded')
      },
    })
    await expect(resolver.resolvePrompt({ system: 'S', use: [inj] } as AnyConfig, {})).rejects.toThrow(
      'inject exploded',
    )
  })

  it('tool collisions across entries throw with the colliding entry attributed', async () => {
    const resolver = createPromptResolver(fakePorts().ports)
    const a = injectable({ id: 'alpha', inject: () => ({ tools: { shared: 1 } }) })
    const b = injectable({ id: 'beta', inject: () => ({ tools: { shared: 2 } }) })
    await expect(resolver.resolvePrompt({ system: 'S', use: [a, b] } as AnyConfig, {})).rejects.toThrow(
      'Injected tool name collision for "shared". Injectable "beta" generated a tool name that already exists.',
    )
  })
})

describe('context cache with fixed clock', () => {
  it('reports deterministic miss timing and hit age', async () => {
    const f = fakePorts()
    const resolver = createPromptResolver(f.ports)
    const cached = context({ id: 'c-fixed', system: () => 'cached text', cache: 10_000 })
    const config: AnyConfig = { system: 'S', use: [cached] }

    await resolver.resolvePrompt(config, {})
    f.clock.advance(3_000)
    await resolver.resolvePrompt(config, {})

    expect(f.instrumentation.events).toEqual([
      { kind: 'miss', contextId: 'c-fixed', cacheKey: 'cache:ctx:c-fixed:', resolutionMs: 0 },
      { kind: 'hit', contextId: 'c-fixed', cacheKey: 'cache:ctx:c-fixed:', ageMs: 3_000 },
    ])
  })

  it('expires entries after TTL on the fake clock', async () => {
    const f = fakePorts()
    const resolver = createPromptResolver(f.ports)
    const cached = context({ id: 'c-ttl', system: () => 'cached', cache: 1_000 })
    const config: AnyConfig = { system: 'S', use: [cached] }

    await resolver.resolvePrompt(config, {})
    f.clock.advance(1_001)
    await resolver.resolvePrompt(config, {})

    expect(f.instrumentation.events.map((e) => e.kind)).toEqual(['miss', 'miss'])
  })

  it('isolates caches between resolvers (no module-level bleed)', async () => {
    const a = fakePorts()
    const b = fakePorts()
    const cached = context({ id: 'c-iso', system: () => 'x', cache: 60_000 })
    const config: AnyConfig = { system: 'S', use: [cached] }

    await createPromptResolver(a.ports).resolvePrompt(config, {})
    await createPromptResolver(b.ports).resolvePrompt(config, {})

    expect(a.instrumentation.events.map((e) => e.kind)).toEqual(['miss'])
    expect(b.instrumentation.events.map((e) => e.kind)).toEqual(['miss'])
  })
})

describe('skill surface through the skill source port', () => {
  const lazy = (id: string): SkillEntry => ({
    _tag: 'Skill',
    id,
    description: `Skill from registry: ${id}`,
    instructions: `[Skill "${id}" loads lazily]`,
    references: [],
    meta: { name: id, description: `Skill from registry: ${id}` },
    dump: () => '',
  })

  it('resolves lazy registry skills from the in-memory source', async () => {
    const f = fakePorts()
    f.skills.register('acme/seo', {
      instructions: 'Optimize ruthlessly.',
      references: [],
      meta: { name: 'seo', description: 'SEO skill' },
    })
    const resolver = createPromptResolver(f.ports)

    const result = await resolver.resolvePrompt({ system: 'S', use: [lazy('acme/seo')] } as AnyConfig, {})
    expect(result.system).toContain('seo')
    expect(f.diagnostics.warnings).toHaveLength(0)
    expect(f.skills.registeredStates).toHaveLength(1)
  })

  it('degrades a failed fetch to the placeholder with a diagnostics warning', async () => {
    const f = fakePorts()
    const resolver = createPromptResolver(f.ports)

    const result = await resolver.resolvePrompt({ system: 'S', use: [lazy('missing/skill')] } as AnyConfig, {})
    expect(result.system).toContain('missing/skill')
    expect(f.diagnostics.warnings).toEqual([
      {
        message: '[@crux/core] Failed to fetch skill "missing/skill":',
        detail: 'Skill "missing/skill" not found in in-memory registry',
      },
    ])
  })

  it('resolvePrompt and inspectArgs share one skill code path (regression: no drift)', async () => {
    const f = fakePorts()
    const resolver = createPromptResolver(f.ports)
    // Lazy detection by INSTRUCTIONS placeholder only — the case the old
    // inspectArgs copy missed because it only checked the description.
    const instructionsOnlyLazy: SkillEntry = {
      _tag: 'Skill',
      id: 'sneaky',
      description: 'A real-looking description',
      instructions: '[Skill "sneaky" loads lazily]',
      references: [],
      meta: { name: 'sneaky', description: 'A real-looking description' },
      dump: () => '',
    }
    const config: AnyConfig = { system: 'S', use: [instructionsOnlyLazy] }

    await resolver.resolvePrompt(config, {})
    const inspect = await resolver.inspectArgs(config, {})

    // Both paths attempted the fetch (and degraded identically) — two warnings, same text.
    expect(f.diagnostics.warnings).toHaveLength(2)
    expect(f.diagnostics.warnings[0]).toEqual(f.diagnostics.warnings[1])
    expect(inspect.system.parts.map((p) => p.source)).toContain('context:__crux_skill_index')
  })
})

describe('policy port', () => {
  it('auto-escapes string inputs when the policy enables it', async () => {
    const f = fakePorts()
    f.ports.policy = staticPolicy({ autoEscape: true })
    const resolver = createPromptResolver(f.ports)
    const config: AnyConfig = {
      system: 'S',
      prompt: ({ input }: { input: { topic: string } }) => `Write about ${input.topic}`,
    }

    const result = await resolver.resolvePrompt(config, { input: { topic: '<b>bold</b>' } })
    expect(result.prompt).toBe('Write about &lt;b&gt;bold&lt;/b&gt;')
  })
})

describe('contributor() entries', () => {
  it('contributes to every channel and re-enters the pipeline via use', async () => {
    const f = fakePorts()
    const resolver = createPromptResolver(f.ports)
    const entry = contributor({
      id: 'support-tools',
      input: z.object({ plan: z.string() }),
      contribute: ({ input }) => ({
        use: [context({ id: 'plan-note', system: `Plan: ${String(input.plan)}.` })],
        tools: { open_ticket: 'tool' },
        metadata: { tier: input.plan },
      }),
    })
    const config: AnyConfig = { system: 'S', use: [entry] }

    const result = await resolver.resolvePrompt(config, { input: { plan: 'pro' } })
    expect(result.system).toBe('S\n\nPlan: pro.')
    expect(result.tools).toEqual({ open_ticket: 'tool' })
    expect(result.metadata).toEqual({ tier: 'pro' })

    const facts = f.observability.contributionPreviews('active').find((p) => p.sourceId === 'contributor:support-tools')
    expect(facts).toMatchObject({ injectableKind: 'injectable', injectedTools: ['open_ticket'] })
  })

  it('when gate excludes with reason and skips contribute entirely', async () => {
    const f = fakePorts()
    const resolver = createPromptResolver(f.ports)
    let contributed = false
    const entry = contributor({
      id: 'gated',
      when: (input) => input.mode === 'on',
      contribute: () => {
        contributed = true
        return { tools: { t: 1 } }
      },
    })

    const inspect = await resolver.inspectArgs({ system: 'S', use: [entry] } as AnyConfig, { input: { mode: 'off' } })
    expect(contributed).toBe(false)
    expect(inspect.excludedContexts).toEqual([
      { source: 'contributor:gated', reason: 'when() predicate returned false' },
    ])
  })

  it('nested use entries resolve before the contribution itself', async () => {
    const resolver = createPromptResolver(fakePorts().ports)
    const entry = contributor({
      id: 'bundle',
      use: [context({ id: 'first', system: 'FIRST' })],
      contribute: () => ({ contexts: [context({ id: 'second', system: 'SECOND' })] }),
    })

    const result = await resolver.resolvePrompt({ system: 'S', use: [entry] } as AnyConfig, {})
    expect(result.system).toBe('S\n\nFIRST\n\nSECOND')
  })

  it('declared input schemas merge into the prompt schema as required keys', () => {
    const entry = contributor({
      id: 'schema-owner',
      input: z.object({ region: z.string() }),
      contribute: () => ({}),
    })
    const merged = mergeInputSchemas([entry], undefined)!
    expect(merged.safeParse({ region: 'eu' }).success).toBe(true)
    expect(merged.safeParse({}).success).toBe(false)
  })

  it('rejects empty ids at construction time', () => {
    expect(() => contributor({ id: '  ', contribute: () => ({}) })).toThrow('contributor(): id must be non-empty.')
  })
})

describe('default ports', () => {
  it('createPromptResolver() with no overrides resolves like the module-level pipeline', async () => {
    const resolver = createPromptResolver()
    const result = await resolver.resolvePrompt(
      { system: 'You are a bot.', use: [context({ id: 'c', system: 'C.' })] } as AnyConfig,
      {},
    )
    expect(result.system).toBe('You are a bot.\n\nC.')
  })
})
