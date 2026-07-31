import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { context, match, when } from '../../src/prompt/context'
import { prompt as makePrompt } from '../../src/prompt/prompt'
import { blackboard } from '../../src/agent/blackboard'
import { contributor } from '../../src/prompt/contributor'
import { memory, memoryBlock } from '../../src/memory'
import type {
  CruxContextContributionPreview,
  CruxPromptInputPreview,
  DefinitionRef,
} from '../../src/observability/contract'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { boundary, constraint, createSafety, guardrail, GuardrailBlockedError } from '../../src/safety'

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function artifactPreviews(records: readonly unknown[], kind: string): readonly unknown[] {
  return records
    .filter(isObjectRecord)
    .filter((record) => record.type === 'artifact' && record.kind === kind)
    .map((record) => record.preview)
}

function isContextContributionPreview(value: unknown): value is CruxContextContributionPreview {
  return (
    isObjectRecord(value) &&
    value.kind === 'context.contribution' &&
    typeof value.sourceId === 'string' &&
    typeof value.state === 'string' &&
    typeof value.included === 'boolean' &&
    typeof value.injectableKind === 'string'
  )
}

function isPromptInputPreview(value: unknown): value is CruxPromptInputPreview {
  return (
    isObjectRecord(value) &&
    value.kind === 'prompt.input' &&
    typeof value.validationStatus === 'string' &&
    Array.isArray(value.providedKeys)
  )
}

