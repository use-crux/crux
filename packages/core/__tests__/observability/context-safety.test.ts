import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { context, match, when } from '../../context'
import { prompt as makePrompt } from '../../define'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'
import { constraint, runConstraints } from '../../safety/constraint'
import { createGuardrailPipeline, guardrail, GuardrailBlockedError } from '../../safety/guardrail'

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
        kind: 'context',
        attributes: expect.objectContaining({ source: 'context:always' }),
      }),
    )
  })

  it('records constraint checks, retries, and reports', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    let attempt = 0
    const mustMentionShip = constraint({
      name: 'must-mention-ship',
      maxRetries: 1,
      check: async () => {
        attempt += 1
        return attempt > 1 ? { pass: true } : { pass: false, feedback: 'Mention ship.' }
      },
    })

    const result = await runConstraints(
      [mustMentionShip],
      'draft',
      { promptId: 'safety-test', attempt: 0 },
      async () => 'fixed ship',
    )
    await observe.flush()

    expect(result.audit.allPassed).toBe(true)
    expect(transport.records[0]).toMatchObject({ type: 'run:start', rootPrimitive: 'constraint.check' })
    const spanStarts = transport.records.filter((record) => record.type === 'span:start')
    expect(spanStarts.filter((record) => record.primitive === 'constraint.check')).toHaveLength(3)
    expect(spanStarts).toContainEqual(
      expect.objectContaining({
        primitive: 'constraint.retry',
        attributes: expect.objectContaining({ failedCount: 1, nextAttempt: 1 }),
      }),
    )
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'artifact', kind: 'constraint.report' }))
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'constraint.retry' }))
  })

  it('records guardrail actions and blocked relations', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const warn = guardrail({
      name: 'warn-sensitive',
      phase: 'input',
      validate: async () => ({ action: 'warn', warning: 'Sensitive topic.' }),
    })
    const block = guardrail({
      name: 'block-secret',
      phase: 'input',
      validate: async () => ({ action: 'block', reason: 'Secret detected.' }),
    })
    const pipeline = createGuardrailPipeline([warn, block])

    await expect(pipeline.runInput('secret', { promptId: 'guardrail-test' })).rejects.toBeInstanceOf(GuardrailBlockedError)
    await observe.flush()

    expect(transport.records[0]).toMatchObject({ type: 'run:start', rootPrimitive: 'guardrail.run' })
    const spanStarts = transport.records.filter((record) => record.type === 'span:start')
    expect(spanStarts.filter((record) => record.primitive === 'guardrail.run')).toHaveLength(3)
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'guardrail.report',
        attributes: expect.objectContaining({ guardrailName: 'block-secret', action: 'block' }),
      }),
    )
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'guardrail.blocked' }))
  })
})
