/**
 * Characterization tests for the prompt resolution pipeline.
 *
 * These tests pin the observable behavior of the compiled prompt boundary
 * through the global runtime path — exclusion strings, observability artifact
 * shapes, tool-collision messages, skill index/loading behavior, and memory
 * bindings (use-crux/crux#29).
 *
 * The boundary tests in `resolver/prompt-resolver.test.ts` cover the same
 * pipeline through injected fake ports; this suite guards the default-ports
 * path that production code takes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { compilePrompt, type ResolveCallOptions } from '../resolver/compile'
import { context, contextWithFamily, when, match } from '../prompt/context'
import { contributor } from '../prompt/contributor'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../observability'
import { updateRuntime, resetRuntime } from '../runtime/runtime'
import { setTokenizer, defaultTokenizer } from '../shared/tokenizer'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'
import type { AnyToolSet } from '../types'
import type { MemoryEntry, BlackboardEntry, SkillEntry, ContextEntry } from '../prompt/context-types'
import type { PromptConfig } from '../prompt/prompt-types'

afterEach(() => {
  setTokenizer(defaultTokenizer)
  resetObservabilityRuntime()
  resetRuntime()
  vi.restoreAllMocks()
})

type AnyConfig = PromptConfig<z.ZodType, z.ZodType | undefined, readonly never[]>

async function resolveCompiled(config: AnyConfig, opts: ResolveCallOptions = {}, inputSchema?: z.ZodType) {
  const compiledConfig = inputSchema ? ({ ...config, input: config.input ?? inputSchema } as AnyConfig) : config
  return (await compilePrompt(compiledConfig).resolve(opts)).args
}

async function inspectCompiled(config: AnyConfig, opts: ResolveCallOptions = {}, inputSchema?: z.ZodType) {
  const compiledConfig = inputSchema ? ({ ...config, input: config.input ?? inputSchema } as AnyConfig) : config
  return compilePrompt(compiledConfig).inspect(opts)
}

function inputSchemaFor(entries: readonly ContextEntry[], input?: z.ZodType) {
  return compilePrompt({ system: 'S', use: entries, ...(input ? { input } : {}) } as unknown as AnyConfig).inputSchema
}

// ─────────────────────────────────────────────────────────────────
// Structural fakes for the non-context entry families
// ─────────────────────────────────────────────────────────────────

function fakeMemory(id: string, text: string, tools: AnyToolSet = {}): MemoryEntry {
  return {
    _tag: 'Memory',
    id,
    asContext: () => contextWithFamily({ id: `memory:${id}`, system: text }, 'memory'),
    asTools: () => tools,
    captureTurn: async () => undefined,
    flush: async () => undefined,
  }
}

function fakeBlackboard(id: string, tools: AnyToolSet): BlackboardEntry {
  return {
    _tag: 'Blackboard',
    id,
    asContext: () => contextWithFamily({ id: `blackboard:${id}`, system: `Board ${id} state.` }, 'blackboard'),
    asTools: () => tools,
  }
}

function fakeSkill(id: string, description = `Skill ${id}`, instructions = `Do ${id} things.`): SkillEntry {
  return {
    _tag: 'Skill',
    id,
    description,
    instructions,
    references: [],
    meta: { name: id, description },
    dump: () => instructions,
  }
}

function lazySkill(id: string): SkillEntry {
  return fakeSkill(id, `Skill from registry: ${id}`, `[Skill "${id}" loads lazily]`)
}

// ─────────────────────────────────────────────────────────────────
// Async resolution: ordering, channels, exclusions via compilePrompt().inspect()
// ─────────────────────────────────────────────────────────────────

describe('entry resolution via compilePrompt', () => {
  it('records exclusion source/reason strings per family', async () => {
    const cond = when(() => false, context({ id: 'seo', system: 'SEO.' }))
    const gated = context({ id: 'lang', when: () => false, system: 'Lang.' })
    const spec = match({ on: () => 'none', cases: { a: context({ system: 'A' }) } })
    const config: AnyConfig = { system: 'Base.', use: [cond, gated, spec] }

    const result = await inspectCompiled(config, {}, undefined)
    expect(result.excludedContexts).toEqual([
      { source: 'context:seo', reason: 'when() predicate returned false' },
      { source: 'context:lang', reason: 'context-level when returned false' },
      { source: 'match[2]', reason: 'no case for "none" and no default' },
    ])
  })

    it('anonymous contexts are excluded with their positional source', async () => {
    const first = context({ id: 'first', system: 'a' })
    const anon = context({ when: () => false, system: 'b' })
    const result = await inspectCompiled({ system: 'S', use: [first, anon] } as AnyConfig, {}, undefined)
    expect(result.excludedContexts).toEqual([{ source: 'context[1]', reason: 'context-level when returned false' }])
  })

    it('a passing when() wrapper still honors the wrapped context-level when', async () => {
    const ctx = context({ id: 'both', when: () => false, system: 'x' })
    const result = await inspectCompiled({ system: 'S', use: [when(() => true, ctx)] } as AnyConfig, {}, undefined)
    expect(result.excludedContexts).toEqual([{ source: 'context:both', reason: 'context-level when returned false' }])
  })

    it('falsy entries are silently filtered', async () => {
    const config: AnyConfig = { system: 'S', use: [false, null, undefined, context({ system: 'kept' })] }
    const result = await inspectCompiled(config, {}, undefined)
    expect(result.system.total).toBe('S\n\nkept')
    expect(result.excludedContexts).toEqual([])
  })

    it('nested entries collect their side families (memory bindings from nested memories)', async () => {
    const mem = fakeMemory('nested-m', 'remembered')
    const parent = context({ id: 'parent', system: 'PARENT', use: [mem] })
    const result = await resolveCompiled({ id: 'p', system: 'OWN', use: [parent] } as AnyConfig, {}, undefined)
    expect(result.system).toBe('OWN\n\nremembered\n\nPARENT')
    expect(result.memoryBindings?.map((b) => b.memory.id)).toEqual(['nested-m'])
  })

    it('match branch entries are re-resolved with branch-local indices', async () => {
    const anonFailing = context({ when: () => false, system: 'nope' })
    const spec = match({ on: () => 'hit', cases: { hit: [context({ system: 'lead' }), anonFailing] } })
    const config: AnyConfig = { system: 'Base.', use: [context({ system: 'pad' }), spec] }

    const result = await inspectCompiled(config, {}, undefined)
    // Inside the branch the entry index restarts at 0 → context[1], not match[1].
    expect(result.excludedContexts).toEqual([{ source: 'context[1]', reason: 'context-level when returned false' }])
  })

    it('nested useEntries contribute system text before their parent', async () => {
    const inner = context({ id: 'inner', system: 'INNER' })
    const parent = context({ id: 'parent', system: 'PARENT', use: [inner] })
    const config: AnyConfig = { system: 'OWN', use: [parent] }

    const result = await resolveCompiled(config, {}, undefined)
    expect(result.system).toBe('OWN\n\nINNER\n\nPARENT')
  })

    it('match selects the matching branch and default as fallback', async () => {
    const spec = match({
      on: (i) => i.mode as string,
      cases: { research: context({ id: 'r', system: 'RESEARCH' }) },
      default: context({ id: 'd', system: 'DEFAULT' }),
    })
    const config: AnyConfig = { system: 'S', use: [spec] }

    expect((await resolveCompiled(config, { input: { mode: 'research' } }, undefined)).system).toBe('S\n\nRESEARCH')
    expect((await resolveCompiled(config, { input: { mode: 'other' } }, undefined)).system).toBe('S\n\nDEFAULT')
  })
})

// ─────────────────────────────────────────────────────────────────
// Injectable entries
// ─────────────────────────────────────────────────────────────────

describe('contributor resolution', () => {
  it('lands contexts, tools, constraints, guardrails, and metadata in their channels', async () => {
    const constraint = { id: 'c1' } as unknown as Constraint
    const guardrail = { id: 'g1' } as unknown as Guardrail
    const inj = contributor({
      id: 'retrieval',
      contribute: () => ({
        contexts: [context({ id: 'docs', system: 'Doc snippets.' })],
        tools: { search_docs: 'tool' },
        constraints: [constraint],
        guardrails: [guardrail],
        metadata: { retriever: 'docs' },
      }),
    })
    const config: AnyConfig = { system: 'S', use: [inj] }

    const result = await resolveCompiled(config, {}, undefined)
    expect(result.system).toBe('S\n\nDoc snippets.')
    expect(result.tools).toEqual({ search_docs: 'tool' })
    expect(result.constraints).toEqual([constraint])
    expect(result.guardrails).toEqual([guardrail])
    expect(result.metadata).toEqual({ retriever: 'docs' })
  })

    it('injected contexts re-enter the pipeline (when respected, exclusion attributed)', async () => {
    const inj = contributor({
      id: 'cond-inject',
      contribute: () => ({ contexts: [context({ id: 'maybe', when: () => false, system: 'no' })] }),
    })
    const result = await inspectCompiled({ system: 'S', use: [inj] } as AnyConfig, {}, undefined)
    expect(result.excludedContexts).toEqual([{ source: 'context:maybe', reason: 'context-level when returned false' }])
  })

    it('throws the exact injected-tool collision message', async () => {
    const a = contributor({ id: 'first', contribute: () => ({ tools: { dup: 1 } }) })
    const b = contributor({ id: 'second', contribute: () => ({ tools: { dup: 2 } }) })

    await expect(resolveCompiled({ system: 'S', use: [a, b] } as AnyConfig, {}, undefined)).rejects.toThrow(
      'Tool name collision for "dup": contributed by both contributor:first and contributor:second. ' +
        'Rename one of them, or pass the overriding tool at the call site (call-site tools intentionally win).',
    )
  })

    it('passes input and promptId to contribute()', async () => {
    const seen: unknown[] = []
    const inj = contributor({
      id: 'spy',
      contribute: (args) => {
        seen.push(args)
        return {}
      },
    })
    await resolveCompiled({ id: 'p1', system: 'S', use: [inj] } as AnyConfig, { input: { q: 'x' } }, undefined)
    expect(seen).toEqual([{ input: { q: 'x' }, promptId: 'p1' }])
  })
})

// ─────────────────────────────────────────────────────────────────
// Memory entries
// ─────────────────────────────────────────────────────────────────

describe('memory resolution', () => {
  it('expands into a context contribution and a memory binding', async () => {
    const mem = fakeMemory('chat', 'Earlier: user prefers tabs.')
    const config: AnyConfig = { id: 'with-memory', system: 'S', use: [mem] }

    const result = await resolveCompiled(config, { input: { q: 1 } }, undefined)
    expect(result.system).toBe('S\n\nEarlier: user prefers tabs.')
    expect(result.memoryBindings).toEqual([{ memory: mem, input: { q: 1 }, promptId: 'with-memory' }])
  })

    it('memory tools are opt-in: neither merged into resolved tools nor reported as injected', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const mem = fakeMemory('m-tools', 'text', { memory_search: 'tool' })
    const result = await resolveCompiled({ system: 'S', use: [mem] } as AnyConfig, {}, undefined)
    await observe.flush()

    expect(result.tools).toBeUndefined()
    // No tool-injection artifact for the memory entry — its only
    // contribution artifact is the composed context (family 'memory').
    const memoryArtifacts = artifactPreviews(transport.records, 'context.contribution').filter(
      (p) => p.sourceId === 'memory:m-tools',
    )
    expect(memoryArtifacts).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────
// Blackboard entries
// ─────────────────────────────────────────────────────────────────

describe('blackboard resolution', () => {
  it('contributes its context text and merges board tools', async () => {
    const board = fakeBlackboard('plan', { write_plan: 'tool' })
    const result = await resolveCompiled({ system: 'S', use: [board] } as AnyConfig, {}, undefined)
    expect(result.system).toBe('S\n\nBoard plan state.')
    expect(result.tools).toEqual({ write_plan: 'tool' })
  })

    it('throws the exact blackboard tool collision message against existing tools', async () => {
    const board = fakeBlackboard('plan', { dup: 'board-tool' })
    const config: AnyConfig = { system: 'S', use: [board], tools: { dup: 'config-tool' } }

    await expect(resolveCompiled(config, {}, undefined)).rejects.toThrow(
      'Tool name collision for "dup": contributed by both blackboard:plan and prompt config. ' +
        'Rename one of them, or pass the overriding tool at the call site (call-site tools intentionally win).',
    )
  })
})

// ─────────────────────────────────────────────────────────────────
// Skill entries
// ─────────────────────────────────────────────────────────────────

describe('skill resolution', () => {
  it('prepends the generated skill index and injects loader tools', async () => {
    const s = fakeSkill('seo-audit')
    const config: AnyConfig = { system: 'OWN', use: [s] }

    const result = await resolveCompiled(config, {}, undefined)
    expect(result.systemBlocks?.[1]?.source).toBe('context:__crux_skill_index')
    // Index appears between the prompt's own system and nothing else
    expect(result.system!.startsWith('OWN\n\n')).toBe(true)
    expect(result.system).toContain('seo-audit')
    expect(Object.keys(result.tools ?? {})).toEqual(
      expect.arrayContaining(['__crux_LoadSkill', '__crux_LoadReference']),
    )
    expect((result as { _skillSession?: unknown })._skillSession).toBeDefined()
  })

    it('injects loaded-skill contexts for ids passed via _crux_activeSkills', async () => {
    const s = fakeSkill('writer', 'Writing skill', 'Write well.')
    const config: AnyConfig = { system: 'OWN', use: [s] }

    const result = await resolveCompiled(config, { input: { _crux_activeSkills: ['writer'] } }, undefined)
    const loaded = result.systemBlocks?.find((b) => b.source === 'context:__crux_skill_loaded:writer')
    expect(loaded?.text).toBe('## Skill: writer\n\nWrite well.')
  })

  it('preserves active skill ids across prompt input schema parsing', async () => {
    const s = fakeSkill('writer', 'Writing skill', 'Write well.')
    const config: AnyConfig = {
      input: z.object({ query: z.string() }),
      system: ({ input }: { input: { query: string } }) => `OWN ${input.query}`,
      use: [s],
    }

    const result = await resolveCompiled(config, {
      input: { query: 'draft', _crux_activeSkills: ['writer'] },
    })
    const loaded = result.systemBlocks?.find((b) => b.source === 'context:__crux_skill_loaded:writer')
    expect(loaded?.text).toBe('## Skill: writer\n\nWrite well.')
    expect(result.system).toContain('OWN draft')
  })

    it('degrades a failing lazy registry fetch to the placeholder with a console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const s = lazySkill('no-such-registry:owner/repo/slug')
    const config: AnyConfig = { system: 'OWN', use: [s] }

    const result = await resolveCompiled(config, {}, undefined)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch skill "no-such-registry:owner/repo/slug"'),
      expect.anything(),
    )
    // The placeholder skill still appears in the index
    expect(result.system).toContain('no-such-registry:owner/repo/slug')
  })

    it('inspect mirrors the index context and reports loader tool names', async () => {
    const s = fakeSkill('inspector')
    const config: AnyConfig = { system: 'OWN', use: [s] }

    const result = await inspectCompiled(config, {}, undefined)
    expect(result.system.parts.map((p) => p.source)).toEqual(['prompt', 'context:__crux_skill_index'])
    expect(result.tools).toEqual(expect.arrayContaining(['__crux_LoadSkill', '__crux_LoadReference']))
  })
})

// ─────────────────────────────────────────────────────────────────
// Observability artifacts and spans
// ─────────────────────────────────────────────────────────────────

interface RecordedArtifact {
  type: string
  kind?: string
  preview?: Record<string, unknown>
}

function artifactPreviews(records: readonly unknown[], kind: string): Record<string, unknown>[] {
  return (records as RecordedArtifact[])
    .filter((r) => r.type === 'artifact' && r.kind === kind)
    .map((r) => r.preview as Record<string, unknown>)
}

describe('observability emission', () => {
  it('emits checked-not-included contribution artifacts for excluded entries, in entry order', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const cond = when(() => false, context({ id: 'seo', system: 'SEO.' }))
    const gated = context({ id: 'lang', when: () => false, system: 'Lang.' })
    const spec = match({ on: () => 'none', cases: { a: context({ system: 'A' }) } })
    await resolveCompiled({ system: 'S', use: [cond, gated, spec] } as AnyConfig, {}, undefined)
    await observe.flush()

    const previews = artifactPreviews(transport.records, 'context.contribution')
    expect(previews).toEqual([
      {
        kind: 'context.contribution',
        state: 'checked-not-included',
        included: false,
        sourceId: 'context:seo',
        injectableKind: 'conditional',
        reason: 'when() predicate returned false',
        injects: ['system'],
        priority: 50,
      },
      {
        kind: 'context.contribution',
        state: 'checked-not-included',
        included: false,
        sourceId: 'context:lang',
        injectableKind: 'context',
        reason: 'context-level when returned false',
        injects: ['system'],
        priority: 50,
      },
      {
        kind: 'context.contribution',
        state: 'checked-not-included',
        included: false,
        sourceId: 'match[2]',
        injectableKind: 'match',
        reason: 'no case for "none" and no default',
        branch: 'none',
      },
    ])
  })

    it('emits context.predicate spans with included/reason attributes', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const passing = context({ id: 'pass', when: () => true, system: 'P' })
    const failing = context({ id: 'fail', when: () => false, system: 'F' })
    await resolveCompiled({ system: 'S', use: [passing, failing] } as AnyConfig, {}, undefined)
    await observe.flush()

    const predicateSpans = transport.records.filter(
      (r) =>
        (r as { type: string; primitive?: string }).type === 'span:start' &&
        (r as { primitive?: string }).primitive === 'context.predicate',
    ) as Array<{ name: string; attributes?: Record<string, unknown> }>

    expect(predicateSpans).toHaveLength(2)
    expect(predicateSpans[0]).toMatchObject({
      name: 'pass',
      attributes: { source: 'context:pass', predicate: 'context.when', included: true },
    })
    expect(predicateSpans[1]).toMatchObject({
      name: 'fail',
      attributes: {
        source: 'context:fail',
        predicate: 'context.when',
        included: false,
        reason: 'context-level when returned false',
      },
    })
  })

    it('emits an active match artifact with the selected branch', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const spec = match({
      on: (i) => i.mode as string,
      cases: { research: context({ id: 'r', system: 'R' }) },
      default: context({ id: 'd', system: 'D' }),
    })
    await resolveCompiled({ system: 'S', use: [spec] } as AnyConfig, { input: { mode: 'other' } }, undefined)
    await observe.flush()

    const previews = artifactPreviews(transport.records, 'context.contribution')
    expect(previews[0]).toEqual({
      kind: 'context.contribution',
      state: 'active',
      included: true,
      sourceId: 'match[0]',
      injectableKind: 'match',
      branch: 'default',
    })
  })

    it('emits tool-injection artifacts for contributor and blackboard entries (memory contributes none)', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const mem = fakeMemory('m1', 'mem text', { memory_recall: 'tool' })
    const board = fakeBlackboard('b1', { write_b1: 'tool' })
    const inj = contributor({ id: 'i1', contribute: () => ({ tools: { injected_tool: 'tool' } }) })
    await resolveCompiled({ system: 'S', use: [inj, mem, board] } as AnyConfig, {}, undefined)
    await observe.flush()

    const previews = artifactPreviews(transport.records, 'context.contribution').filter((p) => p.state === 'active')
    const direct = previews.filter((p) =>
      ['contributor:i1', 'memory:m1', 'blackboard:b1'].includes(p.sourceId as string),
    )
    expect(direct).toEqual([
      {
        kind: 'context.contribution',
        state: 'active',
        included: true,
        sourceId: 'contributor:i1',
        injectableKind: 'injectable',
        injects: ['tools'],
        injectedTools: ['injected_tool'],
      },
      {
        kind: 'context.contribution',
        state: 'active',
        included: true,
        sourceId: 'blackboard:b1',
        injectableKind: 'blackboard',
        injects: ['tools'],
        injectedTools: ['write_b1'],
      },
    ])
  })

    it('emits active contribution artifacts with tokens, cacheStatus, and the declared family', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const mem = fakeMemory('declared', 'memory text')
    await resolveCompiled({ system: 'S', use: [mem] } as AnyConfig, {}, undefined)
    await observe.flush()

    const previews = artifactPreviews(transport.records, 'context.contribution')
    const composed = previews.find((p) => p.sourceId === 'context:memory:declared' && p.cacheStatus !== undefined)
    expect(composed).toMatchObject({
      state: 'active',
      included: true,
      injectableKind: 'memory', // declared by the memory factory's asContext()
      cacheStatus: 'disabled',
      text: 'memory text',
    })
    expect(typeof composed?.tokens).toBe('number')
  })

    it('emits prompt.input artifacts for passed, failed, and not-configured validation', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const schema = z.object({ name: z.string() })

    await resolveCompiled({ id: 'p', system: 'S' } as AnyConfig, { input: { name: 'ok' } }, schema)
    await expect(
      resolveCompiled({ id: 'p', system: 'S' } as AnyConfig, { input: { name: 5 } }, schema),
    ).rejects.toThrow(/Input validation failed/)
    await resolveCompiled({ id: 'p', system: 'S' } as AnyConfig, {}, undefined)
    await observe.flush()

    const previews = artifactPreviews(transport.records, 'input')
    expect(previews).toEqual([
      {
        kind: 'prompt.input',
        promptId: 'p',
        validationStatus: 'passed',
        providedKeys: ['name'],
        schemaKeys: ['name'],
        requiredKeys: ['name'],
        missingKeys: [],
        unexpectedKeys: [],
      },
      {
        kind: 'prompt.input',
        promptId: 'p',
        validationStatus: 'failed',
        providedKeys: ['name'],
        schemaKeys: ['name'],
        requiredKeys: ['name'],
        missingKeys: [],
        unexpectedKeys: [],
      },
      { kind: 'prompt.input', promptId: 'p', validationStatus: 'not-configured', providedKeys: [] },
    ])
  })

    it('emits a prompt.budget artifact with dropped contexts when tokenBudget applies', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    setTokenizer((text) => text.length)

    const low = context({ id: 'low', system: 'AAAA', priority: 10 })
    const high = context({ id: 'high', system: 'BB', priority: 90 })
    await resolveCompiled({ system: 'X', use: [low, high] } as AnyConfig, { tokenBudget: 5 }, undefined)
    await observe.flush()

    const previews = artifactPreviews(transport.records, 'prompt.budget')
    expect(previews).toHaveLength(1)
    expect(previews[0]).toMatchObject({
      kind: 'prompt.budget',
      totalTokens: 5,
      dropped: [
        expect.objectContaining({
          state: 'dropped-budget',
          sourceId: 'context:low',
          reason: 'token budget',
          tokens: 4,
        }),
      ],
    })
  })
})
// ─────────────────────────────────────────────────────────────────
// Input schema collection (definition-time shape walk)
// ─────────────────────────────────────────────────────────────────

describe('compilePrompt input schema shape collection', () => {
  it('contributor schemas contribute required keys', () => {
    const inj = contributor({ id: 'inj', input: z.object({ topK: z.number() }), contribute: () => ({}) })
    const merged = inputSchemaFor([inj], undefined)!
    expect(merged.safeParse({ topK: 3 }).success).toBe(true)
    expect(merged.safeParse({}).success).toBe(false)
  })

    it('match branch context keys become optional', () => {
    const branch = context({ id: 'b', input: z.object({ lang: z.string() }), system: 'B' })
    const spec = match({ on: () => 'b', cases: { b: branch } })
    const merged = inputSchemaFor([spec], undefined)!
    expect(merged.safeParse({}).success).toBe(true)
    expect(merged.safeParse({ lang: 'fr' }).success).toBe(true)
  })

    it('skills, memories, and blackboards contribute no schema', () => {
    const merged = inputSchemaFor([fakeSkill('s'), fakeMemory('m', 't'), fakeBlackboard('b', {})], undefined)
    expect(merged).toBeUndefined()
  })

    it('duplicate keys across contexts throw the exact conflict message', () => {
    const a = context({ id: 'first', input: z.object({ name: z.string() }), system: 'a' })
    const b = context({ id: 'second', input: z.object({ name: z.string() }), system: 'b' })
    expect(() => inputSchemaFor([a, b], undefined)).toThrow(
      'Input key "name" is defined by both "first" and "second". Context input keys must not overlap.',
    )
  })

    it('nested useEntries schemas are collected (children before parent)', () => {
    const inner = context({ id: 'inner', input: z.object({ x: z.string() }), system: 'i' })
    const parent = context({ id: 'parent', input: z.object({ y: z.string() }), system: 'p', use: [inner] })
    const merged = inputSchemaFor([parent], undefined)!
    expect(merged.safeParse({ x: 'a', y: 'b' }).success).toBe(true)
    expect(merged.safeParse({ y: 'b' }).success).toBe(false)
  })
})
