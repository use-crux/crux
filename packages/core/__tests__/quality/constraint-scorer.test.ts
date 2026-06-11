/**
 * Tests for the constraint → eval-scorer bridge (`constraintScorer`) and the
 * end-to-end predicate-family fixture: one judge definition enforced online
 * through the safety session and scored offline through a quality suite,
 * yielding consistent verdicts on the same text.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { constraintScorer, quality, suite, target } from '../../quality'
import { constraint, ConstraintViolationError } from '../../safety/constraint'
import { createSafety } from '../../safety/session'
import { llmJudge, judgeConstraint } from '../../scoring'
import type { GenerateObjectFn } from '../../compaction/types'

// ── Helpers ────────────────────────────────────────────────────────

const mustContainRefund = constraint({
  name: 'mentions-refund',
  check: (output) =>
    /refund/i.test(output.text) ? { pass: true } : { pass: false, feedback: 'The answer must mention refunds.' },
})

async function withQualityDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'crux-constraint-scorer-'))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ── Scorer contract ────────────────────────────────────────────────

describe('constraintScorer — scorer contract', () => {
  it('scores a passing output as a passed boolean score named after the constraint', async () => {
    const scorer = constraintScorer(mustContainRefund)
    expect(scorer.id).toBe('mentions-refund')

    const score = await scorer.score({
      input: { question: 'How do refunds work?' },
      output: 'Refunds are available within 30 days.',
      caseId: 'case-1',
      variantId: 'default',
    })

    expect(score).toEqual({ kind: 'boolean', name: 'mentions-refund', passed: true })
  })

  it('scores a failing output with the constraint feedback as reasoning', async () => {
    const score = await constraintScorer(mustContainRefund).score({
      input: { question: 'How do refunds work?' },
      output: 'Please contact support.',
      caseId: 'case-1',
      variantId: 'default',
    })

    expect(score).toEqual({
      kind: 'boolean',
      name: 'mentions-refund',
      passed: false,
      reasoning: 'The answer must mention refunds.',
    })
  })

  it('hands non-string outputs to check() as parsed, with a JSON rendering as text', async () => {
    let seen: { text: string; parsed: unknown } | undefined
    const inspect = constraint({
      name: 'inspect-output',
      check: (output) => {
        seen = { text: output.text, parsed: output.parsed }
        return { pass: true }
      },
    })

    const output = { answer: 'Refunds within 30 days.', confidence: 0.94 }
    await constraintScorer(inspect).score({ input: {}, output, caseId: 'c', variantId: 'v' })

    expect(seen?.parsed).toBe(output)
    expect(JSON.parse(seen?.text ?? '')).toEqual(output)
  })

  it('threads caseId, variantId, and the case input through ConstraintContext metadata', async () => {
    let metadata: Readonly<Record<string, unknown>> | undefined
    const inspect = constraint({
      name: 'inspect-context',
      check: (_output, ctx) => {
        metadata = ctx.metadata
        return { pass: true }
      },
    })

    await constraintScorer(inspect).score({
      input: { question: 'How do refunds work?' },
      output: 'text',
      caseId: 'case-9',
      variantId: 'candidate',
    })

    expect(metadata).toEqual({
      caseId: 'case-9',
      variantId: 'candidate',
      caseInput: { question: 'How do refunds work?' },
    })
  })
})

// ── Eval-report integration ────────────────────────────────────────

describe('constraintScorer — in a quality experiment', () => {
  it('a deliberately failing case shows up in the eval report and fails the experiment', async () => {
    await withQualityDir(async (dir) => {
      const q = quality({ id: 'constraint-regression', dir })
      const answers = suite<{ question: string }, string>('support-answers', (test) => {
        test('grounded refund answer', { input: { question: 'How do refunds work?' } })
        test('deflecting answer', { input: { question: 'Can I get my money back?' } })
      })
      const evalTarget = target.custom({
        id: 'support-agent',
        run: (input: { question: string }) =>
          input.question.includes('refunds') ? 'Refunds are available within 30 days.' : 'Please contact support.',
      })

      const experiment = await q.evaluate({
        id: 'constraint-regression',
        suite: answers,
        target: evalTarget,
        scorers: [constraintScorer(mustContainRefund)],
      })

      expect(experiment.status).toBe('failed')
      expect(experiment.summary).toMatchObject({ total: 2, passed: 1, failed: 1 })

      const failing = experiment.cases.find((c) => c.caseId === 'deflecting-answer')
      expect(failing?.status).toBe('failed')
      expect(failing?.scores).toEqual([
        {
          kind: 'boolean',
          name: 'mentions-refund',
          passed: false,
          reasoning: 'The answer must mention refunds.',
        },
      ])

      const passing = experiment.cases.find((c) => c.caseId === 'grounded-refund-answer')
      expect(passing?.status).toBe('passed')
      expect(passing?.scores).toEqual([{ kind: 'boolean', name: 'mentions-refund', passed: true }])
    })
  })

  it('a throwing check() propagates fail-closed: the case is recorded as error, not failed', async () => {
    await withQualityDir(async (dir) => {
      const q = quality({ id: 'constraint-error', dir })
      const broken = constraint({
        name: 'broken-check',
        check: () => {
          throw new Error('judge backend unreachable')
        },
      })
      const answers = suite<{ question: string }, string>('support-answers', (test) => {
        test('any answer', { input: { question: 'How do refunds work?' } })
      })

      const experiment = await q.evaluate({
        id: 'constraint-error',
        suite: answers,
        target: target.custom({ id: 'support-agent', run: () => 'Refunds within 30 days.' }),
        scorers: [constraintScorer(broken)],
      })

      expect(experiment.status).toBe('error')
      expect(experiment.cases[0].status).toBe('error')
      expect(experiment.cases[0].error).toContain('judge backend unreachable')
      expect(experiment.cases[0].scores).toEqual([])
    })
  })

  it('severity is online policy: a failing suggest constraint still fails the case offline', async () => {
    // Online, severity 'suggest' means best-effort (no hard failure). The
    // eval scorer is deliberately binary regardless — regression suites
    // exist to surface exactly the drift that suggest tolerates in production.
    await withQualityDir(async (dir) => {
      const q = quality({ id: 'constraint-suggest', dir })
      const softRefund = constraint({
        name: 'mentions-refund-soft',
        severity: 'suggest',
        check: (output) =>
          /refund/i.test(output.text) ? { pass: true } : { pass: false, feedback: 'The answer must mention refunds.' },
      })
      const answers = suite<{ question: string }, string>('support-answers', (test) => {
        test('deflecting answer', { input: { question: 'Can I get my money back?' } })
      })

      const experiment = await q.evaluate({
        id: 'constraint-suggest',
        suite: answers,
        target: target.custom({ id: 'support-agent', run: () => 'Please contact support.' }),
        scorers: [constraintScorer(softRefund)],
      })

      expect(experiment.status).toBe('failed')
      expect(experiment.cases[0].scores).toEqual([
        { kind: 'boolean', name: 'mentions-refund-soft', passed: false, reasoning: 'The answer must mention refunds.' },
      ])
    })
  })
})

// ── End-to-end: one predicate, both surfaces ───────────────────────

describe('one judge definition, enforced online and scored offline', () => {
  /** Deterministic judge: scores 9 when the copy says "delighted", 2 otherwise. */
  const fakeJudgeGenerate = (async (opts: { prompt: string }) => {
    const onBrand = opts.prompt.includes('delighted')
    return {
      object: {
        reasoning: onBrand ? 'Warm and customer-first.' : 'Cold corporate phrasing.',
        score: onBrand ? 9 : 2,
      },
    }
  }) as unknown as GenerateObjectFn

  const brandVoice = llmJudge({
    id: 'brand-voice',
    criteria: 'Is the copy warm and customer-first?',
    scale: { min: 1, max: 10 },
    generate: fakeJudgeGenerate,
    model: 'fake-model',
  })
  const brandVoiceGate = judgeConstraint(brandVoice, { min: 7 })

  const onBrandText = 'We are delighted to help you with your refund.'
  const offBrandText = 'Your request has been processed pursuant to policy.'

  it('the safety session and the eval scorer agree on the same texts', async () => {
    // Online: the session accepts on-brand text without regeneration…
    const acceptSession = createSafety({ call: { constraints: [brandVoiceGate] }, promptId: 'p', model: 'm' })
    const accepted = await acceptSession.finalizeOutput({ text: onBrandText }, async () => {
      throw new Error('regenerate must not be called')
    })
    expect(accepted.text).toBe(onBrandText)
    expect(acceptSession.audit.constraints?.allPassed).toBe(true)

    // …and rejects off-brand text once retries are exhausted.
    const rejectSession = createSafety({ call: { constraints: [brandVoiceGate] }, promptId: 'p', model: 'm' })
    await expect(
      rejectSession.finalizeOutput({ text: offBrandText }, async () => ({ text: offBrandText })),
    ).rejects.toThrow(ConstraintViolationError)

    // Offline: the same constraint as a scorer over the same two texts.
    await withQualityDir(async (dir) => {
      const q = quality({ id: 'brand-voice-regression', dir })
      const copy = suite<{ id: string }, string>('marketing-copy', (test) => {
        test('on-brand copy', { input: { id: 'on' } })
        test('off-brand copy', { input: { id: 'off' } })
      })
      const experiment = await q.evaluate({
        id: 'brand-voice-regression',
        suite: copy,
        target: target.custom({
          id: 'copywriter',
          run: (input: { id: string }) => (input.id === 'on' ? onBrandText : offBrandText),
        }),
        scorers: [constraintScorer(brandVoiceGate)],
      })

      // Consistent verdicts: pass online ⇔ pass offline, with the judge's
      // reasoning surfacing as the failing score's explanation.
      const verdicts = Object.fromEntries(experiment.cases.map((c) => [c.caseId, c.status]))
      expect(verdicts).toEqual({ 'on-brand-copy': 'passed', 'off-brand-copy': 'failed' })

      const failing = experiment.cases.find((c) => c.caseId === 'off-brand-copy')
      expect(failing?.scores[0]).toEqual({
        kind: 'boolean',
        name: 'brand-voice',
        passed: false,
        reasoning: 'Cold corporate phrasing.',
      })
    })
  })
})
