/**
 * Type tests for the predicate-family bridge (`constraint.judge`).
 *
 * Verifies that:
 * - The judge's `TDetail` flows into the `feedback` callback.
 * - The exported `JudgeConstraintVerdict` names the `metadata.judge` shape
 *   without exposing private reasoning terminology.
 *
 * Compiled via `tsc --noEmit` only — no runtime behavior.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { judge } from '../src/scoring'
import { constraint } from '../src/safety'
import type { JudgeResult } from '../src/scoring'
import type { JudgeConstraintVerdict } from '../src/safety'

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

const brandDetailSchema = z.object({ issues: z.array(z.string()), aligned: z.boolean() })
type BrandDetail = z.infer<typeof brandDetailSchema>

const detailJudge = judge({
  id: 'brand-voice',
  criteria: 'Is the copy on brand?',
  scale: { min: 1, max: 10 },
  detailSchema: brandDetailSchema,
})

// ─────────────────────────────────────────────────────────────────
// constraint.judge — detail threading into feedback
// ─────────────────────────────────────────────────────────────────

constraint.judge({
  judge: detailJudge,
  minScore: 7,
  feedback: (result) => {
    expectTypeOf(result).toEqualTypeOf<JudgeResult<BrandDetail>>()
    expectTypeOf(result.detail).toEqualTypeOf<BrandDetail | undefined>()
    return result.reasoning
  },
})

// ─────────────────────────────────────────────────────────────────
// JudgeConstraintVerdict — the named metadata.judge contract
// ─────────────────────────────────────────────────────────────────

declare const verdict: JudgeConstraintVerdict<BrandDetail>
expectTypeOf(verdict.metricId).toEqualTypeOf<string>()
expectTypeOf(verdict.score).toEqualTypeOf<number>()
expectTypeOf(verdict.minScore).toEqualTypeOf<number>()
expectTypeOf(verdict.explanation).toEqualTypeOf<string>()
expectTypeOf(verdict.detail).toEqualTypeOf<BrandDetail | undefined>()
