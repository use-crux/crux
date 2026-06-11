/**
 * Type tests for the predicate-family bridges (`judgeConstraint`,
 * `constraintScorer`).
 *
 * Verifies that:
 * - `judgeConstraint()` threads the constraint schema generic like
 *   `constraint()` / `citationConstraint()` do, so `opts.input` sees a typed
 *   `parsed` instead of `unknown`.
 * - The judge's `TDetail` flows into the `feedback` callback.
 * - The exported `JudgeConstraintVerdict` names the `metadata.judge` shape.
 * - `constraintScorer()` slots into a typed `q.evaluate()` scorer list.
 *
 * Compiled via `tsc --noEmit` only — no runtime behavior.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { judgeConstraint, llmJudge } from '../scoring'
import type { JudgeConstraintVerdict, JudgeResult } from '../scoring'
import { constraintScorer } from '../quality'
import type { QualityScorer } from '../quality'
import type { Constraint, ConstraintOutput } from '../safety/constraint'

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

const brandDetailSchema = z.object({ issues: z.array(z.string()), aligned: z.boolean() })
type BrandDetail = z.infer<typeof brandDetailSchema>

const detailJudge = llmJudge({
  id: 'brand-voice',
  criteria: 'Is the copy on brand?',
  scale: { min: 1, max: 10 },
  detailSchema: brandDetailSchema,
})

const answerSchema = z.object({ answer: z.string(), confidence: z.number() })

// ─────────────────────────────────────────────────────────────────
// judgeConstraint — detail threading into feedback
// ─────────────────────────────────────────────────────────────────

judgeConstraint(detailJudge, {
  min: 7,
  feedback: (result) => {
    expectTypeOf(result).toEqualTypeOf<JudgeResult<BrandDetail>>()
    expectTypeOf(result.detail).toEqualTypeOf<BrandDetail | undefined>()
    return result.reasoning
  },
})

// ─────────────────────────────────────────────────────────────────
// judgeConstraint — schema generic preserved on the returned Constraint
// ─────────────────────────────────────────────────────────────────

const schemaAware = judgeConstraint(detailJudge, {
  min: 7,
  input: (output: ConstraintOutput<typeof answerSchema>) => {
    // The whole point of threading TSchema: parsed is typed, not unknown.
    expectTypeOf(output.parsed).toEqualTypeOf<z.infer<typeof answerSchema> | undefined>()
    return output.parsed?.answer ?? ''
  },
})
expectTypeOf(schemaAware).toEqualTypeOf<Constraint<typeof answerSchema>>()

// Without an input callback the default stays the safe unknown schema.
const schemaless = judgeConstraint(detailJudge, { min: 7 })
expectTypeOf(schemaless).toEqualTypeOf<Constraint>()

// ─────────────────────────────────────────────────────────────────
// JudgeConstraintVerdict — the named metadata.judge contract
// ─────────────────────────────────────────────────────────────────

declare const verdict: JudgeConstraintVerdict<BrandDetail>
expectTypeOf(verdict.metricId).toEqualTypeOf<string>()
expectTypeOf(verdict.score).toEqualTypeOf<number>()
expectTypeOf(verdict.min).toEqualTypeOf<number>()
expectTypeOf(verdict.reasoning).toEqualTypeOf<string>()
expectTypeOf(verdict.detail).toEqualTypeOf<BrandDetail | undefined>()

// ─────────────────────────────────────────────────────────────────
// constraintScorer — slots into a typed scorer list
// ─────────────────────────────────────────────────────────────────

type CaseInput = { question: string }
type CaseOutput = { answer: string }

const typedScorer = constraintScorer<CaseInput, CaseOutput>(schemaless)
expectTypeOf(typedScorer).toEqualTypeOf<QualityScorer<CaseInput, CaseOutput>>()

// Default generics produce a scorer any evaluate() call can accept.
const defaultScorer = constraintScorer(schemaless)
expectTypeOf(defaultScorer.id).toEqualTypeOf<string>()
const scorers: readonly QualityScorer<CaseInput, CaseOutput>[] = [defaultScorer]
void scorers
