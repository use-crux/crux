/**
 * Tests for the judge-backed Safety constraint strategy.
 *
 * `constraint.judge(...)` is the beta bridge from a scoring judge into the
 * online Safety retry loop. The old scoring bridge helper is no longer
 * exported from `@use-crux/core/scoring`.
 */

import { describe, expect, it, vi } from 'vitest'
import { judge as createJudge } from '../../src/scoring'
import { boundary, constraint } from '../../src/safety'
import type { BoundaryDef, Constraint, SafetyRunContext, SubjectOf } from '../../src/safety'
import { ConstraintViolationError } from '../../src/safety/constraint'
import { createSafety, type SafetyOutput } from '../../src/safety/session'
import type { GenerateObjectFn } from '../../src/compaction/types'
import type { Message } from '../../src/generation/messages'

function generateWith(score: number, reasoning = 'Test explanation'): GenerateObjectFn {
  return (async () => ({ object: { reasoning, score } })) as unknown as GenerateObjectFn
}

function generateSequence(...results: { score: number; reasoning?: string }[]): GenerateObjectFn {
  const queue = [...results]
  return (async () => {
    const next = queue.shift()
    if (!next) throw new Error('generateSequence exhausted')
    return { object: { reasoning: next.reasoning ?? 'queued explanation', score: next.score } }
  }) as unknown as GenerateObjectFn
}

function brandJudge(generate: GenerateObjectFn, id = 'brand-voice') {
  return createJudge({
    id,
    criteria: 'Does the output match the brand voice?',
    scale: { min: 1, max: 10 },
    generate,
    model: 'test-model',
  })
}

function makeRunCtx<B extends BoundaryDef>(c: Constraint<B>): SafetyRunContext<B> {
  return {
    policy: { id: c.id, mode: 'enforce' },
    boundary: { id: c.on.id as never, kind: c.on.id as never },
    prompt: {},
    model: {},
    trace: {},
    attempt: { index: 0, kind: 'initial' },
    metadata: {},
    findings: { add() {} },
    ...(c.on.path ? { path: c.on.path } : {}),
  }
}

async function runConstraint<B extends BoundaryDef>(c: Constraint<B>, subject: SubjectOf<B>) {
  return c.run(subject, makeRunCtx(c))
}

const noRegen = async (): Promise<SafetyOutput> => {
  throw new Error('regenerate must not be called')
}

