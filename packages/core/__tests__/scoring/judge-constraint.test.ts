/**
 * Tests for the judge → constraint bridge (`judgeConstraint`).
 *
 * The contract under test: the factory returns a perfectly ordinary
 * `Constraint` — threshold semantics on the judge's own scale, the judge's
 * reasoning as regeneration feedback, and behavior through the safety
 * session boundary indistinguishable from a hand-written constraint.
 */

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { llmJudge, judgeConstraint } from '../../scoring'
import { isConstraint, ConstraintViolationError } from '../../safety/constraint'
import type { ConstraintContext } from '../../safety/constraint'
import { constraint } from '../../safety/constraint'
import { createSafety } from '../../safety/session'
import type { SafetyOutput } from '../../safety/session'
import type { Message } from '../../generation/messages'
import type { GenerateObjectFn } from '../../compaction/types'

// ── Helpers ────────────────────────────────────────────────────────

/** Mock generate returning a fixed score/reasoning on every call. */
function generateWith(score: number, reasoning = 'Test reasoning'): GenerateObjectFn {
  return (async () => ({ object: { reasoning, score } })) as unknown as GenerateObjectFn
}

/** Mock generate returning one queued { score, reasoning } per call. */
function generateSequence(...results: { score: number; reasoning?: string }[]): GenerateObjectFn {
  const queue = [...results]
  return (async () => {
    const next = queue.shift()
    if (!next) throw new Error('generateSequence exhausted')
    return { object: { reasoning: next.reasoning ?? 'queued reasoning', score: next.score } }
  }) as unknown as GenerateObjectFn
}

function testJudge(generate: GenerateObjectFn, id = 'brand-voice') {
  return llmJudge({
    id,
    criteria: 'Does the output match the brand voice?',
    scale: { min: 1, max: 10 },
    generate,
    model: 'test-model',
  })
}

const bareCtx: ConstraintContext = {
  promptId: undefined,
  model: undefined,
  traceId: undefined,
  attempt: 0,
  metadata: {},
}

const noRegen = async (): Promise<SafetyOutput> => {
  throw new Error('regenerate must not be called')
}

// ── Factory shape ──────────────────────────────────────────────────

describe('judgeConstraint — factory shape', () => {
  it('returns a real Constraint named after the judge id, with constraint() defaults', () => {
    const c = judgeConstraint(testJudge(generateWith(9)), { min: 7 })

    expect(isConstraint(c)).toBe(true)
    expect(c.name).toBe('brand-voice')
    expect(c.severity).toBe('assert')
    expect(c.maxRetries).toBe(2)
    expect(c.category).toBeUndefined()
    expect(c.onChunk).toBeUndefined()
  })

    it('passes severity, maxRetries, and category through to the constraint', () => {
    const c = judgeConstraint(testJudge(generateWith(9)), {
      min: 7,
      severity: 'suggest',
      maxRetries: 5,
      category: 'brand',
    })

    expect(c.severity).toBe('suggest')
    expect(c.maxRetries).toBe(5)
    expect(c.category).toBe('brand')
  })
})

// ── Threshold semantics ────────────────────────────────────────────

