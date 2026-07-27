/** Managed-memory commit-gate behavior. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Guardrail } from '../../src/safety'
import { boundary, guardrail } from '../../src/safety'
import type { MemoryPolicy } from '../../src/memory'
import { facts, memory } from '../../src/memory'
import { prompt as makePrompt } from '../../src/prompt/prompt'
import { resetHooks, setHooks } from '../../src/runtime/runtime'
import { inMemoryRecordStore } from '../../src/storage'
import { testAdapter } from './capture/fixtures'

afterEach(() => resetHooks())

interface Candidate {
  content: string
  metadata?: Record<string, unknown>
  confidence?: number
}

function fixture(options: {
  candidate?: Candidate
  policy?: MemoryPolicy<Candidate>
  promptGuardrails?: Guardrail[]
} = {}) {
  const records = inMemoryRecordStore()
  const block = facts({
    id: 'facts',
    write: { mode: 'auto' },
    extract: async () => [
      options.candidate ?? { content: 'original candidate' },
    ],
    policy: options.policy,
  })
  const mem = memory({
    id: 'guarded-memory',
    records,
    namespace: 'thread:1',
    capture: { mode: 'inline' },
    blocks: [block],
  })
  const prompt = makePrompt({
    id: 'guarded-memory-prompt',
    use: [mem],
    input: z.object({ message: z.string() }),
    prompt: ({ input }) => input.message,
    guardrails: options.promptGuardrails,
  })
  const list = () =>
    block.list({
      records,
      namespace: 'thread:1',
      memoryId: 'guarded-memory',
    })
  return { records, mem, prompt, list }
}

function policy(
  id: string,
  run: Guardrail<ReturnType<typeof boundary.memory.write<Candidate>>>['run'],
  mode?: 'enforce' | 'report',
) {
  return guardrail({
    id,
    on: boundary.memory.write<Candidate>(),
    run,
    ...(mode ? { mode } : {}),
  })
}

describe('managed memory write safety', () => {
  it('runs redact, per-call guard, validation, shouldRemember, and persistence in order', async () => {
    const events: string[] = []
    const subjects: Candidate[] = []
    const local = fixture({
      candidate: { content: 'raw secret', metadata: { source: 'turn' } },
      policy: {
        redact: async (candidate) => {
          events.push('redact')
          return { ...candidate, content: 'redacted candidate' }
        },
        validate: z
          .object({
            content: z.string(),
            metadata: z.record(z.string(), z.unknown()).optional(),
            confidence: z.number().optional(),
          })
          .superRefine(() => {
            events.push('validate')
          }),
        shouldRemember: async () => {
          events.push('shouldRemember')
          return true
        },
      },
    })
    const { records } = local
    const put = records.put.bind(records)
    vi.spyOn(records, 'put').mockImplementation(async (...args) => {
      events.push('persist')
      return put(...args)
    })

    await testAdapter().generate(local.prompt, {
      model: 'model-1',
      input: { message: 'remember this' },
      guardrails: [
        policy('managed-memory-guard', (candidate) => {
          events.push('guard')
          subjects.push(candidate)
          return { action: 'allow' }
        }),
      ],
    })

    expect(events).toEqual([
      'redact',
      'guard',
      'validate',
      'shouldRemember',
      'persist',
    ])
    expect(subjects).toEqual([
      { content: 'redacted candidate', metadata: { source: 'turn' } },
    ])
  })

  it('passes an enforced rewrite through validation and persistence', async () => {
    const local = fixture({
      policy: {
        validate: z.object({ content: z.literal('rewritten candidate') }),
      },
    })

    await testAdapter().generate(local.prompt, {
      model: 'model-1',
      input: { message: 'remember this' },
      guardrails: [
        policy('rewrite-memory', () => ({
          action: 'rewrite',
          value: { content: 'rewritten candidate' },
          rewrite: { kind: 'normalize' },
        })),
      ],
    })

    await expect(local.list()).resolves.toEqual([
      expect.objectContaining({ content: 'rewritten candidate' }),
    ])
  })

  it('lets block validation reject an invalid rewritten candidate', async () => {
    const local = fixture({
      policy: { validate: z.object({ content: z.string() }) },
    })

    await testAdapter().generate(local.prompt, {
      model: 'model-1',
      input: { message: 'remember this' },
      guardrails: [
        policy('invalid-memory-rewrite', () => ({
          action: 'rewrite',
          value: { content: 42 as never },
          rewrite: { kind: 'normalize' },
        })),
      ],
    })

    await expect(local.list()).resolves.toEqual([])
  })

  it('treats drop as a successful persistence skip', async () => {
    const local = fixture()

    await expect(
      testAdapter().generate(local.prompt, {
        model: 'model-1',
        input: { message: 'remember this' },
        guardrails: [
          policy('drop-memory', () => ({
            action: 'drop',
            reason: 'not durable',
          })),
        ],
      }),
    ).resolves.toBeDefined()
    await expect(local.list()).resolves.toEqual([])
  })

  it('surfaces an enforced block and prevents persistence', async () => {
    const local = fixture()

    await expect(
      testAdapter().generate(local.prompt, {
        model: 'model-1',
        input: { message: 'remember this' },
        guardrails: [
          policy('block-memory', () => ({
            action: 'block',
            reason: 'unsafe memory',
          })),
        ],
      }),
    ).rejects.toThrow('Guardrail "block-memory" blocked: unsafe memory')
    await expect(local.list()).resolves.toEqual([])
  })

  it('persists and audits a warning', async () => {
    const local = fixture()

    const result = await testAdapter().generate(local.prompt, {
      model: 'model-1',
      input: { message: 'remember this' },
      guardrails: [
        policy('warn-memory', () => ({
          action: 'warn',
          reason: 'review later',
        })),
      ],
    })

    await expect(local.list()).resolves.toHaveLength(1)
    expect(result._meta.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'warn-memory',
        boundary: 'memory.write',
        action: 'warn',
      }),
    )
  })

  it.each(['rewrite', 'drop', 'block'] as const)(
    'audits report-mode %s without changing persistence',
    async (action) => {
      const local = fixture()
      const run = () =>
        action === 'rewrite'
          ? ({
              action,
              value: { content: 'report replacement' },
              rewrite: { kind: 'normalize' as const },
            } as const)
          : ({ action, reason: 'report only' } as const)

      const result = await testAdapter().generate(local.prompt, {
        model: 'model-1',
        input: { message: 'remember this' },
        guardrails: [policy(`report-memory-${action}`, run, 'report')],
      })

      await expect(local.list()).resolves.toEqual([
        expect.objectContaining({ content: 'original candidate' }),
      ])
      expect(result._meta.guardrails?.applied).toContainEqual(
        expect.objectContaining({
          guard: `report-memory-${action}`,
          mode: 'report',
        }),
      )
    },
  )

  it('runs global, prompt, and call bindings in registry order', async () => {
    const calls: string[] = []
    const scoped = (scope: string) =>
      policy(`${scope}-memory`, () => {
        calls.push(scope)
        return { action: 'allow' }
      })
    setHooks({ globalGuardrails: [scoped('global')] })
    const local = fixture({ promptGuardrails: [scoped('prompt')] })

    await testAdapter().generate(local.prompt, {
      model: 'model-1',
      input: { message: 'remember this' },
      guardrails: [scoped('call')],
    })

    expect(calls).toEqual(['global', 'prompt', 'call'])
  })

  it('leaves standalone capture governed only by block-local policy', async () => {
    const global = vi.fn(() => ({ action: 'drop' as const, reason: 'global' }))
    setHooks({ globalGuardrails: [policy('standalone-global', global)] })
    const local = fixture()

    await local.mem.captureTurn({
      messages: [{ role: 'user', content: 'remember this' }],
    })

    expect(global).not.toHaveBeenCalled()
    await expect(local.list()).resolves.toHaveLength(1)
  })
})