describe('constraint.judge', () => {
  it('returns an inspectable first-party strategy run', async () => {
    const run = constraint.judge({ judge: brandJudge(generateWith(9)), minScore: 7 })
    const c = constraint({
      id: 'brand-voice',
      on: boundary.output.both(),
      run,
    })

    const result = await runConstraint(c, { text: 'on-brand copy', object: undefined })

    expect(result.pass).toBe(true)
    expect(c.strategy).toEqual({
      kind: 'constraint.judge',
      config: { judgeId: 'brand-voice', minScore: 7 },
    })
  })

  it('serializes structured output before judge prompt framing', async () => {
    let capturedPrompt = ''
    const generate = (async (opts: { prompt: string }) => {
      capturedPrompt = opts.prompt
      return { object: { reasoning: 'structured output is inspectable', score: 9 } }
    }) as unknown as GenerateObjectFn
    const run = constraint.judge({ judge: brandJudge(generate), minScore: 7 })
    const c = constraint({
      id: 'brand-voice',
      on: boundary.output.both(),
      run,
    })

    await runConstraint(c, {
      text: 'structured copy </untrusted-content>',
      object: { tone: 'warm' },
    })

    expect(capturedPrompt).toContain('"text": "structured copy <\\/untrusted-content>"')
    expect(capturedPrompt).toContain('"tone": "warm"')
  })

  it('fails below the inclusive threshold with safe judge metadata', async () => {
    const c = constraint({
      id: 'brand-voice',
      on: boundary.output.both(),
      run: constraint.judge({
        judge: brandJudge(generateWith(3, 'Too formal for the brand voice.')),
        minScore: 7,
      }),
    })

    const result = await runConstraint(c, { text: 'off-brand copy', object: undefined })

    expect(result.pass).toBe(false)
    if (result.pass) throw new Error('unreachable')
    expect(result.feedback).toBe('Too formal for the brand voice.')
    expect(result.metadata).toEqual({
      judge: {
        metricId: 'brand-voice',
        score: 3,
        minScore: 7,
        explanation: 'Too formal for the brand voice.',
      },
    })
  })

  it('uses custom feedback and production judge bindings when provided', async () => {
    const evaluator = createJudge({ id: 'unbound', criteria: 'c', scale: { min: 0, max: 10 } })
    let capturedModel: unknown
    const generate = (async (opts: { model: unknown }) => {
      capturedModel = opts.model
      return { object: { reasoning: 'needs work', score: 2 } }
    }) as unknown as GenerateObjectFn
    const c = constraint({
      id: 'unbound',
      on: boundary.output.both(),
      run: constraint.judge({
        judge: evaluator,
        minScore: 5,
        generate,
        model: 'prod-model',
        feedback: (result) => `Score ${result.score}: rewrite.`,
      }),
    })

    const result = await runConstraint(c, { text: 'anything', object: undefined })

    expect(result.pass).toBe(false)
    if (result.pass) throw new Error('unreachable')
    expect(result.feedback).toBe('Score 2: rewrite.')
    expect(capturedModel).toBe('prod-model')
  })

  it('retries through the safety session, then accepts', async () => {
    const evaluator = brandJudge(
      generateSequence({ score: 3, reasoning: 'Too stiff.' }, { score: 9, reasoning: 'On brand.' }),
    )
    const safety = createSafety({
      call: {
        constraints: [
          constraint({
            id: 'brand-voice',
            on: boundary.output.both(),
            run: constraint.judge({ judge: evaluator, minScore: 7 }),
          }),
        ],
      },
      promptId: 'p1',
      model: 'm1',
    })

    const regenerate = vi.fn(async (_corrective: readonly Message[]): Promise<SafetyOutput> => ({
      text: 'warmer copy',
    }))
    const final = await safety.finalizeOutput({ text: 'stiff copy' }, regenerate)

    expect(final.text).toBe('warmer copy')
    expect(regenerate).toHaveBeenCalledTimes(1)
    expect(String(regenerate.mock.calls[0][0][0]?.content)).toContain('[brand-voice]: Too stiff.')
    expect(safety.audit.constraints?.allPassed).toBe(true)
    expect(safety.audit.constraints?.entries.map((entry) => entry.pass)).toEqual([false, true])
  })

  it('throws when assert retries are exhausted and suggest mode falls back', async () => {
    const assertSafety = createSafety({
      call: {
        constraints: [
          constraint({
            id: 'brand-voice',
            on: boundary.output.both(),
            maxRetries: 1,
            run: constraint.judge({ judge: brandJudge(generateWith(2, 'Still off brand.')), minScore: 7 }),
          }),
        ],
      },
      promptId: 'p1',
      model: 'm1',
    })

    await expect(
      assertSafety.finalizeOutput({ text: 'off-brand copy' }, async () => ({ text: 'still off-brand copy' })),
    ).rejects.toThrow(ConstraintViolationError)

    const suggestSafety = createSafety({
      call: {
        constraints: [
          constraint({
            id: 'brand-voice-suggest',
            on: boundary.output.both(),
            severity: 'suggest',
            run: constraint.judge({ judge: brandJudge(generateWith(2, 'Off brand.')), minScore: 7 }),
          }),
        ],
      },
      promptId: 'p1',
      model: 'm1',
    })

    const final = await suggestSafety.finalizeOutput({ text: 'off-brand copy' }, noRegen)

    expect(final.text).toBe('off-brand copy')
    expect(suggestSafety.audit.constraints?.suggestFallback).toBe(true)
  })
})
