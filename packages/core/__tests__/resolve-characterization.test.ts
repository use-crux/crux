/**
 * Characterization tests for the prompt resolution pipeline.
 *
 * These tests pin the CURRENT observable behavior of `resolvePrompt`,
 * `inspectArgs`, `flattenContextEntries`, and `mergeInputSchemas` — exclusion
 * strings, observability artifact shapes, tool-collision messages, skill
 * index/loading behavior, and memory bindings — so the contributor-contract
 * refactor (use-crux/crux#29) can be verified byte-for-byte against them.
 *
 * They intentionally use the global runtime/observability setup that the
 * refactor will replace with injected ports. Once the boundary tests on fake
 * ports cover the same behaviors, the global setup here can be deleted.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { z } from 'zod'
import { resolvePrompt, inspectArgs, flattenContextEntries, mergeInputSchemas } from '../resolve'
import { context, when, match } from '../context'
import { injectable } from '../injectable'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../observability'
import { updateRuntime, resetRuntime } from '../runtime'
import { setTokenizer, defaultTokenizer } from '../tokenizer'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'
import type { MemoryEntry, BlackboardEntry, SkillEntry, PromptConfig, AnyToolSet } from '../types'

afterEach(() => {
  setTokenizer(defaultTokenizer)
  resetObservabilityRuntime()
  resetRuntime()
  vi.restoreAllMocks()
})

type AnyConfig = PromptConfig<z.ZodType, z.ZodType | undefined, readonly never[]>

// ─────────────────────────────────────────────────────────────────
// Structural fakes for the non-context entry families
// ─────────────────────────────────────────────────────────────────

function fakeMemory(id: string, text: string, tools: AnyToolSet = {}): MemoryEntry {
  return {
    _tag: 'Memory',
    id,
    asContext: () => context({ id: `memory:${id}`, system: text }),
    asTools: () => tools,
    captureTurn: async () => undefined,
    flush: async () => undefined,
  }
}

function fakeBlackboard(id: string, tools: AnyToolSet): BlackboardEntry {
  return {
    _tag: 'Blackboard',
    id,
    asContext: () => context({ id: `blackboard:${id}`, system: `Board ${id} state.` }),
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
// Exclusion bookkeeping (sync flatten pass)
// ─────────────────────────────────────────────────────────────────

describe('flattenContextEntries exclusion strings', () => {
  it('conditional wrapper predicate false → when() predicate returned false', () => {
    const ctx = context({ id: 'seo', system: 'SEO rules.' })
    const { active, excluded } = flattenContextEntries([when(() => false, ctx)], {})
    expect(active).toHaveLength(0)
    expect(excluded).toEqual([{ source: 'context:seo', reason: 'when() predicate returned false' }])
  })

  it('context-level when false → context-level when returned false', () => {
    const ctx = context({ id: 'lang', when: () => false, system: 'Language.' })
    const { excluded } = flattenContextEntries([ctx], {})
    expect(excluded).toEqual([{ source: 'context:lang', reason: 'context-level when returned false' }])
  })

  it('anonymous context uses positional source at its entry index', () => {
    const first = context({ id: 'first', system: 'a' })
    const anon = context({ when: () => false, system: 'b' })
    const { excluded } = flattenContextEntries([first, anon], {})
    expect(excluded).toEqual([{ source: 'context[1]', reason: 'context-level when returned false' }])
  })

  it('conditional passes but context-level when fails → context-level reason', () => {
    const ctx = context({ id: 'both', when: () => false, system: 'x' })
    const { excluded } = flattenContextEntries([when(() => true, ctx)], {})
    expect(excluded).toEqual([{ source: 'context:both', reason: 'context-level when returned false' }])
  })

  it('match with no case and no default → no case for "<value>" and no default', () => {
    const spec = match({ on: (i) => i.mode as string, cases: { a: context({ system: 'A' }) } })
    const { excluded } = flattenContextEntries([spec], { mode: 'zzz' })
    expect(excluded).toEqual([{ source: 'match[0]', reason: 'no case for "zzz" and no default' }])
  })

  it('matched branch context with failing when → context source when id present, match[i] otherwise', () => {
    const named = context({ id: 'branch-named', when: () => false, system: 'n' })
    const anon = context({ when: () => false, system: 'a' })
    const spec = match({ on: () => 'hit', cases: { hit: [named, anon] } })
    const { excluded } = flattenContextEntries([context({ system: 'lead' }), spec], {})
    expect(excluded).toEqual([
      { source: 'context:branch-named', reason: 'context-level when returned false' },
      { source: 'match[1]', reason: 'context-level when returned false' },
    ])
  })

  it('falsy entries are silently filtered', () => {
    const { active, excluded } = flattenContextEntries([false, null, undefined, context({ system: 'kept' })], {})
    expect(active).toHaveLength(1)
    expect(excluded).toHaveLength(0)
  })

  it('nested useEntries flatten before their parent and collect side families', () => {
    const mem = fakeMemory('m1', 'remembered')
    const inner = context({ id: 'inner', system: 'inner text' })
    const parent = context({ id: 'parent', system: 'parent text', use: [inner, mem] })
    const result = flattenContextEntries([parent], {})
    expect(result.active.map((c) => c.id)).toEqual(['inner', 'memory:m1', 'parent'])
    expect(result.memories.map((m) => m.id)).toEqual(['m1'])
  })
})

// ─────────────────────────────────────────────────────────────────
// Async resolution: ordering, channels, exclusions via inspectArgs
// ─────────────────────────────────────────────────────────────────

describe('resolveContextEntries via resolvePrompt/inspectArgs', () => {
  it('reports the same exclusion strings as the sync pass', async () => {
    const cond = when(() => false, context({ id: 'seo', system: 'SEO.' }))
    const gated = context({ id: 'lang', when: () => false, system: 'Lang.' })
    const spec = match({ on: () => 'none', cases: { a: context({ system: 'A' }) } })
    const config: AnyConfig = { system: 'Base.', use: [cond, gated, spec] }

    const result = await inspectArgs(config, {}, undefined)
    expect(result.excludedContexts).toEqual([
      { source: 'context:seo', reason: 'when() predicate returned false' },
      { source: 'context:lang', reason: 'context-level when returned false' },
      { source: 'match[2]', reason: 'no case for "none" and no default' },
    ])
  })

  it('match branch entries are re-resolved with branch-local indices', async () => {
    const anonFailing = context({ when: () => false, system: 'nope' })
    const spec = match({ on: () => 'hit', cases: { hit: [context({ system: 'lead' }), anonFailing] } })
    const config: AnyConfig = { system: 'Base.', use: [context({ system: 'pad' }), spec] }

    const result = await inspectArgs(config, {}, undefined)
    // Inside the branch the entry index restarts at 0 → context[1], not match[1].
    expect(result.excludedContexts).toEqual([{ source: 'context[1]', reason: 'context-level when returned false' }])
  })

  it('nested useEntries contribute system text before their parent', async () => {
    const inner = context({ id: 'inner', system: 'INNER' })
    const parent = context({ id: 'parent', system: 'PARENT', use: [inner] })
    const config: AnyConfig = { system: 'OWN', use: [parent] }

    const result = await resolvePrompt(config, {}, undefined)
    expect(result.system).toBe('OWN\n\nINNER\n\nPARENT')
  })

  it('match selects the matching branch and default as fallback', async () => {
    const spec = match({
      on: (i) => i.mode as string,
      cases: { research: context({ id: 'r', system: 'RESEARCH' }) },
      default: context({ id: 'd', system: 'DEFAULT' }),
    })
    const config: AnyConfig = { system: 'S', use: [spec] }

    expect((await resolvePrompt(config, { input: { mode: 'research' } }, undefined)).system).toBe('S\n\nRESEARCH')
    expect((await resolvePrompt(config, { input: { mode: 'other' } }, undefined)).system).toBe('S\n\nDEFAULT')
  })
})

// ─────────────────────────────────────────────────────────────────
// Injectable entries
// ─────────────────────────────────────────────────────────────────

describe('injectable resolution', () => {
  it('lands contexts, tools, constraints, guardrails, and metadata in their channels', async () => {
    const constraint = { id: 'c1' } as unknown as Constraint
    const guardrail = { id: 'g1' } as unknown as Guardrail
    const inj = injectable({
      id: 'retrieval',
      inject: () => ({
        contexts: [context({ id: 'docs', system: 'Doc snippets.' })],
        tools: { search_docs: 'tool' },
        constraints: [constraint],
        guardrails: [guardrail],
        metadata: { retriever: 'docs' },
      }),
    })
    const config: AnyConfig = { system: 'S', use: [inj] }

    const result = await resolvePrompt(config, {}, undefined)
    expect(result.system).toBe('S\n\nDoc snippets.')
    expect(result.tools).toEqual({ search_docs: 'tool' })
    expect(result.constraints).toEqual([constraint])
    expect(result.guardrails).toEqual([guardrail])
    expect(result.metadata).toEqual({ retriever: 'docs' })
  })

  it('injected contexts re-enter the pipeline (when respected, exclusion attributed)', async () => {
    const inj = injectable({
      id: 'cond-inject',
      inject: () => ({ contexts: [context({ id: 'maybe', when: () => false, system: 'no' })] }),
    })
    const result = await inspectArgs({ system: 'S', use: [inj] } as AnyConfig, {}, undefined)
    expect(result.excludedContexts).toEqual([{ source: 'context:maybe', reason: 'context-level when returned false' }])
  })

  it('throws the exact injected-tool collision message', async () => {
    const a = injectable({ id: 'first', inject: () => ({ tools: { dup: 1 } }) })
    const b = injectable({ id: 'second', inject: () => ({ tools: { dup: 2 } }) })

    await expect(resolvePrompt({ system: 'S', use: [a, b] } as AnyConfig, {}, undefined)).rejects.toThrow(
      'Injected tool name collision for "dup". Injectable "second" generated a tool name that already exists.',
    )
  })

  it('passes input and promptId to inject()', async () => {
    const seen: unknown[] = []
    const inj = injectable({
      id: 'spy',
      inject: (args) => {
        seen.push(args)
        return {}
      },
    })
    await resolvePrompt({ id: 'p1', system: 'S', use: [inj] } as AnyConfig, { input: { q: 'x' } }, undefined)
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

    const result = await resolvePrompt(config, { input: { q: 1 } }, undefined)
    expect(result.system).toBe('S\n\nEarlier: user prefers tabs.')
    expect(result.memoryBindings).toEqual([{ memory: mem, input: { q: 1 }, promptId: 'with-memory' }])
  })

  it('memory tools are reported in the contribution artifact but NOT merged into resolved tools', async () => {
    const mem = fakeMemory('m-tools', 'text', { memory_search: 'tool' })
    const result = await resolvePrompt({ system: 'S', use: [mem] } as AnyConfig, {}, undefined)
    expect(result.tools).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────
// Blackboard entries
// ─────────────────────────────────────────────────────────────────

describe('blackboard resolution', () => {
  it('contributes its context text and merges board tools', async () => {
    const board = fakeBlackboard('plan', { write_plan: 'tool' })
    const result = await resolvePrompt({ system: 'S', use: [board] } as AnyConfig, {}, undefined)
    expect(result.system).toBe('S\n\nBoard plan state.')
    expect(result.tools).toEqual({ write_plan: 'tool' })
  })

  it('throws the exact blackboard tool collision message against existing tools', async () => {
    const board = fakeBlackboard('plan', { dup: 'board-tool' })
    const config: AnyConfig = { system: 'S', use: [board], tools: { dup: 'config-tool' } }

    await expect(resolvePrompt(config, {}, undefined)).rejects.toThrow(
      'Blackboard tool name collision for "dup". ' +
        'Blackboard "plan" generated a tool name that already exists. ' +
        'Configure a tool prefix, e.g. blackboard({ id: "plan", ..., tools: { prefix: "plan" } }).',
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

    const result = await resolvePrompt(config, {}, undefined)
    expect(result.systemBlocks?.[1]?.source).toBe('context:__crux_skill_index')
    // Index appears between the prompt's own system and nothing else
    expect(result.system!.startsWith('OWN\n\n')).toBe(true)
    expect(result.system).toContain('seo-audit')
    expect(Object.keys(result.tools ?? {})).toEqual(
      expect.arrayContaining(['__crux_LoadSkill', '__crux_LoadReference']),
    )
    expect((result as { _skillState?: unknown })._skillState).toBeDefined()
  })

  it('injects loaded-skill contexts for ids passed via _crux_activeSkills', async () => {
    const s = fakeSkill('writer', 'Writing skill', 'Write well.')
    const config: AnyConfig = { system: 'OWN', use: [s] }

    const result = await resolvePrompt(config, { input: { _crux_activeSkills: ['writer'] } }, undefined)
    const loaded = result.systemBlocks?.find((b) => b.source === 'context:__crux_skill_loaded:writer')
    expect(loaded?.text).toBe('## Skill: writer\n\nWrite well.')
  })

  it('degrades a failing lazy registry fetch to the placeholder with a console.warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const s = lazySkill('no-such-registry:owner/repo/slug')
    const config: AnyConfig = { system: 'OWN', use: [s] }

    const result = await resolvePrompt(config, {}, undefined)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch skill "no-such-registry:owner/repo/slug"'),
      expect.anything(),
    )
    // The placeholder skill still appears in the index
    expect(result.system).toContain('no-such-registry:owner/repo/slug')
  })

  it('inspectArgs mirrors the index context and reports loader tool names', async () => {
    const s = fakeSkill('inspector')
    const config: AnyConfig = { system: 'OWN', use: [s] }

    const result = await inspectArgs(config, {}, undefined)
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
    await resolvePrompt({ system: 'S', use: [cond, gated, spec] } as AnyConfig, {}, undefined)
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
    await resolvePrompt({ system: 'S', use: [passing, failing] } as AnyConfig, {}, undefined)
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
    await resolvePrompt({ system: 'S', use: [spec] } as AnyConfig, { input: { mode: 'other' } }, undefined)
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

  it('emits direct-tool contribution artifacts for memory, blackboard, and injectable entries', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const mem = fakeMemory('m1', 'mem text', { memory_recall: 'tool' })
    const board = fakeBlackboard('b1', { write_b1: 'tool' })
    const inj = injectable({ id: 'i1', inject: () => ({ tools: { injected_tool: 'tool' } }) })
    await resolvePrompt({ system: 'S', use: [inj, mem, board] } as AnyConfig, {}, undefined)
    await observe.flush()

    const previews = artifactPreviews(transport.records, 'context.contribution').filter((p) => p.state === 'active')
    const direct = previews.filter((p) =>
      ['injectable:i1', 'memory:m1', 'blackboard:b1'].includes(p.sourceId as string),
    )
    expect(direct).toEqual([
      {
        kind: 'context.contribution',
        state: 'active',
        included: true,
        sourceId: 'injectable:i1',
        injectableKind: 'injectable',
        injects: ['tools'],
        injectedTools: ['injected_tool'],
      },
      {
        kind: 'context.contribution',
        state: 'active',
        included: true,
        sourceId: 'memory:m1',
        injectableKind: 'memory',
        injects: ['tools'],
        injectedTools: ['memory_recall'],
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

  it('emits active contribution artifacts with tokens, cacheStatus, and id-prefix family sniffing', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const mem = fakeMemory('sniffed', 'memory text')
    await resolvePrompt({ system: 'S', use: [mem] } as AnyConfig, {}, undefined)
    await observe.flush()

    const previews = artifactPreviews(transport.records, 'context.contribution')
    const composed = previews.find((p) => p.sourceId === 'context:memory:sniffed' && p.cacheStatus !== undefined)
    expect(composed).toMatchObject({
      state: 'active',
      included: true,
      injectableKind: 'memory', // derived from the 'memory:' id prefix
      cacheStatus: 'disabled',
      text: 'memory text',
    })
    expect(typeof composed?.tokens).toBe('number')
  })

  it('emits prompt.input artifacts for passed, failed, and not-configured validation', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const schema = z.object({ name: z.string() })

    await resolvePrompt({ id: 'p', system: 'S' } as AnyConfig, { input: { name: 'ok' } }, schema)
    await expect(resolvePrompt({ id: 'p', system: 'S' } as AnyConfig, { input: { name: 5 } }, schema)).rejects.toThrow(
      /Input validation failed/,
    )
    await resolvePrompt({ id: 'p', system: 'S' } as AnyConfig, {}, undefined)
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
    await resolvePrompt({ system: 'X', use: [low, high] } as AnyConfig, { tokenBudget: 5 }, undefined)
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
// Context resolver cache instrumentation
// ─────────────────────────────────────────────────────────────────

describe('context cache instrumentation hooks', () => {
  it('fires onContextCacheMiss then onContextCacheHit with the derived cache key', async () => {
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = []
    updateRuntime({
      instrumentationHooks: {
        onContextCacheHit: (e) => events.push({ kind: 'hit', payload: e as unknown as Record<string, unknown> }),
        onContextCacheMiss: (e) => events.push({ kind: 'miss', payload: e as unknown as Record<string, unknown> }),
      },
    })

    const unique = `cache-char-${Date.now()}`
    const cached = context({ id: unique, system: () => 'cached text', cache: 300_000 })
    const config: AnyConfig = { system: 'S', use: [cached] }
    await resolvePrompt(config, {}, undefined)
    await resolvePrompt(config, {}, undefined)

    expect(events.map((e) => e.kind)).toEqual(['miss', 'hit'])
    expect(events[0]!.payload).toMatchObject({ contextId: unique, cacheKey: `cache:ctx:${unique}:` })
    expect(typeof events[0]!.payload.resolutionMs).toBe('number')
    expect(events[1]!.payload).toMatchObject({ contextId: unique, cacheKey: `cache:ctx:${unique}:` })
    expect(typeof events[1]!.payload.ageMs).toBe('number')
  })
})

// ─────────────────────────────────────────────────────────────────
// Input schema collection (definition-time shape walk)
// ─────────────────────────────────────────────────────────────────

describe('mergeInputSchemas shape collection', () => {
  it('injectable schemas contribute required keys', () => {
    const inj = injectable({ id: 'inj', input: z.object({ topK: z.number() }), inject: () => ({}) })
    const merged = mergeInputSchemas([inj], undefined)!
    expect(merged.safeParse({ topK: 3 }).success).toBe(true)
    expect(merged.safeParse({}).success).toBe(false)
  })

  it('match branch context keys become optional', () => {
    const branch = context({ id: 'b', input: z.object({ lang: z.string() }), system: 'B' })
    const spec = match({ on: () => 'b', cases: { b: branch } })
    const merged = mergeInputSchemas([spec], undefined)!
    expect(merged.safeParse({}).success).toBe(true)
    expect(merged.safeParse({ lang: 'fr' }).success).toBe(true)
  })

  it('skills, memories, and blackboards contribute no schema', () => {
    const merged = mergeInputSchemas([fakeSkill('s'), fakeMemory('m', 't'), fakeBlackboard('b', {})], undefined)
    expect(merged).toBeUndefined()
  })

  it('duplicate keys across contexts throw the exact conflict message', () => {
    const a = context({ id: 'first', input: z.object({ name: z.string() }), system: 'a' })
    const b = context({ id: 'second', input: z.object({ name: z.string() }), system: 'b' })
    expect(() => mergeInputSchemas([a, b], undefined)).toThrow(
      'Input key "name" is defined by both "first" and "second". Context input keys must not overlap.',
    )
  })

  it('nested useEntries schemas are collected (children before parent)', () => {
    const inner = context({ id: 'inner', input: z.object({ x: z.string() }), system: 'i' })
    const parent = context({ id: 'parent', input: z.object({ y: z.string() }), system: 'p', use: [inner] })
    const merged = mergeInputSchemas([parent], undefined)!
    expect(merged.safeParse({ x: 'a', y: 'b' }).success).toBe(true)
    expect(merged.safeParse({ y: 'b' }).success).toBe(false)
  })
})