describe('judgeConstraint — threshold semantics', () => {
  it('passes when score is above min', async () => {
    const c = judgeConstraint(testJudge(generateWith(9)), { min: 7 })
    const result = await c.check({ text: 'on-brand copy', parsed: undefined }, bareCtx)
    expect(result.pass).toBe(true)
  })

    it('passes when score equals min (inclusive threshold)', async () => {
    const c = judgeConstraint(testJudge(generateWith(7)), { min: 7 })
    const result = await c.check({ text: 'borderline copy', parsed: undefined }, bareCtx)
    expect(result.pass).toBe(true)
  })

    it('fails below min with the judge reasoning as feedback', async () => {
    const c = judgeConstraint(testJudge(generateWith(3, 'Too formal for the brand voice.')), { min: 7 })
    const result = await c.check({ text: 'off-brand copy', parsed: undefined }, bareCtx)

    expect(result.pass).toBe(false)
    if (result.pass) throw new Error('unreachable')
    expect(result.feedback).toBe('Too formal for the brand voice.')
  })

    it('falls back to a score-below-minimum message when reasoning is empty', async () => {
    const c = judgeConstraint(testJudge(generateWith(3, '')), { min: 7 })
    const result = await c.check({ text: 'off-brand copy', parsed: undefined }, bareCtx)

    expect(result.pass).toBe(false)
    if (result.pass) throw new Error('unreachable')
    expect(result.feedback).toBe('Judge "brand-voice" scored 3; the minimum acceptable score is 7.')
  })

    it('uses the custom feedback formatter when provided', async () => {
    const c = judgeConstraint(testJudge(generateWith(3, 'raw reasoning')), {
      min: 7,
      feedback: (result) => `Score ${result.score}/10 — rewrite warmer.`,
    })
    const result = await c.check({ text: 'off-brand copy', parsed: undefined }, bareCtx)

    expect(result.pass).toBe(false)
    if (result.pass) throw new Error('unreachable')
    expect(result.feedback).toBe('Score 3/10 — rewrite warmer.')
  })

    it('attaches the judge verdict to check metadata on both pass and fail', async () => {
    const pass = await judgeConstraint(testJudge(generateWith(9, 'Great.')), { min: 7 }).check(
      { text: 'good', parsed: undefined },
      bareCtx,
    )
    const fail = await judgeConstraint(testJudge(generateWith(2, 'Bad.')), { min: 7 }).check(
      { text: 'bad', parsed: undefined },
      bareCtx,
    )

    expect(pass.metadata).toEqual({
      judge: { metricId: 'brand-voice', score: 9, min: 7, reasoning: 'Great.' },
    })
    expect(fail.metadata).toEqual({
      judge: { metricId: 'brand-voice', score: 2, min: 7, reasoning: 'Bad.' },
    })
  })
})

// ── Structured detail ──────────────────────────────────────────────

describe('judgeConstraint — judges with detailSchema', () => {
  it('threads structured detail into metadata.judge and the feedback callback', async () => {
    const detailJudge = llmJudge({
      id: 'brand-voice',
      criteria: 'Is the copy on brand?',
      scale: { min: 1, max: 10 },
      detailSchema: z.object({ issues: z.array(z.string()), aligned: z.boolean() }),
      generate: (async () => ({
        object: {
          reasoning: 'Two phrasing issues.',
          score: 4,
          detail: { issues: ['too formal', 'passive voice'], aligned: false },
        },
      })) as unknown as GenerateObjectFn,
      model: 'test-model',
    })

    const c = judgeConstraint(detailJudge, {
      min: 7,
      feedback: (result) => `Fix: ${result.detail?.issues.join(', ') ?? 'unknown'}`,
    })
    const result = await c.check({ text: 'off-brand copy', parsed: undefined }, bareCtx)

    expect(result.pass).toBe(false)
    if (result.pass) throw new Error('unreachable')
    expect(result.feedback).toBe('Fix: too formal, passive voice')
    expect(result.metadata).toEqual({
      judge: {
        metricId: 'brand-voice',
        score: 4,
        min: 7,
        reasoning: 'Two phrasing issues.',
        detail: { issues: ['too formal', 'passive voice'], aligned: false },
      },
    })
  })
})

// ── Judge call plumbing ────────────────────────────────────────────

describe('judgeConstraint — judge call plumbing', () => {
  it('overrides the judge generate/model for the production call', async () => {
    // Judge authored without bindings (CI provides them at score() time);
    // the constraint supplies production bindings via opts.
    const judge = llmJudge({ id: 'unbound', criteria: 'c', scale: { min: 0, max: 10 } })
    let capturedModel: unknown
    const generate = (async (opts: { model: unknown }) => {
      capturedModel = opts.model
      return { object: { reasoning: 'ok', score: 8 } }
    }) as unknown as GenerateObjectFn

    const c = judgeConstraint(judge, { min: 5, generate, model: 'prod-model' })
    const result = await c.check({ text: 'anything', parsed: undefined }, bareCtx)

    expect(result.pass).toBe(true)
    expect(capturedModel).toBe('prod-model')
  })

    it('sends an empty judge input by default and the derived input when opts.input is set', async () => {
    const prompts: string[] = []
    const generate = (async (opts: { prompt: string }) => {
      prompts.push(opts.prompt)
      return { object: { reasoning: 'ok', score: 8 } }
    }) as unknown as GenerateObjectFn

    await judgeConstraint(testJudge(generate), { min: 5 }).check({ text: 'the output', parsed: undefined }, bareCtx)
    await judgeConstraint(testJudge(generate), {
      min: 5,
      input: (_output, ctx) => String(ctx.metadata.caseInput ?? ''),
    }).check({ text: 'the output', parsed: undefined }, { ...bareCtx, metadata: { caseInput: 'the question' } })

    expect(prompts[0]).toContain('## Input\n\n\n## Output to Evaluate\nthe output')
    expect(prompts[1]).toContain('## Input\nthe question')
  })

    it('propagates judge errors (fail-closed), e.g. missing generate binding', async () => {
    const judge = llmJudge({ id: 'unbound', criteria: 'c', scale: { min: 0, max: 10 } })
    const c = judgeConstraint(judge, { min: 5 })

    await expect(c.check({ text: 'anything', parsed: undefined }, bareCtx)).rejects.toThrow(
      'no generate function provided',
    )
  })
})

