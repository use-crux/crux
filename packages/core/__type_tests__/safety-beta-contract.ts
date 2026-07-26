/**
 * Type contract for the Safety stable-beta authoring surface.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and
 * `@ts-expect-error` markers carry the contract.
 */

import { expectTypeOf } from 'vitest'
import {
  boundary,
  constraint,
  guardrail,
  type BoundaryDef,
  type DotPath,
  type PathValue,
  type SafetyTuneOptions,
} from '../src/safety'

interface CustomerSummary {
  customer: {
    email: string
    tags: readonly string[]
  }
  score: number
}

expectTypeOf<DotPath<CustomerSummary>>().toEqualTypeOf<
  'customer' | 'score' | 'customer.email' | 'customer.tags'
>()
expectTypeOf<PathValue<CustomerSummary, 'customer.email'>>().toEqualTypeOf<string>()

const emailBoundary = boundary.output.object<CustomerSummary>().path('customer.email')
expectTypeOf(emailBoundary).toMatchTypeOf<BoundaryDef<'model.output.object', string>>()

// A dynamic/typo path resolves through the string-fallback overload with an
// `unknown` subject; known paths still autocomplete and infer their value type.
expectTypeOf(boundary.output.object<CustomerSummary>().path('customer.missing')).toMatchTypeOf<
  BoundaryDef<'model.output.object', unknown>
>()

guardrail({
  id: 'redact-output-email',
  on: boundary.output.object<CustomerSummary>().path('customer.email'),
  run: (email, ctx) => {
    expectTypeOf(email).toEqualTypeOf<string>()
    expectTypeOf(ctx.boundary.id).toEqualTypeOf<'model.output.object'>()
    expectTypeOf(ctx.path).toEqualTypeOf<string | undefined>()
    return {
      action: 'rewrite',
      value: '[redacted]',
      rewrite: { kind: 'redact' },
    }
  },
})

guardrail({
  id: 'pii-input-output',
  on: [boundary.input.text(), boundary.output.text()] as const,
  run: (subject, ctx) => {
    expectTypeOf(subject).toEqualTypeOf<string>()
    expectTypeOf(ctx.boundary.id).toEqualTypeOf<'model.input.text' | 'model.output.text'>()
    return { action: 'allow' }
  },
})

interface Answer {
  answer: string
  citations: readonly string[]
}

constraint({
  id: 'has-citations',
  on: boundary.output.object<Answer>(),
  run: (answer) => {
    expectTypeOf(answer).toEqualTypeOf<Answer>()
    return answer.citations.length > 0
      ? { pass: true }
      : { pass: false, feedback: 'Add citations.' }
  },
})

const validTune = {
  tune: {
    pii: { mode: 'report', enabled: false },
  },
} satisfies SafetyTuneOptions
expectTypeOf(validTune).toMatchTypeOf<SafetyTuneOptions>()

// RFC #173 removed guard-level streaming granularity: the boundary owns the unit.
const removedTuneStream = {
  tune: {
    // @ts-expect-error - `stream` is no longer a tunable field; refine the boundary.
    pii: { stream: 'final' },
  },
} satisfies SafetyTuneOptions
void removedTuneStream

guardrail({
  id: 'no-guard-stream',
  on: boundary.output.text(),
  // @ts-expect-error - `stream` was removed from GuardrailConfig; use `.deltas()`/`.sentences()`/`.complete()`.
  stream: 'sentence',
  run: () => ({ action: 'allow' }),
})

constraint({
  id: 'no-constraint-onchunk',
  on: boundary.output.object<Answer>(),
  // @ts-expect-error - `onChunk` was removed; constraints evaluate boundary units.
  onChunk: () => ({ abort: false }),
  run: () => ({ pass: true }),
})

// `hold` is type-legal only for a growing text unit; a `.complete()` unit excludes it.
guardrail({
  id: 'growing-can-hold',
  on: boundary.output.text().sentences(),
  run: () => ({ action: 'hold' }),
})
guardrail({
  id: 'closed-cannot-hold',
  on: boundary.output.text().complete(),
  // @ts-expect-error - a closed `.complete()` unit cannot return `hold`.
  run: () => ({ action: 'hold' }),
})

const invalidTune = {
  tune: {
    // @ts-expect-error - call-site tuning cannot replace policy logic.
    pii: { replace: true },
  },
} satisfies SafetyTuneOptions