describe('canonical context and safety observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

    it('records prompt resolution, context predicate decisions, and resolved context artifacts', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const always = context({ id: 'always', system: 'Always included.' })
    const gated = context({
      id: 'gated',
      input: z.object({ includeGated: z.boolean().optional() }),
      when: ({ input }) => !!input.includeGated,
      system: 'Gated context.',
    })
    const wrapped = context({ id: 'wrapped', system: 'Wrapped context.' })
    const branch = match<{ mode: string }>({
      on: (input) => input.mode,
      cases: { research: context({ id: 'research', system: 'Research context.' }) },
    })

    const p = makePrompt({
      id: 'context-observe',
      input: z.object({ includeGated: z.boolean().optional(), includeWrapped: z.boolean().optional(), mode: z.string() }),
      use: [always, gated, when((input) => !!input.includeWrapped, wrapped), branch] as const,
      system: 'Base system.',
    })

    await p.resolve({ input: { includeGated: true, includeWrapped: false, mode: 'unknown' } })
    await observe.flush()

    expect(transport.records[0]).toMatchObject({ type: 'run:start', rootPrimitive: 'prompt.resolve' })
    const spanStarts = transport.records.filter((record) => record.type === 'span:start')
    expect(spanStarts).toContainEqual(
      expect.objectContaining({
        primitive: 'prompt.resolve',
        family: 'prompt',
        name: 'context-observe',
      }),
    )
    expect(spanStarts.filter((record) => record.primitive === 'context.predicate')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'gated',
          attributes: expect.objectContaining({ included: true }),
        }),
        expect.objectContaining({
          name: 'wrapped',
          attributes: expect.objectContaining({ included: false, reason: 'when() predicate returned false' }),
        }),
        expect.objectContaining({
          name: 'match[3]',
          attributes: expect.objectContaining({ included: false, discriminator: 'unknown' }),
        }),
      ]),
    )
    expect(spanStarts.filter((record) => record.primitive === 'context.resolve').map((record) => record.name)).toEqual([
      'always',
      'gated',
    ])
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'context.contribution',
        attributes: expect.objectContaining({ source: 'context:always' }),
      }),
    )
  })

    it('records structured context contribution and prompt budget previews', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const low = context({
      id: 'low',
      priority: 1,
      tools: { lowSearch: 'tool' },
      system: 'Low priority context with enough words that the token budget should drop it first.',
    })
    const high = context({
      id: 'high',
      priority: 90,
      tools: { highLookup: 'tool' },
      input: z.object({ workspaceName: z.string() }),
      system: ({ input }) => ({
        segments: [
          { text: 'Keep ', dynamic: false },
          { text: input.workspaceName, dynamic: true, source: 'workspaceName' },
        ],
      }),
    })
    const gated = context({
      id: 'gated',
      input: z.object({ includeGated: z.boolean().optional() }),
      when: ({ input }) => !!input.includeGated,
      system: 'Gated context.',
    })
    const branch = match<{ mode: string }>({
      on: (input) => input.mode,
      cases: { research: context({ id: 'research', system: 'Research branch context.' }) },
    })

    const p = makePrompt({
      id: 'context-contributions',
      input: z.object({ includeGated: z.boolean().optional(), mode: z.string() }),
      use: [low, high, gated, branch] as const,
      system: "Base.",
    });

    await p.resolve({
      input: { includeGated: false, mode: "unknown", workspaceName: "Acme" },
    });
    await observe.flush();

    const contextContributions = artifactPreviews(
      transport.records,
      "context.contribution",
    ).filter(isContextContributionPreview);
    expect(contextContributions).toContainEqual(
      expect.objectContaining({
        state: 'checked-not-included',
        included: false,
        sourceId: 'context:gated',
        reason: 'context-level when returned false',
        injectableKind: 'context',
      }),
    )
    expect(contextContributions).toContainEqual(
      expect.objectContaining({
        state: 'checked-not-included',
        included: false,
        sourceId: 'match[3]',
        reason: 'no case for "unknown" and no default',
        injectableKind: 'match',
      }),
    )
    expect(contextContributions).toContainEqual(
      expect.objectContaining({
        state: 'active',
        included: true,
        sourceId: 'context:high',
        injectableKind: 'context',
        injectedTools: ['highLookup'],
        segments: [
          { text: 'Keep ', dynamic: false },
          { text: 'Acme', dynamic: true, source: 'workspaceName' },
        ],
        staticTokens: expect.any(Number),
        dynamicTokens: expect.any(Number),
        cacheStatus: 'disabled',
        priority: 90,
      }),
    )

    expect(contextContributions).toContainEqual(
      expect.objectContaining({
        state: "active",
        included: true,
        sourceId: "context:low",
        priority: 1,
        injectedTools: ["lowSearch"],
      }),
    )
  })

    it('records redacted prompt input key summaries without input values', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const p = makePrompt({
      id: 'input-observe',
      input: z.object({ topic: z.string(), optional: z.string().optional() }),
      system: ({ input }) => `Topic: ${input.topic}`,
    })

    await p.resolve({ input: { topic: 'secret topic', extra: 'do not record' } })
    await observe.flush()

    const preview = artifactPreviews(transport.records, 'input').find(isPromptInputPreview)
    expect(preview).toEqual(
      expect.objectContaining({
        kind: 'prompt.input',
        promptId: 'input-observe',
        validationStatus: 'passed',
        providedKeys: ['extra', 'topic'],
        schemaKeys: ['optional', 'topic'],
        requiredKeys: ['topic'],
        missingKeys: [],
        unexpectedKeys: ['extra'],
      }),
    )
    expect(JSON.stringify(preview)).not.toContain('secret topic')
    expect(JSON.stringify(preview)).not.toContain('do not record')
  })

    it('records failed prompt input validation before throwing', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const p = makePrompt({
      id: 'input-invalid',
      input: z.object({ topic: z.string(), count: z.number().optional() }),
      system: 'Base.',
    })

    await expect(p.resolve({ input: { extra: 'still redacted' } })).rejects.toThrow('Input validation failed')
    await observe.flush()

    const preview = artifactPreviews(transport.records, 'input').find(isPromptInputPreview)
    expect(preview).toEqual(
      expect.objectContaining({
        kind: 'prompt.input',
        promptId: 'input-invalid',
        validationStatus: 'failed',
        providedKeys: ['extra'],
        schemaKeys: ['count', 'topic'],
        requiredKeys: ['topic'],
        missingKeys: ['topic'],
        unexpectedKeys: ['extra'],
      }),
    )
    expect(JSON.stringify(preview)).not.toContain('still redacted')
  })

    it('records direct tool producers with source kind and injected tool names', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const directRetriever = contributor({
      id: 'project-search',
      contribute: () => ({
        tools: { projectSearch: 'tool' },
      }),
    })
    const notesMemory = memory({
      id: 'notes',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'facts',
          kind: 'custom',
          render: async () => '',
          tools: () => ({
            recallMemory: {
              description: 'Recall memory.',
              parameters: z.object({ query: z.string() }),
              execute: async ({ query }: { query: string }) => `recalled ${query}`,
            },
          }),
        }),
      ],
    })
    const board = blackboard({
      id: 'run-state',
      schema: z.object({ status: z.string().optional() }),
    })

    const p = makePrompt({
      id: 'tool-provenance',
      use: [directRetriever, notesMemory, board],
      system: 'Base.',
    })

    await p.resolve({})
    await observe.flush()

    const contextContributions = artifactPreviews(transport.records, 'context.contribution').filter(
      isContextContributionPreview,
    )
    expect(contextContributions).toContainEqual(
      expect.objectContaining({
        sourceId: 'contributor:project-search',
        injectableKind: 'injectable',
        injects: ['tools'],
        injectedTools: ['projectSearch'],
      }),
    )
    // Memory entries contribute context only — their tools are opt-in via
    // memory.asTools() and are neither merged nor reported as injected.
    expect(contextContributions.filter((preview) => preview.sourceId === 'memory:notes')).toEqual([])
    expect(contextContributions).toContainEqual(
      expect.objectContaining({
        sourceId: 'blackboard:run-state',
        injectableKind: 'blackboard',
        injects: ['tools'],
        injectedTools: ['readBlackboard', 'writeBlackboard', 'patchBlackboard', 'clearBlackboard'],
      }),
    )
  })

    it('records constraint checks, retries, and reports', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    let attempt = 0
    const mustMentionShip = constraint({
      id: 'must-mention-ship',
      on: boundary.output.both(),
      maxRetries: 1,
      run: async () => {
        attempt += 1
        return attempt > 1 ? { pass: true } : { pass: false, feedback: 'Mention ship.' }
      },
    })

    const safety = createSafety({ promptId: 'safety-test', model: undefined, call: { constraints: [mustMentionShip] } })
    await safety.finalizeOutput({ text: 'draft' }, async () => ({ text: 'fixed ship' }))
    await observe.flush()

    expect(safety.audit.constraints?.allPassed).toBe(true)
    expect(transport.records[0]).toMatchObject({ type: 'run:start', rootPrimitive: 'constraint.check' })
    const spanStarts = transport.records.filter((record) => record.type === 'span:start') as Array<{
      primitive?: string
      name?: string
      definitionRefs?: DefinitionRef[]
    }>
    expect(spanStarts.filter((record) => record.primitive === 'constraint.check')).toHaveLength(3)
    expect(spanStarts).toContainEqual(
      expect.objectContaining({
        primitive: 'constraint.retry',
        attributes: expect.objectContaining({ failedCount: 1, nextAttempt: 1 }),
      }),
    )

    // Each per-constraint `must-mention-ship` check span carries the canonical
    // ref; the outer `constraints:<promptId>` grouping span carries none.
    const checkSpans = spanStarts.filter((record) => record.name === 'must-mention-ship')
    expect(checkSpans).toHaveLength(2)
    for (const span of checkSpans) {
      expect(span.definitionRefs).toEqual([
        { id: 'constraint:must-mention-ship', kind: 'constraint', role: 'invoked-constraint' },
      ])
    }
    const groupSpan = spanStarts.find((record) => record.name === 'constraints:safety-test')
    expect(groupSpan?.definitionRefs).toBeUndefined()

    const retrySpan = spanStarts.find((record) => record.primitive === 'constraint.retry')
    expect(retrySpan?.definitionRefs).toEqual([
      { id: 'constraint:must-mention-ship', kind: 'constraint', role: 'invoked-constraint' },
    ])
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'constraint.report',
        preview: expect.objectContaining({
          kind: 'constraint.report',
          attempts: expect.arrayContaining([
            // Feedback text is deliberately absent: it can echo model output.
            expect.objectContaining({ n: 1, status: 'fail' }),
          ]),
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'constraint.report',
        preview: expect.objectContaining({
          kind: 'constraint.report',
          attempts: expect.arrayContaining([
            expect.objectContaining({ n: 2, status: 'pass' }),
          ]),
        }),
      }),
    )
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'constraint.retry' }))
  })

  it('carries one ref per distinct constraint on a combined multi-constraint retry', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    let attempt = 0
    const mustMentionShip = constraint({
      id: 'must-mention-ship',
      on: boundary.output.both(),
      maxRetries: 1,
      run: async () => (attempt > 0 ? { pass: true } : { pass: false, feedback: 'Mention ship.' }),
    })
    const mustMentionCrew = constraint({
      id: 'must-mention-crew',
      on: boundary.output.both(),
      maxRetries: 1,
      run: async () => (attempt > 0 ? { pass: true } : { pass: false, feedback: 'Mention crew.' }),
    })

    const safety = createSafety({
      promptId: 'safety-test-multi',
      model: undefined,
      call: { constraints: [mustMentionShip, mustMentionCrew] },
    })
    await safety.finalizeOutput({ text: 'draft' }, async () => {
      attempt += 1
      return { text: 'fixed ship and crew' }
    })
    await observe.flush()

    expect(safety.audit.constraints?.allPassed).toBe(true)
    const spanStarts = transport.records.filter((record) => record.type === 'span:start') as Array<{
      primitive?: string
      name?: string
      definitionRefs?: DefinitionRef[]
    }>
    const retrySpan = spanStarts.find((record) => record.primitive === 'constraint.retry')
    expect(retrySpan?.definitionRefs).toEqual(
      expect.arrayContaining([
        { id: 'constraint:must-mention-ship', kind: 'constraint', role: 'invoked-constraint' },
        { id: 'constraint:must-mention-crew', kind: 'constraint', role: 'invoked-constraint' },
      ]),
    )
    expect(retrySpan?.definitionRefs).toHaveLength(2)
  })

    it('records guardrail actions and blocked relations', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const warn = guardrail({
      id: 'warn-sensitive',
      on: boundary.input.text(),
      run: async () => ({ action: 'warn', reason: 'Sensitive topic.' }),
    })
    const block = guardrail({
      id: 'block-secret',
      on: boundary.input.text(),
      run: async () => ({ action: 'block', reason: 'Secret detected.' }),
    })
    const safety = createSafety({ promptId: 'guardrail-test', model: undefined, call: { guardrails: [warn, block] } })

    await expect(safety.guardInput({ messages: [{ role: 'user', content: 'secret' }] })).rejects.toBeInstanceOf(
      GuardrailBlockedError,
    )
    await observe.flush()

    expect(transport.records[0]).toMatchObject({ type: 'run:start', rootPrimitive: 'guardrail.run' })
    const spanStarts = transport.records.filter((record) => record.type === 'span:start') as Array<{
      primitive?: string
      name?: string
      definitionRefs?: DefinitionRef[]
    }>
    expect(spanStarts.filter((record) => record.primitive === 'guardrail.run')).toHaveLength(3)

    // Each per-guard span carries its own canonical ref; the outer
    // `${phase} guardrails` grouping span carries none.
    const warnSpan = spanStarts.find((record) => record.name === 'warn-sensitive')
    expect(warnSpan?.definitionRefs).toEqual([
      { id: 'guardrail:warn-sensitive', kind: 'guardrail', role: 'invoked-guardrail' },
    ])
    const blockSpan = spanStarts.find((record) => record.name === 'block-secret')
    expect(blockSpan?.definitionRefs).toEqual([
      { id: 'guardrail:block-secret', kind: 'guardrail', role: 'invoked-guardrail' },
    ])
    const groupSpan = spanStarts.find((record) => record.name === 'input guardrails')
    expect(groupSpan?.definitionRefs).toBeUndefined()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'guardrail.report',
        attributes: expect.objectContaining({ guardrailName: 'block-secret', action: 'block' }),
        preview: expect.objectContaining({
          kind: 'guardrail.report',
          action: 'block',
          reason: 'Secret detected.',
        }),
      }),
    )
    expect(JSON.stringify(transport.records)).not.toContain('"beforePreview":"secret"')
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'guardrail.blocked' }))
  })
})