// ── Safety session boundary ────────────────────────────────────────

describe('judgeConstraint — through the safety session', () => {
  it('retries with the judge reasoning as corrective feedback, then accepts', async () => {
    const judge = testJudge(
      generateSequence({ score: 3, reasoning: 'Too stiff — loosen the tone.' }, { score: 9, reasoning: 'On brand.' }),
    )
    const safety = createSafety({
      call: { constraints: [judgeConstraint(judge, { min: 7 })] },
      promptId: 'p1',
      model: 'm1',
    })

    const regenerate = vi.fn(async (_corrective: readonly Message[]): Promise<SafetyOutput> => ({
      text: 'warmer copy',
    }))
    const final = await safety.finalizeOutput({ text: 'stiff copy' }, regenerate)

    expect(final.text).toBe('warmer copy')
    expect(regenerate).toHaveBeenCalledTimes(1)
    const corrective = regenerate.mock.calls[0][0]
    expect(String(corrective[0].content)).toContain('[brand-voice]: Too stiff — loosen the tone.')

    const audit = safety.audit.constraints
    expect(audit?.allPassed).toBe(true)
    expect(audit?.entries.map((e) => e.pass)).toEqual([false, true])
    expect(audit?.entries[0].feedback).toBe('Too stiff — loosen the tone.')
  })

    it('throws ConstraintViolationError when retries are exhausted (assert severity)', async () => {
    const judge = testJudge(generateWith(2, 'Still off brand.'))
    const safety = createSafety({
      call: { constraints: [judgeConstraint(judge, { min: 7, maxRetries: 1 })] },
      promptId: 'p1',
      model: 'm1',
    })

    await expect(
      safety.finalizeOutput({ text: 'off-brand copy' }, async () => ({ text: 'still off-brand copy' })),
    ).rejects.toThrow(ConstraintViolationError)
  })

    it('suggest severity falls back to the last attempt instead of throwing', async () => {
    const judge = testJudge(generateWith(2, 'Off brand.'))
    const safety = createSafety({
      call: { constraints: [judgeConstraint(judge, { min: 7, severity: 'suggest' })] },
      promptId: 'p1',
      model: 'm1',
    })

    const final = await safety.finalizeOutput({ text: 'off-brand copy' }, noRegen)

    expect(final.text).toBe('off-brand copy')
    expect(safety.audit.constraints?.suggestFallback).toBe(true)
  })

    it('produces the same protocol transcript as a hand-written constraint with the same verdicts', async () => {
    const run = async (policy: Parameters<typeof createSafety>[0]['call']) => {
      const safety = createSafety({ call: policy, promptId: 'p1', model: 'm1' })
      await safety.finalizeOutput({ text: 'first draft' }, async () => ({ text: 'second draft' }))
      safety.stamp({})
      return safety.transcript
    }

    const judged = await run({
      constraints: [
        judgeConstraint(testJudge(generateSequence({ score: 3, reasoning: 'fix it' }, { score: 9 })), { min: 7 }),
      ],
    })
    const handWritten = await run({
      constraints: [
        constraint({
          name: 'hand-written',
          check: (output) =>
            output.text === 'first draft' ? { pass: false, feedback: 'fix it' } : { pass: true },
        }),
      ],
    })

    expect(judged).toEqual(handWritten)
  })
})
